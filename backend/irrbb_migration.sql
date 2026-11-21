-- =====================================================================
-- IRRBB MVP: миграция ПОВЕРХ существующей схемы
-- (схемы auth, ref, market, app, calc, audit; ключи bigint).
-- Уже есть и НЕ трогаем: auth.user_session, auth.action_token, ref.bucket_set,
-- ref.time_bucket, market.ingestion_batch, market.curve, market.curve_point,
-- app.methodology_version, calc.base_curve_point, calc.base_point_source,
-- calc.stressed_curve_point.
-- Конвенция: NULL = «нет данных», 0 = валидное значение.
-- Только RUB.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 1. Организации и роли
-- ---------------------------------------------------------------------
CREATE TABLE app.organization (
    id         bigint GENERATED ALWAYS AS IDENTITY,
    name       varchar(256) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT pk_organization PRIMARY KEY (id),
    CONSTRAINT ck_organization_name CHECK (length(trim(name)) > 0)
);

-- organization_id nullable: у уже существующих пользователей организации нет
ALTER TABLE auth.user_account
    ADD COLUMN organization_id bigint,
    ADD CONSTRAINT fk_user_account_organization
        FOREIGN KEY (organization_id) REFERENCES app.organization (id);
CREATE INDEX ix_user_account_organization ON auth.user_account (organization_id);

-- [ASSUMPTION] кроме viewer/editor нужны auditor (просмотр+экспорт) и admin
ALTER TABLE auth.user_account
    DROP CONSTRAINT ck_user_account_role,
    ADD CONSTRAINT ck_user_account_role
        CHECK (role IN ('viewer', 'editor', 'auditor', 'admin'));

-- ---------------------------------------------------------------------
-- 2. Портфель
-- ---------------------------------------------------------------------
CREATE TABLE ref.instrument_type (
    code varchar(32) NOT NULL,
    name varchar(128) NOT NULL,
    CONSTRAINT pk_instrument_type PRIMARY KEY (code)
);
INSERT INTO ref.instrument_type (code, name) VALUES
    ('bond_ofz', 'ОФЗ'), ('bond_corp', 'Корпоративная облигация'), ('loan', 'Кредит'),
    ('deposit', 'Депозит'), ('current_account', 'Текущий счёт'), ('other', 'Прочее');

