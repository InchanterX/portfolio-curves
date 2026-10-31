CREATE TABLE calc.curve_run (
    id bigint GENERATED ALWAYS AS IDENTITY,
    curve_id bigint NOT NULL,
    methodology_id bigint NOT NULL,
    bucket_set_id bigint NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    reporting_date date NOT NULL,
    created_by varchar(128) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    attempt integer NOT NULL DEFAULT 0,
    claimed_by varchar(128),
    heartbeat_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    error_message text,
    engine_version varchar(64),
    CONSTRAINT pk_curve_run PRIMARY KEY (id),
    CONSTRAINT uq_curve_run_source UNIQUE (id, curve_id, bucket_set_id),
    CONSTRAINT uq_curve_run_bucket_set UNIQUE (id, bucket_set_id),
    CONSTRAINT fk_curve_run_curve FOREIGN KEY (curve_id) REFERENCES market.curve(id),
    CONSTRAINT fk_curve_run_methodology FOREIGN KEY (methodology_id, bucket_set_id) REFERENCES app.methodology_version(id, bucket_set_id),
    CONSTRAINT ck_curve_run_status CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT ck_curve_run_attempt CHECK (attempt >= 0),
    CONSTRAINT ck_curve_run_times CHECK (finished_at IS NULL OR (started_at IS NOT NULL AND finished_at >= started_at))
);
CREATE INDEX ix_curve_run_queue ON calc.curve_run(status, created_at);
CREATE INDEX ix_curve_run_curve ON calc.curve_run(curve_id);
CREATE INDEX ix_curve_run_methodology ON calc.curve_run(methodology_id, bucket_set_id);
CREATE TABLE calc.run_scenario (
    curve_run_id bigint NOT NULL,
    scenario_id bigint NOT NULL,
    CONSTRAINT pk_run_scenario PRIMARY KEY (curve_run_id, scenario_id),
    CONSTRAINT fk_run_scenario_run FOREIGN KEY (curve_run_id) REFERENCES calc.curve_run(id),
    CONSTRAINT fk_run_scenario_scenario FOREIGN KEY (scenario_id) REFERENCES app.scenario(id)
);
CREATE INDEX ix_run_scenario_scenario ON calc.run_scenario(scenario_id);
CREATE TABLE calc.base_curve_point (
    curve_run_id bigint NOT NULL,
    curve_id bigint NOT NULL,
    bucket_set_id bigint NOT NULL,
    bucket_no smallint NOT NULL,
    rate_pct numeric(18,10) NOT NULL,
    value_source varchar(16) NOT NULL,
    exp_factor numeric(18,12) NOT NULL,
    one_minus_exp_factor numeric(18,12) NOT NULL,
    floor_pct numeric(18,10),
    CONSTRAINT pk_base_curve_point PRIMARY KEY (curve_run_id, bucket_no),
    CONSTRAINT uq_base_curve_point_source UNIQUE (curve_run_id, bucket_no, curve_id),
    CONSTRAINT uq_base_curve_point_bucket UNIQUE (curve_run_id, bucket_set_id, bucket_no),
    CONSTRAINT fk_base_curve_point_run FOREIGN KEY (curve_run_id, curve_id, bucket_set_id) REFERENCES calc.curve_run(id, curve_id, bucket_set_id),
    CONSTRAINT fk_base_curve_point_bucket FOREIGN KEY (bucket_set_id, bucket_no) REFERENCES ref.time_bucket(bucket_set_id, bucket_no),
    CONSTRAINT ck_base_curve_point_source CHECK (value_source IN ('known', 'nearest', 'interpolated', 'extrapolated')),
    CONSTRAINT ck_base_curve_point_factors CHECK (exp_factor BETWEEN 0 AND 1 AND one_minus_exp_factor BETWEEN 0 AND 1 AND abs(exp_factor + one_minus_exp_factor - 1) <= 0.000000000001)
);
CREATE TABLE calc.base_point_source (
    curve_run_id bigint NOT NULL,
    bucket_no smallint NOT NULL,
    curve_id bigint NOT NULL,
    point_no smallint NOT NULL,
    weight numeric(18,12),
    CONSTRAINT pk_base_point_source PRIMARY KEY (curve_run_id, bucket_no, point_no),
    CONSTRAINT fk_base_point_source_base FOREIGN KEY (curve_run_id, bucket_no, curve_id) REFERENCES calc.base_curve_point(curve_run_id, bucket_no, curve_id),
    CONSTRAINT fk_base_point_source_market FOREIGN KEY (curve_id, point_no) REFERENCES market.curve_point(curve_id, point_no)
);
CREATE TABLE calc.stressed_curve_point (
    curve_run_id bigint NOT NULL,
    scenario_id bigint NOT NULL,
    bucket_no smallint NOT NULL,
    shift_pp numeric(18,10) NOT NULL,
    rate_before_floor_pct numeric(18,10) NOT NULL,
    rate_pct numeric(18,10) NOT NULL,
    CONSTRAINT pk_stressed_curve_point PRIMARY KEY (curve_run_id, scenario_id, bucket_no),
    CONSTRAINT fk_stressed_curve_point_scenario FOREIGN KEY (curve_run_id, scenario_id) REFERENCES calc.run_scenario(curve_run_id, scenario_id),
    CONSTRAINT fk_stressed_curve_point_base FOREIGN KEY (curve_run_id, bucket_no) REFERENCES calc.base_curve_point(curve_run_id, bucket_no)
);
CREATE TABLE calc.portfolio_run (
    id bigint GENERATED ALWAYS AS IDENTITY,
    curve_run_id bigint NOT NULL,
    portfolio_snapshot_id bigint NOT NULL,
    reporting_date date NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    methodology jsonb NOT NULL,
    nii_horizon_years numeric(12,8),
    ec_formula varchar(128),
    created_by varchar(128) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    attempt integer NOT NULL DEFAULT 0,
    claimed_by varchar(128),
    heartbeat_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    error_message text,
    engine_version varchar(64),
    ec_irrbb numeric(24,8),
    worst_scenario_id bigint,
    CONSTRAINT pk_portfolio_run PRIMARY KEY (id),
    CONSTRAINT uq_portfolio_run_source UNIQUE (id, curve_run_id),
    CONSTRAINT uq_portfolio_run_snapshot UNIQUE (id, portfolio_snapshot_id),
    CONSTRAINT fk_portfolio_run_curve FOREIGN KEY (curve_run_id) REFERENCES calc.curve_run(id),
    CONSTRAINT fk_portfolio_run_snapshot FOREIGN KEY (portfolio_snapshot_id) REFERENCES app.portfolio_snapshot(id),
    CONSTRAINT fk_portfolio_run_worst FOREIGN KEY (curve_run_id, worst_scenario_id) REFERENCES calc.run_scenario(curve_run_id, scenario_id),
    CONSTRAINT ck_portfolio_run_status CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT ck_portfolio_run_attempt CHECK (attempt >= 0),
    CONSTRAINT ck_portfolio_run_horizon CHECK (nii_horizon_years > 0),
    CONSTRAINT ck_portfolio_run_methodology CHECK (jsonb_typeof(methodology) = 'object'),
    CONSTRAINT ck_portfolio_run_ec CHECK (ec_irrbb IS NULL OR ec_formula IS NOT NULL),
    CONSTRAINT ck_portfolio_run_times CHECK (finished_at IS NULL OR (started_at IS NOT NULL AND finished_at >= started_at))
);
CREATE INDEX ix_portfolio_run_queue ON calc.portfolio_run(status, created_at);
CREATE INDEX ix_portfolio_run_curve ON calc.portfolio_run(curve_run_id);
CREATE INDEX ix_portfolio_run_snapshot ON calc.portfolio_run(portfolio_snapshot_id);
CREATE TABLE calc.scenario_result (
    portfolio_run_id bigint NOT NULL,
    curve_run_id bigint NOT NULL,
    scenario_id bigint NOT NULL,
    currency_code varchar(3) NOT NULL,
    eve numeric(24,8) NOT NULL,
    delta_eve numeric(24,8) NOT NULL,
    nii numeric(24,8),
    delta_nii numeric(24,8),
    CONSTRAINT pk_scenario_result PRIMARY KEY (portfolio_run_id, scenario_id, currency_code),
    CONSTRAINT fk_scenario_result_run FOREIGN KEY (portfolio_run_id, curve_run_id) REFERENCES calc.portfolio_run(id, curve_run_id),
    CONSTRAINT fk_scenario_result_scenario FOREIGN KEY (curve_run_id, scenario_id) REFERENCES calc.run_scenario(curve_run_id, scenario_id),
    CONSTRAINT ck_scenario_result_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_scenario_result_nii CHECK ((nii IS NULL) = (delta_nii IS NULL))
);
CREATE TABLE calc.bucket_result (
    portfolio_run_id bigint NOT NULL,
    curve_run_id bigint NOT NULL,
    scenario_id bigint NOT NULL,
    currency_code varchar(3) NOT NULL,
    bucket_no smallint NOT NULL,
    net_cashflow numeric(24,8) NOT NULL,
    discount_factor numeric(18,12) NOT NULL,
    pv numeric(24,8) NOT NULL,
    CONSTRAINT pk_bucket_result PRIMARY KEY (portfolio_run_id, scenario_id, currency_code, bucket_no),
    CONSTRAINT fk_bucket_result_run FOREIGN KEY (portfolio_run_id, curve_run_id) REFERENCES calc.portfolio_run(id, curve_run_id),
    CONSTRAINT fk_bucket_result_curve FOREIGN KEY (curve_run_id, scenario_id, bucket_no) REFERENCES calc.stressed_curve_point(curve_run_id, scenario_id, bucket_no),
    CONSTRAINT ck_bucket_result_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_bucket_result_discount CHECK (discount_factor > 0)
);
CREATE TABLE calc.instrument_result (
    portfolio_run_id bigint NOT NULL,
    curve_run_id bigint NOT NULL,
    scenario_id bigint NOT NULL,
    portfolio_snapshot_id bigint NOT NULL,
    instrument_id bigint NOT NULL,
    pv numeric(24,8) NOT NULL,
    delta_pv numeric(24,8) NOT NULL,
    CONSTRAINT pk_instrument_result PRIMARY KEY (portfolio_run_id, scenario_id, instrument_id),
    CONSTRAINT fk_instrument_result_run FOREIGN KEY (portfolio_run_id, curve_run_id) REFERENCES calc.portfolio_run(id, curve_run_id),
    CONSTRAINT fk_instrument_result_scenario FOREIGN KEY (curve_run_id, scenario_id) REFERENCES calc.run_scenario(curve_run_id, scenario_id),
    CONSTRAINT fk_instrument_result_snapshot FOREIGN KEY (portfolio_run_id, portfolio_snapshot_id) REFERENCES calc.portfolio_run(id, portfolio_snapshot_id),
    CONSTRAINT fk_instrument_result_instrument FOREIGN KEY (instrument_id, portfolio_snapshot_id) REFERENCES app.instrument(id, snapshot_id)
);
CREATE INDEX ix_instrument_result_instrument ON calc.instrument_result(instrument_id, portfolio_snapshot_id);
