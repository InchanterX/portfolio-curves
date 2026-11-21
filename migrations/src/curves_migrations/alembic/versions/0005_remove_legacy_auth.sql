ALTER TABLE app.methodology_version
DROP CONSTRAINT fk_methodology_author;

DROP INDEX app.ix_methodology_author;

ALTER TABLE app.methodology_version
DROP COLUMN created_by_user_id;

ALTER TABLE app.scenario
DROP CONSTRAINT fk_scenario_author;

DROP INDEX app.ix_scenario_author;

ALTER TABLE app.scenario
DROP COLUMN created_by_user_id;

ALTER TABLE calc.curve_run
DROP CONSTRAINT fk_curve_run_author;

DROP INDEX calc.ix_curve_run_author;

ALTER TABLE calc.curve_run
DROP COLUMN created_by_user_id;

ALTER TABLE audit.audit_log
DROP CONSTRAINT fk_audit_actor;

DROP INDEX audit.ix_audit_actor;

ALTER TABLE audit.audit_log
DROP COLUMN actor_user_id;

DROP TABLE auth.user_session;

DROP TABLE auth.action_token;

DROP TABLE auth.user_account;

DROP SCHEMA auth;