CREATE SCHEMA auth;

CREATE TABLE
    auth.user_account (
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
        CONSTRAINT ck_user_account_email CHECK (
            email = trim(email)
            AND length(email) > 0
        ),
        CONSTRAINT ck_user_account_display_name CHECK (length(trim(display_name)) > 0),
        CONSTRAINT ck_user_account_password_hash CHECK (length(trim(password_hash)) > 0),
        CONSTRAINT ck_user_account_role CHECK (role IN ('viewer', 'editor')),
        CONSTRAINT ck_user_account_status CHECK (status IN ('pending', 'active', 'disabled')),
        CONSTRAINT ck_user_account_confirmation CHECK (
            status <> 'active'
            OR email_confirmed_at IS NOT NULL
        ),
        CONSTRAINT ck_user_account_times CHECK (
            updated_at >= created_at
            AND (
                email_confirmed_at IS NULL
                OR email_confirmed_at >= created_at
            )
        )
    );

CREATE UNIQUE INDEX uq_user_account_email ON auth.user_account (lower(email));

CREATE TABLE
    auth.user_session (
        id bigint GENERATED ALWAYS AS IDENTITY,
        user_id bigint NOT NULL,
        token_hash varchar(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        CONSTRAINT pk_user_session PRIMARY KEY (id),
        CONSTRAINT fk_user_session_user FOREIGN KEY (user_id) REFERENCES auth.user_account (id),
        CONSTRAINT uq_user_session_token UNIQUE (token_hash),
        CONSTRAINT ck_user_session_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_user_session_times CHECK (
            expires_at > created_at
            AND (
                revoked_at IS NULL
                OR revoked_at >= created_at
            )
        )
    );

CREATE INDEX ix_user_session_user ON auth.user_session (user_id);

CREATE TABLE
    auth.action_token (
        id bigint GENERATED ALWAYS AS IDENTITY,
        user_id bigint NOT NULL,
        purpose varchar(32) NOT NULL,
        token_hash varchar(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        CONSTRAINT pk_action_token PRIMARY KEY (id),
        CONSTRAINT fk_action_token_user FOREIGN KEY (user_id) REFERENCES auth.user_account (id),
        CONSTRAINT uq_action_token_hash UNIQUE (token_hash),
        CONSTRAINT ck_action_token_purpose CHECK (purpose IN ('verify_email', 'reset_password')),
        CONSTRAINT ck_action_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_action_token_times CHECK (
            expires_at > created_at
            AND (
                used_at IS NULL
                OR used_at >= created_at
            )
        )
    );

CREATE INDEX ix_action_token_user ON auth.action_token (user_id);

ALTER TABLE app.methodology_version
ADD COLUMN created_by_user_id bigint;

ALTER TABLE app.methodology_version
ADD CONSTRAINT fk_methodology_author FOREIGN KEY (created_by_user_id) REFERENCES auth.user_account (id);

CREATE INDEX ix_methodology_author ON app.methodology_version (created_by_user_id);

ALTER TABLE app.scenario
ADD COLUMN created_by_user_id bigint;

ALTER TABLE app.scenario
ADD CONSTRAINT fk_scenario_author FOREIGN KEY (created_by_user_id) REFERENCES auth.user_account (id);

CREATE INDEX ix_scenario_author ON app.scenario (created_by_user_id);

ALTER TABLE calc.curve_run
ADD COLUMN created_by_user_id bigint;

ALTER TABLE calc.curve_run
ADD CONSTRAINT fk_curve_run_author FOREIGN KEY (created_by_user_id) REFERENCES auth.user_account (id);

CREATE INDEX ix_curve_run_author ON calc.curve_run (created_by_user_id);

ALTER TABLE audit.audit_log
ADD COLUMN actor_user_id bigint;

ALTER TABLE audit.audit_log
ADD CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES auth.user_account (id);

CREATE INDEX ix_audit_actor ON audit.audit_log (actor_user_id);