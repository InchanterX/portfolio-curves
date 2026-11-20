CREATE SCHEMA ref;
CREATE SCHEMA market;
CREATE SCHEMA app;
CREATE SCHEMA calc;
CREATE SCHEMA audit;
CREATE SCHEMA mart;
CREATE SCHEMA auth;

CREATE TABLE auth.user_account (
    id bigint GENERATED ALWAYS AS IDENTITY,
    email varchar(320) NOT NULL,
    display_name varchar(256) NOT NULL,
    password_hash text NOT NULL,
    role varchar(16) NOT NULL DEFAULT 'viewer',
    status varchar(16) NOT NULL DEFAULT 'pending',
    email_confirmed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_account PRIMARY KEY (id),
    CONSTRAINT ck_user_account_email CHECK (email = trim(email) AND length(email) > 0),
    CONSTRAINT ck_user_account_display_name CHECK (length(trim(display_name)) > 0),
    CONSTRAINT ck_user_account_password_hash CHECK (length(trim(password_hash)) > 0),
    CONSTRAINT ck_user_account_role CHECK (role IN ('viewer', 'editor')),
    CONSTRAINT ck_user_account_status CHECK (status IN ('pending', 'active', 'disabled')),
    CONSTRAINT ck_user_account_confirmation CHECK (status <> 'active' OR email_confirmed_at IS NOT NULL),
    CONSTRAINT ck_user_account_times CHECK (updated_at >= created_at AND (email_confirmed_at IS NULL OR email_confirmed_at >= created_at))
);
CREATE UNIQUE INDEX uq_user_account_email ON auth.user_account(lower(email));
CREATE TABLE auth.user_session (
    id bigint GENERATED ALWAYS AS IDENTITY,
    user_id bigint NOT NULL,
    token_hash varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CONSTRAINT pk_user_session PRIMARY KEY (id),
    CONSTRAINT fk_user_session_user FOREIGN KEY (user_id) REFERENCES auth.user_account(id),
    CONSTRAINT uq_user_session_token UNIQUE (token_hash),
    CONSTRAINT ck_user_session_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_user_session_times CHECK (expires_at > created_at AND (revoked_at IS NULL OR revoked_at >= created_at))
);
CREATE INDEX ix_user_session_user ON auth.user_session(user_id);
CREATE TABLE auth.action_token (
    id bigint GENERATED ALWAYS AS IDENTITY,
    user_id bigint NOT NULL,
    purpose varchar(32) NOT NULL,
    token_hash varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    CONSTRAINT pk_action_token PRIMARY KEY (id),
    CONSTRAINT fk_action_token_user FOREIGN KEY (user_id) REFERENCES auth.user_account(id),
    CONSTRAINT uq_action_token_hash UNIQUE (token_hash),
    CONSTRAINT ck_action_token_purpose CHECK (purpose IN ('verify_email', 'reset_password')),
    CONSTRAINT ck_action_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_action_token_times CHECK (expires_at > created_at AND (used_at IS NULL OR used_at >= created_at))
);
CREATE INDEX ix_action_token_user ON auth.action_token(user_id);