CREATE TABLE app.portfolio (
    id                 bigint GENERATED ALWAYS AS IDENTITY,
    organization_id    bigint NOT NULL,
    name               varchar(256) NOT NULL,
    currency_code      varchar(3) NOT NULL DEFAULT 'RUB',
    version_no         integer NOT NULL DEFAULT 1,   -- +1 при любом изменении состава; фиксируется в расчёте
    created_by_user_id bigint,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    CONSTRAINT pk_portfolio PRIMARY KEY (id),
    CONSTRAINT ck_portfolio_name CHECK (length(trim(name)) > 0),
    CONSTRAINT ck_portfolio_currency CHECK (currency_code = 'RUB'),
    CONSTRAINT ck_portfolio_version CHECK (version_no > 0),
    CONSTRAINT fk_portfolio_organization FOREIGN KEY (organization_id) REFERENCES app.organization (id),
    CONSTRAINT fk_portfolio_author FOREIGN KEY (created_by_user_id) REFERENCES auth.user_account (id)
);
CREATE UNIQUE INDEX uq_portfolio_name ON app.portfolio (organization_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_portfolio_version ON app.portfolio (id, version_no);

CREATE TABLE app.portfolio_instrument (
    id                    bigint GENERATED ALWAYS AS IDENTITY,
    portfolio_id          bigint NOT NULL,
    instrument_code       varchar(64) NOT NULL,       -- ISIN или внутренний ID
    instrument_type_code  varchar(32) NOT NULL,
    name                  varchar(256),
    nominal_rub           numeric(20,2) NOT NULL,
    currency_code         varchar(3) NOT NULL DEFAULT 'RUB',
    interest_rate_pct     numeric(18,10),             -- NULL = ставка не задана, 0 = нулевая
    maturity_date         date,                       -- [ASSUMPTION] NULL допустим для бессрочных
    status                varchar(16) NOT NULL DEFAULT 'active',
    -- маппинг на тенор (ждёт подтверждения заказчика): составной FK на ref.time_bucket
    mapped_bucket_set_id  bigint,
    mapped_bucket_no      smallint,
    mapping_status        varchar(16) NOT NULL DEFAULT 'unmapped',
    source_updated_at     timestamptz,                -- «дата обновления» из источника портфеля
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    deleted_at            timestamptz,
    CONSTRAINT pk_portfolio_instrument PRIMARY KEY (id),
    CONSTRAINT ck_portfolio_instrument_code CHECK (length(trim(instrument_code)) > 0),
    CONSTRAINT ck_portfolio_instrument_nominal CHECK (nominal_rub >= 0),
    CONSTRAINT ck_portfolio_instrument_currency CHECK (currency_code = 'RUB'),
    CONSTRAINT ck_portfolio_instrument_status CHECK (status IN ('active', 'matured', 'excluded')),
    CONSTRAINT ck_portfolio_instrument_mapping_status CHECK (mapping_status IN ('mapped', 'unmapped')),
    CONSTRAINT ck_portfolio_instrument_mapping CHECK (
        (mapped_bucket_set_id IS NULL) = (mapped_bucket_no IS NULL)
        AND (mapping_status = 'unmapped' OR mapped_bucket_no IS NOT NULL)),
    CONSTRAINT fk_portfolio_instrument_portfolio FOREIGN KEY (portfolio_id) REFERENCES app.portfolio (id),
    CONSTRAINT fk_portfolio_instrument_type FOREIGN KEY (instrument_type_code) REFERENCES ref.instrument_type (code),
    CONSTRAINT fk_portfolio_instrument_bucket FOREIGN KEY (mapped_bucket_set_id, mapped_bucket_no)
        REFERENCES ref.time_bucket (bucket_set_id, bucket_no)
);
CREATE UNIQUE INDEX uq_portfolio_instrument_code ON app.portfolio_instrument (portfolio_id, instrument_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_portfolio_instrument_maturity ON app.portfolio_instrument (portfolio_id, maturity_date);
CREATE INDEX ix_portfolio_instrument_type ON app.portfolio_instrument (portfolio_id, instrument_type_code);

CREATE TRIGGER trg_portfolio_updated BEFORE UPDATE ON app.portfolio
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_portfolio_instrument_updated BEFORE UPDATE ON app.portfolio_instrument
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. Статусы источников (MOEX, Calculator, LLM)
-- ---------------------------------------------------------------------
CREATE TABLE app.source_status (
    source             varchar(32) NOT NULL,
    status             varchar(16) NOT NULL DEFAULT 'no_connection',
    last_success_at    timestamptz,
    last_error_at      timestamptz,
    last_error_code    varchar(64),
    last_error_message text,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_source_status PRIMARY KEY (source),
    CONSTRAINT ck_source_status CHECK (status IN ('connected', 'no_connection', 'stale', 'error'))
);
INSERT INTO app.source_status (source) VALUES ('moex'), ('calculator'), ('llm');

-- ---------------------------------------------------------------------
-- 4. Сценарии: дополняем существующую app.scenario
--    Шоки по теноркам НЕ дублируем: их отдаёт calc.stressed_curve_point.shift_pp (п.п.)
-- ---------------------------------------------------------------------
ALTER TABLE app.scenario
    ADD COLUMN description     text,
    ADD COLUMN approval_status varchar(16) NOT NULL DEFAULT 'approved',
    ADD COLUMN is_mandatory    boolean NOT NULL DEFAULT false,   -- обязательные Twist и Curvature
    ADD CONSTRAINT ck_scenario_approval CHECK (approval_status IN ('approved', 'deprecated'));

-- Twist/Curvature: [ASSUMPTION] если Calculator использует steepener/flattener как Twist, 'twist' не нужен
ALTER TABLE app.scenario
    DROP CONSTRAINT ck_scenario_shift_type,
    ADD CONSTRAINT ck_scenario_shift_type CHECK (shift_type IN (
        'base', 'parallel_up', 'parallel_down', 'steepener', 'flattener',
        'short_up', 'short_down', 'custom_by_bucket', 'twist', 'curvature'));

-- ---------------------------------------------------------------------
-- 5. Расчёт: расширяем calc.curve_run (существующие запуски без портфеля остаются валидными)
-- ---------------------------------------------------------------------
ALTER TABLE calc.curve_run
    ADD COLUMN portfolio_id      bigint,
    ADD COLUMN portfolio_version integer,
    ADD COLUMN instrument_count  integer,
    ADD COLUMN idempotency_key   varchar(64),
    ADD COLUMN external_run_id   varchar(64),     -- id задания в Calculator
    ADD CONSTRAINT fk_curve_run_portfolio FOREIGN KEY (portfolio_id) REFERENCES app.portfolio (id),
    ADD CONSTRAINT fk_curve_run_portfolio_version FOREIGN KEY (portfolio_id, portfolio_version)
        REFERENCES app.portfolio (id, version_no),
    ADD CONSTRAINT ck_curve_run_instrument_count CHECK (instrument_count IS NULL OR instrument_count > 0),
    ADD CONSTRAINT ck_curve_run_portfolio CHECK (
        idempotency_key IS NULL
        OR (portfolio_id IS NOT NULL AND portfolio_version IS NOT NULL AND instrument_count IS NOT NULL));

ALTER TABLE calc.curve_run
    DROP CONSTRAINT ck_curve_run_status,
    ADD CONSTRAINT ck_curve_run_status
        CHECK (status IN ('pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled'));

-- идемпотентность: повторный клик с тем же ключом не создаёт дубль
CREATE UNIQUE INDEX uq_curve_run_idempotency ON calc.curve_run (created_by_user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX uq_curve_run_external ON calc.curve_run (external_run_id) WHERE external_run_id IS NOT NULL;
CREATE INDEX ix_curve_run_portfolio ON calc.curve_run (portfolio_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 6. Результаты по сценариям: расширяем calc.run_scenario
--    У старых строк status = 'pending' по умолчанию; при необходимости обновить вручную
-- ---------------------------------------------------------------------
ALTER TABLE calc.run_scenario
    ADD COLUMN status           varchar(16) NOT NULL DEFAULT 'pending',
    ADD COLUMN npv              numeric(24,4),
    ADD COLUMN delta_npv        numeric(24,4),
    ADD COLUMN nii              numeric(24,4),
    ADD COLUMN delta_nii        numeric(24,4),
    ADD COLUMN economic_capital numeric(24,4),   -- NULL у ошибочных, 0 валиден
    ADD COLUMN error_code       varchar(64),
    ADD COLUMN error_message    text,
    ADD COLUMN started_at       timestamptz,
    ADD COLUMN finished_at      timestamptz,
    ADD CONSTRAINT ck_run_scenario_status CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
    ADD CONSTRAINT ck_run_scenario_succeeded CHECK (status <> 'succeeded' OR economic_capital IS NOT NULL),
    ADD CONSTRAINT ck_run_scenario_failed CHECK (status <> 'failed' OR error_message IS NOT NULL);

CREATE TABLE calc.run_base_result (
    curve_run_id bigint NOT NULL,
    npv_base     numeric(24,4),
    nii_base     numeric(24,4),
    CONSTRAINT pk_run_base_result PRIMARY KEY (curve_run_id),
    CONSTRAINT fk_run_base_result_run FOREIGN KEY (curve_run_id) REFERENCES calc.curve_run (id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- 7. Сводка ЭКпрбк. Минимум считает Calculator, БД и фронт его не вычисляют.
-- ---------------------------------------------------------------------
CREATE TABLE calc.run_summary (
    curve_run_id        bigint NOT NULL,
    ec_irrbb            numeric(24,4),               -- NULL, если нет валидных сценариев
    currency_code       varchar(3) NOT NULL DEFAULT 'RUB',
    worst_scenario_id   bigint,                      -- worstScenarioId из ответа Calculator
    scenarios_total     integer NOT NULL,
    scenarios_succeeded integer NOT NULL,
    scenarios_failed    integer NOT NULL,
    is_final            boolean NOT NULL,            -- false => «неполный ЭКпрбк»
    calculated_at       timestamptz NOT NULL,
    CONSTRAINT pk_run_summary PRIMARY KEY (curve_run_id),
    CONSTRAINT ck_run_summary_currency CHECK (currency_code = 'RUB'),
    CONSTRAINT ck_run_summary_counts CHECK (
        scenarios_total >= 0 AND scenarios_succeeded >= 0 AND scenarios_failed >= 0
        AND scenarios_succeeded + scenarios_failed <= scenarios_total),
    CONSTRAINT ck_run_summary_final CHECK (NOT is_final OR (scenarios_failed = 0 AND ec_irrbb IS NOT NULL)),
    CONSTRAINT fk_run_summary_run FOREIGN KEY (curve_run_id) REFERENCES calc.curve_run (id) ON DELETE CASCADE,
    CONSTRAINT fk_run_summary_worst FOREIGN KEY (curve_run_id, worst_scenario_id)
        REFERENCES calc.run_scenario (curve_run_id, scenario_id)
);

-- все сценарии-минимумы (если ЭК совпал у нескольких)
CREATE TABLE calc.run_summary_min_scenario (
    curve_run_id bigint NOT NULL,
    scenario_id  bigint NOT NULL,
    CONSTRAINT pk_run_summary_min_scenario PRIMARY KEY (curve_run_id, scenario_id),
    CONSTRAINT fk_run_summary_min_summary FOREIGN KEY (curve_run_id)
        REFERENCES calc.run_summary (curve_run_id) ON DELETE CASCADE,
    CONSTRAINT fk_run_summary_min_scenario FOREIGN KEY (curve_run_id, scenario_id)
        REFERENCES calc.run_scenario (curve_run_id, scenario_id)
);
-- worst обязан входить в список минимумов; проверка в конце транзакции
ALTER TABLE calc.run_summary
    ADD CONSTRAINT fk_run_summary_worst_in_min FOREIGN KEY (curve_run_id, worst_scenario_id)
    REFERENCES calc.run_summary_min_scenario (curve_run_id, scenario_id)
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------
-- 8. Детализация по инструментам
-- ---------------------------------------------------------------------
CREATE TABLE calc.run_instrument_result (
    curve_run_id    bigint NOT NULL,
    scenario_id     bigint NOT NULL,
    instrument_id   bigint NOT NULL,
    instrument_code varchar(64) NOT NULL,            -- снимок ISIN/ID для сортировки и пагинации
    base_npv        numeric(24,4),
    scenario_npv    numeric(24,4),
    delta_npv       numeric(24,4),
    base_nii        numeric(24,4),
    scenario_nii    numeric(24,4),
    delta_nii       numeric(24,4),
    CONSTRAINT pk_run_instrument_result PRIMARY KEY (curve_run_id, scenario_id, instrument_id),
    CONSTRAINT fk_run_instrument_result_scenario FOREIGN KEY (curve_run_id, scenario_id)
        REFERENCES calc.run_scenario (curve_run_id, scenario_id) ON DELETE CASCADE,
    CONSTRAINT fk_run_instrument_result_instrument FOREIGN KEY (instrument_id)
        REFERENCES app.portfolio_instrument (id)
);
CREATE INDEX ix_run_instrument_result_code ON calc.run_instrument_result (curve_run_id, scenario_id, instrument_code);

-- ---------------------------------------------------------------------
-- 9. LLM Analytics (результат может отсутствовать)
-- ---------------------------------------------------------------------
CREATE TABLE calc.llm_analysis (
    id             bigint GENERATED ALWAYS AS IDENTITY,
    curve_run_id   bigint NOT NULL,
    status         varchar(16) NOT NULL,
    analysis_text  text,
    model          varchar(128),
    prompt_version varchar(64),
    is_current     boolean NOT NULL DEFAULT true,    -- перегенерация = новая строка
    requested_at   timestamptz NOT NULL DEFAULT now(),
    generated_at   timestamptz,
    error_code     varchar(64),
    error_message  text,
    CONSTRAINT pk_llm_analysis PRIMARY KEY (id),
    CONSTRAINT ck_llm_analysis_status CHECK (status IN ('pending', 'succeeded', 'failed', 'unavailable')),
    CONSTRAINT ck_llm_analysis_text CHECK (status <> 'succeeded' OR (analysis_text IS NOT NULL AND generated_at IS NOT NULL)),
    CONSTRAINT fk_llm_analysis_run FOREIGN KEY (curve_run_id) REFERENCES calc.curve_run (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_llm_analysis_current ON calc.llm_analysis (curve_run_id) WHERE is_current;

-- ---------------------------------------------------------------------
-- 10. Экспорт xlsx
-- ---------------------------------------------------------------------
CREATE TABLE app.export_job (
    id                   bigint GENERATED ALWAYS AS IDENTITY,
    kind                 varchar(16) NOT NULL,
    format               varchar(8) NOT NULL DEFAULT 'xlsx',
    scope                varchar(16) NOT NULL,
    include_details      boolean NOT NULL DEFAULT false,
    filters              jsonb,
    curve_id             bigint,
    curve_run_id         bigint,
    status               varchar(16) NOT NULL DEFAULT 'queued',
    file_key             varchar(512),               -- ключ объекта в S3/MinIO
    file_name            varchar(256),
    file_size_bytes      bigint,
    error_message        text,
    requested_by_user_id bigint NOT NULL,
    requested_at         timestamptz NOT NULL DEFAULT now(),
    finished_at          timestamptz,
    expires_at           timestamptz,
    CONSTRAINT pk_export_job PRIMARY KEY (id),
    CONSTRAINT ck_export_job_kind CHECK (kind IN ('curve', 'calculation')),
    CONSTRAINT ck_export_job_format CHECK (format = 'xlsx'),
    CONSTRAINT ck_export_job_scope CHECK (scope IN ('all', 'filtered')),
    CONSTRAINT ck_export_job_status CHECK (status IN ('queued', 'running', 'done', 'failed')),
    CONSTRAINT ck_export_job_target CHECK (
        (kind = 'curve' AND curve_id IS NOT NULL AND curve_run_id IS NULL)
        OR (kind = 'calculation' AND curve_run_id IS NOT NULL AND curve_id IS NULL)),
    CONSTRAINT ck_export_job_filters CHECK (scope = 'all' OR filters IS NOT NULL),
    CONSTRAINT ck_export_job_file CHECK (status <> 'done' OR file_key IS NOT NULL),
    CONSTRAINT ck_export_job_size CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
    CONSTRAINT fk_export_job_curve FOREIGN KEY (curve_id) REFERENCES market.curve (id),
    CONSTRAINT fk_export_job_run FOREIGN KEY (curve_run_id) REFERENCES calc.curve_run (id),
    CONSTRAINT fk_export_job_user FOREIGN KEY (requested_by_user_id) REFERENCES auth.user_account (id)
);
CREATE INDEX ix_export_job_user ON app.export_job (requested_by_user_id, requested_at DESC);
CREATE INDEX ix_export_job_run ON app.export_job (curve_run_id) WHERE curve_run_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 11. Аудит: дополняем audit.audit_log и делаем его append-only
-- ---------------------------------------------------------------------
ALTER TABLE audit.audit_log
    ADD COLUMN ip_address inet,
    ADD COLUMN request_id varchar(64);
CREATE INDEX ix_audit_log_time ON audit.audit_log (occurred_at DESC);

CREATE OR REPLACE FUNCTION audit.forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit.audit_log is append-only (% not allowed)', TG_OP;
END $$;
CREATE TRIGGER trg_audit_log_append_only BEFORE UPDATE OR DELETE ON audit.audit_log
    FOR EACH ROW EXECUTE FUNCTION audit.forbid_change();

COMMIT;