CREATE TABLE ref.bucket_set (
    id bigint GENERATED ALWAYS AS IDENTITY,
    code varchar(64) NOT NULL,
    version_no integer NOT NULL,
    name varchar(256) NOT NULL,
    CONSTRAINT pk_bucket_set PRIMARY KEY (id),
    CONSTRAINT uq_bucket_set_version UNIQUE (code, version_no),
    CONSTRAINT ck_bucket_set_version CHECK (version_no > 0)
);
CREATE TABLE ref.time_bucket (
    bucket_set_id bigint NOT NULL,
    bucket_no smallint NOT NULL,
    label varchar(16) NOT NULL,
    lower_years numeric(12,8) NOT NULL,
    upper_years numeric(12,8),
    tenor_years numeric(12,8) NOT NULL,
    CONSTRAINT pk_time_bucket PRIMARY KEY (bucket_set_id, bucket_no),
    CONSTRAINT fk_time_bucket_set FOREIGN KEY (bucket_set_id) REFERENCES ref.bucket_set(id),
    CONSTRAINT uq_time_bucket_label UNIQUE (bucket_set_id, label),
    CONSTRAINT ck_time_bucket_number CHECK (bucket_no > 0),
    CONSTRAINT ck_time_bucket_bounds CHECK (lower_years >= 0 AND (upper_years IS NULL OR upper_years > lower_years)),
    CONSTRAINT ck_time_bucket_tenor CHECK (tenor_years > 0 AND tenor_years >= lower_years AND (upper_years IS NULL OR tenor_years <= upper_years))
);
CREATE TABLE market.ingestion_batch (
    id bigint GENERATED ALWAYS AS IDENTITY,
    source varchar(32) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'running',
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    error_message text,
    CONSTRAINT pk_ingestion_batch PRIMARY KEY (id),
    CONSTRAINT ck_ingestion_batch_status CHECK (status IN ('running', 'succeeded', 'failed')),
    CONSTRAINT ck_ingestion_batch_times CHECK (finished_at IS NULL OR finished_at >= started_at)
);
CREATE TABLE market.curve (
    id bigint GENERATED ALWAYS AS IDENTITY,
    ingestion_batch_id bigint NOT NULL,
    source varchar(32) NOT NULL,
    curve_code varchar(32) NOT NULL,
    currency_code varchar(3) NOT NULL DEFAULT 'RUB',
    curve_date date NOT NULL,
    revision integer NOT NULL DEFAULT 1,
    status varchar(16) NOT NULL DEFAULT 'loading',
    rate_convention varchar(64),
    payload jsonb NOT NULL,
    payload_sha256 varchar(64) NOT NULL,
    loaded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_curve PRIMARY KEY (id),
    CONSTRAINT fk_curve_batch FOREIGN KEY (ingestion_batch_id) REFERENCES market.ingestion_batch(id),
    CONSTRAINT uq_curve_revision UNIQUE (source, curve_code, currency_code, curve_date, revision),
    CONSTRAINT uq_curve_payload UNIQUE (source, curve_code, currency_code, curve_date, payload_sha256),
    CONSTRAINT ck_curve_revision CHECK (revision > 0),
    CONSTRAINT ck_curve_status CHECK (status IN ('loading', 'accepted', 'rejected')),
    CONSTRAINT ck_curve_hash CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_curve_currency CHECK (currency_code ~ '^[A-Z]{3}$')
);
CREATE INDEX ix_curve_batch ON market.curve(ingestion_batch_id);
CREATE TABLE market.curve_point (
    curve_id bigint NOT NULL,
    point_no smallint NOT NULL,
    tenor_years numeric(12,8) NOT NULL,
    rate_pct numeric(18,10) NOT NULL,
    CONSTRAINT pk_curve_point PRIMARY KEY (curve_id, point_no),
    CONSTRAINT uq_curve_point_tenor UNIQUE (curve_id, tenor_years),
    CONSTRAINT fk_curve_point_curve FOREIGN KEY (curve_id) REFERENCES market.curve(id),
    CONSTRAINT ck_curve_point_number CHECK (point_no > 0),
    CONSTRAINT ck_curve_point_tenor CHECK (tenor_years > 0)
);
CREATE TABLE app.methodology_version (
    id bigint GENERATED ALWAYS AS IDENTITY,
    code varchar(64) NOT NULL,
    version_no integer NOT NULL,
    name varchar(256) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'draft',
    bucket_set_id bigint NOT NULL,
    x numeric(12,8),
    parallel_shift_pp numeric(18,10),
    short_shift_pp numeric(18,10),
    long_shift_pp numeric(18,10),
    floor_mode varchar(16),
    floor_params jsonb,
    interpolation_method varchar(64),
    extrapolation_method varchar(64),
    nearest_method varchar(64),
    rate_convention varchar(64),
    source_document varchar(512),
    created_by varchar(128) NOT NULL,
    created_by_user_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_methodology_author FOREIGN KEY (created_by_user_id) REFERENCES auth.user_account(id),
    CONSTRAINT pk_methodology_version PRIMARY KEY (id),
    CONSTRAINT uq_methodology_version UNIQUE (code, version_no),
    CONSTRAINT uq_methodology_bucket_set UNIQUE (id, bucket_set_id),
    CONSTRAINT fk_methodology_bucket_set FOREIGN KEY (bucket_set_id) REFERENCES ref.bucket_set(id),
    CONSTRAINT ck_methodology_version CHECK (version_no > 0),
    CONSTRAINT ck_methodology_status CHECK (status IN ('draft', 'ready', 'retired')),
    CONSTRAINT ck_methodology_x CHECK (x > 0),
    CONSTRAINT ck_methodology_shifts CHECK (parallel_shift_pp >= 0 AND short_shift_pp >= 0 AND long_shift_pp >= 0),
    CONSTRAINT ck_methodology_floor_mode CHECK (floor_mode IN ('none', 'constant', 'by_bucket')),
    CONSTRAINT ck_methodology_ready CHECK (status = 'draft' OR ((
        x IS NOT NULL AND parallel_shift_pp IS NOT NULL AND short_shift_pp IS NOT NULL AND long_shift_pp IS NOT NULL
        AND interpolation_method IS NOT NULL AND extrapolation_method IS NOT NULL AND nearest_method IS NOT NULL
        AND rate_convention IS NOT NULL AND floor_mode IS NOT NULL
        AND (
            (floor_mode = 'none' AND floor_params IS NULL)
            OR (floor_mode = 'constant' AND jsonb_typeof(floor_params->'value_pct') = 'number')
            OR (floor_mode = 'by_bucket' AND jsonb_typeof(floor_params) = 'object')
        )
        AND length(trim(interpolation_method)) > 0 AND length(trim(extrapolation_method)) > 0
        AND length(trim(nearest_method)) > 0 AND length(trim(rate_convention)) > 0
    ) IS TRUE))
);
CREATE TABLE app.scenario (
    id bigint GENERATED ALWAYS AS IDENTITY,
    code varchar(64) NOT NULL,
    version_no integer NOT NULL,
    name varchar(256) NOT NULL,
    shift_type varchar(32) NOT NULL,
    params jsonb,
    is_predefined boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_by varchar(128) NOT NULL,
    created_by_user_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_scenario_author FOREIGN KEY (created_by_user_id) REFERENCES auth.user_account(id),
    CONSTRAINT pk_scenario PRIMARY KEY (id),
    CONSTRAINT uq_scenario_version UNIQUE (code, version_no),
    CONSTRAINT ck_scenario_version CHECK (version_no > 0),
    CONSTRAINT ck_scenario_shift_type CHECK (shift_type IN ('base', 'parallel_up', 'parallel_down', 'steepener', 'flattener', 'short_up', 'short_down', 'custom_by_bucket')),
    CONSTRAINT ck_scenario_params CHECK (params IS NULL OR jsonb_typeof(params) = 'object'),
    CONSTRAINT ck_scenario_custom CHECK (shift_type <> 'custom_by_bucket' OR params IS NOT NULL)
);
CREATE UNIQUE INDEX uq_scenario_active ON app.scenario((CASE WHEN is_active THEN code END));
CREATE TABLE audit.audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor varchar(128) NOT NULL,
    actor_user_id bigint,
    action varchar(64) NOT NULL,
    entity_type varchar(64) NOT NULL,
    entity_id bigint NOT NULL,
    details jsonb,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES auth.user_account(id),
    CONSTRAINT pk_audit_log PRIMARY KEY (id)
);
CREATE INDEX ix_audit_log_entity ON audit.audit_log(entity_type, entity_id);

CREATE INDEX ix_methodology_author ON app.methodology_version(created_by_user_id);
CREATE INDEX ix_scenario_author ON app.scenario(created_by_user_id);
CREATE INDEX ix_audit_actor ON audit.audit_log(actor_user_id);
