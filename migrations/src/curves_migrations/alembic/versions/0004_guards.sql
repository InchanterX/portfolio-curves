CREATE FUNCTION app.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Changes to this object are not permitted' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON ref.bucket_set FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON ref.time_bucket FOR EACH ROW EXECUTE FUNCTION app.reject_change();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON audit.audit_log FOR EACH ROW EXECUTE FUNCTION app.reject_change();

CREATE FUNCTION app.guard_bucket_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM id FROM ref.bucket_set WHERE id = NEW.bucket_set_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM app.methodology_version WHERE bucket_set_id = NEW.bucket_set_id AND status <> 'draft') THEN
        RAISE EXCEPTION 'Published bucket grid cannot be extended' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_bucket_insert BEFORE INSERT ON ref.time_bucket FOR EACH ROW EXECUTE FUNCTION app.guard_bucket_insert();

CREATE FUNCTION app.guard_curve() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'loading' THEN RAISE EXCEPTION 'New curve must be loading' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'accepted' THEN
            RAISE EXCEPTION 'Accepted curve is immutable' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'accepted' THEN
        RAISE EXCEPTION 'Accepted curve is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'accepted' AND (NEW.rate_convention IS NULL OR NOT EXISTS (SELECT 1 FROM market.curve_point WHERE curve_id = NEW.id)) THEN
        RAISE EXCEPTION 'Accepted curve requires points and a rate convention' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_curve BEFORE INSERT OR UPDATE OR DELETE ON market.curve FOR EACH ROW EXECUTE FUNCTION app.guard_curve();

CREATE FUNCTION app.guard_curve_point() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id bigint;
parent_status text;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.curve_id <> OLD.curve_id THEN
        RAISE EXCEPTION 'Cannot move a curve point' USING ERRCODE = '23514';
    END IF;
    parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.curve_id ELSE NEW.curve_id END;
    SELECT status INTO parent_status FROM market.curve WHERE id = parent_id FOR SHARE;
    IF parent_status IS DISTINCT FROM 'loading' THEN
        RAISE EXCEPTION 'Only loading curves accept point changes' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_point BEFORE INSERT OR UPDATE OR DELETE ON market.curve_point FOR EACH ROW EXECUTE FUNCTION app.guard_curve_point();

CREATE FUNCTION app.guard_methodology() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Published methodology is immutable' USING ERRCODE = '23514'; END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status <> 'draft' AND ((to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') OR NEW.status <> 'retired') THEN
            RAISE EXCEPTION 'Published methodology content is immutable' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF NEW.status <> 'draft' THEN
        PERFORM id FROM ref.bucket_set WHERE id = NEW.bucket_set_id FOR UPDATE;
        IF NOT EXISTS (SELECT 1 FROM ref.time_bucket WHERE bucket_set_id = NEW.bucket_set_id) THEN
            RAISE EXCEPTION 'Published methodology requires a populated bucket grid' USING ERRCODE = '23514';
        END IF;
        IF NEW.floor_mode = 'by_bucket' AND EXISTS (
            SELECT 1 FROM ref.time_bucket b WHERE b.bucket_set_id = NEW.bucket_set_id
            AND jsonb_typeof(NEW.floor_params->b.bucket_no::text) IS DISTINCT FROM 'number'
        ) THEN
            RAISE EXCEPTION 'Floor must be specified for every bucket' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_methodology BEFORE INSERT OR UPDATE OR DELETE ON app.methodology_version FOR EACH ROW EXECUTE FUNCTION app.guard_methodology();

CREATE FUNCTION app.guard_scenario() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Scenario versions are immutable' USING ERRCODE = '23514'; END IF;
    IF (to_jsonb(NEW) - 'is_active') IS DISTINCT FROM (to_jsonb(OLD) - 'is_active') THEN
        RAISE EXCEPTION 'Scenario content is immutable; create a new version' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_scenario BEFORE UPDATE OR DELETE ON app.scenario FOR EACH ROW EXECUTE FUNCTION app.guard_scenario();

CREATE FUNCTION app.guard_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'validated' THEN RAISE EXCEPTION 'Validated snapshot is immutable' USING ERRCODE = '23514'; END IF;
        RETURN OLD;
    END IF;
    IF (to_jsonb(NEW) - ARRAY['status', 'validation_errors']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'validation_errors']) OR OLD.status = 'validated' THEN
        RAISE EXCEPTION 'Snapshot input is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_snapshot BEFORE UPDATE OR DELETE ON app.portfolio_snapshot FOR EACH ROW EXECUTE FUNCTION app.guard_snapshot();

CREATE FUNCTION app.guard_instrument() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id bigint;
parent_status text;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.snapshot_id <> OLD.snapshot_id THEN RAISE EXCEPTION 'Cannot move an instrument' USING ERRCODE = '23514'; END IF;
    parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.snapshot_id ELSE NEW.snapshot_id END;
    SELECT status INTO parent_status FROM app.portfolio_snapshot WHERE id = parent_id FOR SHARE;
    IF parent_status IS DISTINCT FROM 'uploaded' THEN RAISE EXCEPTION 'Snapshot no longer accepts input changes' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_instrument BEFORE INSERT OR UPDATE OR DELETE ON app.instrument FOR EACH ROW EXECUTE FUNCTION app.guard_instrument();

CREATE FUNCTION app.guard_cashflow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
parent_id bigint;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.instrument_id <> OLD.instrument_id THEN RAISE EXCEPTION 'Cannot move a cash flow' USING ERRCODE = '23514'; END IF;
    parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.instrument_id ELSE NEW.instrument_id END;
    SELECT s.status INTO parent_status FROM app.portfolio_snapshot s JOIN app.instrument i ON i.snapshot_id = s.id WHERE i.id = parent_id FOR SHARE OF s, i;
    IF parent_status IS DISTINCT FROM 'uploaded' THEN RAISE EXCEPTION 'Snapshot no longer accepts cash flow changes' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_cashflow BEFORE INSERT OR UPDATE OR DELETE ON app.instrument_cashflow FOR EACH ROW EXECUTE FUNCTION app.guard_cashflow();

CREATE FUNCTION app.guard_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lifecycle text[] := ARRAY['status', 'attempt', 'claimed_by', 'heartbeat_at', 'started_at', 'finished_at', 'error_message', 'engine_version', 'ec_irrbb', 'worst_scenario_id'];
parent_status text;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Calculation runs cannot be deleted' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - lifecycle) IS DISTINCT FROM (to_jsonb(OLD) - lifecycle) THEN RAISE EXCEPTION 'Calculation inputs are immutable' USING ERRCODE = '23514'; END IF;
        IF OLD.status IN ('succeeded', 'cancelled') THEN RAISE EXCEPTION 'Completed calculation is immutable' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF NEW.status <> 'pending' THEN RAISE EXCEPTION 'New calculation must be pending' USING ERRCODE = '23514'; END IF;
    IF TG_TABLE_NAME = 'curve_run' THEN
        SELECT status INTO parent_status FROM app.methodology_version WHERE id = NEW.methodology_id FOR SHARE;
        IF parent_status IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'Calculation requires a ready methodology' USING ERRCODE = '23514'; END IF;
        SELECT status INTO parent_status FROM market.curve WHERE id = NEW.curve_id FOR SHARE;
        IF parent_status IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'Calculation requires an accepted curve' USING ERRCODE = '23514'; END IF;
    ELSE
        SELECT status INTO parent_status FROM calc.curve_run WHERE id = NEW.curve_run_id FOR SHARE;
        IF parent_status IS DISTINCT FROM 'succeeded' THEN RAISE EXCEPTION 'Portfolio calculation requires completed curves' USING ERRCODE = '23514'; END IF;
        SELECT status INTO parent_status FROM app.portfolio_snapshot WHERE id = NEW.portfolio_snapshot_id FOR SHARE;
        IF parent_status IS DISTINCT FROM 'validated' THEN RAISE EXCEPTION 'Portfolio calculation requires validated inputs' USING ERRCODE = '23514'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_run BEFORE INSERT OR UPDATE OR DELETE ON calc.curve_run FOR EACH ROW EXECUTE FUNCTION app.guard_run();
CREATE TRIGGER protect_run BEFORE INSERT OR UPDATE OR DELETE ON calc.portfolio_run FOR EACH ROW EXECUTE FUNCTION app.guard_run();

CREATE FUNCTION app.guard_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb;
parent_status text;
parent_id bigint;
expected_currency text;
BEGIN
    row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    IF TG_OP = 'UPDATE' AND (to_jsonb(OLD)->>TG_ARGV[1]) IS DISTINCT FROM (to_jsonb(NEW)->>TG_ARGV[1]) THEN RAISE EXCEPTION 'Cannot move a result between runs' USING ERRCODE = '23514'; END IF;
    parent_id := (row_data->>TG_ARGV[1])::bigint;
    EXECUTE format('SELECT status FROM calc.%I WHERE id = $1 FOR SHARE', TG_ARGV[0]) INTO parent_status USING parent_id;
    IF parent_status IS NULL OR parent_status NOT IN ('pending', 'running') THEN RAISE EXCEPTION 'Calculation does not accept result changes' USING ERRCODE = '23514'; END IF;
    IF TG_TABLE_NAME = 'run_scenario' AND parent_status <> 'pending' THEN RAISE EXCEPTION 'Scenario selection is frozen after start' USING ERRCODE = '23514'; END IF;
    IF TG_TABLE_NAME IN ('scenario_result', 'bucket_result') AND TG_OP <> 'DELETE' THEN
        SELECT c.currency_code INTO expected_currency FROM calc.curve_run r JOIN market.curve c ON c.id = r.curve_id WHERE r.id = (row_data->>'curve_run_id')::bigint;
        IF row_data->>'currency_code' IS DISTINCT FROM expected_currency THEN RAISE EXCEPTION 'Result currency does not match its curve' USING ERRCODE = '23514'; END IF;
    END IF;
    IF TG_TABLE_NAME = 'instrument_result' AND TG_OP <> 'DELETE' THEN
        SELECT c.currency_code INTO expected_currency FROM calc.curve_run r JOIN market.curve c ON c.id = r.curve_id WHERE r.id = (row_data->>'curve_run_id')::bigint;
        IF NOT EXISTS (SELECT 1 FROM app.instrument WHERE id = (row_data->>'instrument_id')::bigint AND currency_code = expected_currency) THEN RAISE EXCEPTION 'Instrument currency does not match its curve' USING ERRCODE = '23514'; END IF;
    END IF;
    IF TG_TABLE_NAME = 'scenario_result' AND TG_OP <> 'DELETE' AND row_data->>'nii' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM calc.portfolio_run WHERE id = parent_id AND nii_horizon_years IS NOT NULL) THEN RAISE EXCEPTION 'NII requires an explicit horizon' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_result BEFORE INSERT OR UPDATE OR DELETE ON calc.run_scenario FOR EACH ROW EXECUTE FUNCTION app.guard_result('curve_run', 'curve_run_id');
CREATE TRIGGER protect_result BEFORE INSERT OR UPDATE OR DELETE ON calc.base_curve_point FOR EACH ROW EXECUTE FUNCTION app.guard_result('curve_run', 'curve_run_id');
CREATE TRIGGER protect_result BEFORE INSERT OR UPDATE OR DELETE ON calc.base_point_source FOR EACH ROW EXECUTE FUNCTION app.guard_result('curve_run', 'curve_run_id');
CREATE TRIGGER protect_result BEFORE INSERT OR UPDATE OR DELETE ON calc.stressed_curve_point FOR EACH ROW EXECUTE FUNCTION app.guard_result('curve_run', 'curve_run_id');
CREATE TRIGGER protect_result BEFORE INSERT OR UPDATE OR DELETE ON calc.scenario_result FOR EACH ROW EXECUTE FUNCTION app.guard_result('portfolio_run', 'portfolio_run_id');
CREATE TRIGGER protect_result BEFORE INSERT OR UPDATE OR DELETE ON calc.bucket_result FOR EACH ROW EXECUTE FUNCTION app.guard_result('portfolio_run', 'portfolio_run_id');
CREATE TRIGGER protect_result BEFORE INSERT OR UPDATE OR DELETE ON calc.instrument_result FOR EACH ROW EXECUTE FUNCTION app.guard_result('portfolio_run', 'portfolio_run_id');

CREATE FUNCTION app.require_base_scenario() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_id bigint;
row_data jsonb;
BEGIN
    row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    run_id := CASE WHEN TG_TABLE_NAME = 'curve_run' THEN (row_data->>'id')::bigint ELSE (row_data->>'curve_run_id')::bigint END;
    IF EXISTS (SELECT 1 FROM calc.curve_run WHERE id = run_id) AND NOT EXISTS (SELECT 1 FROM calc.run_scenario rs JOIN app.scenario s ON s.id = rs.scenario_id WHERE rs.curve_run_id = run_id AND s.shift_type = 'base') THEN
        RAISE EXCEPTION 'Curve calculation must include the base scenario' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER require_base AFTER INSERT OR UPDATE ON calc.curve_run DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.require_base_scenario();
CREATE CONSTRAINT TRIGGER require_base AFTER INSERT OR UPDATE OR DELETE ON calc.run_scenario DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.require_base_scenario();

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['ref.bucket_set', 'ref.time_bucket', 'market.curve', 'market.curve_point', 'app.methodology_version', 'app.scenario', 'app.portfolio_snapshot', 'app.instrument', 'app.instrument_cashflow', 'audit.audit_log', 'calc.curve_run', 'calc.portfolio_run', 'calc.run_scenario', 'calc.base_curve_point', 'calc.base_point_source', 'calc.stressed_curve_point', 'calc.scenario_result', 'calc.bucket_result', 'calc.instrument_result'] LOOP
        EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION app.reject_change()', table_name);
    END LOOP;
END;
$$;

CREATE VIEW mart.v_latest_curve AS
SELECT DISTINCT ON (source, curve_code, currency_code, curve_date) id, source, curve_code, currency_code, curve_date, revision, loaded_at
FROM market.curve WHERE status = 'accepted'
ORDER BY source, curve_code, currency_code, curve_date, revision DESC;
CREATE VIEW mart.v_curve AS
SELECT c.id AS curve_id, c.source, c.curve_code, c.currency_code, c.curve_date, c.revision, c.loaded_at, p.point_no, p.tenor_years, p.rate_pct
FROM market.curve c JOIN market.curve_point p ON p.curve_id = c.id WHERE c.status = 'accepted';
CREATE VIEW mart.v_stressed_curve AS
SELECT r.id AS curve_run_id, r.status, r.curve_id, r.methodology_id, r.bucket_set_id, s.id AS scenario_id, s.code AS scenario_code, s.version_no AS scenario_version, b.bucket_no, b.label, b.tenor_years,
       p.rate_pct AS base_rate_pct, p.value_source, p.exp_factor, p.one_minus_exp_factor, p.floor_pct, v.shift_pp, v.rate_before_floor_pct, v.rate_pct
FROM calc.stressed_curve_point v JOIN calc.curve_run r ON r.id = v.curve_run_id JOIN app.scenario s ON s.id = v.scenario_id
JOIN ref.time_bucket b ON b.bucket_set_id = r.bucket_set_id AND b.bucket_no = v.bucket_no
JOIN calc.base_curve_point p ON p.curve_run_id = r.id AND p.bucket_no = v.bucket_no;
CREATE VIEW mart.v_run_summary AS
SELECT id AS portfolio_run_id, curve_run_id, portfolio_snapshot_id, reporting_date, status, nii_horizon_years, ec_formula, ec_irrbb, worst_scenario_id, created_at, started_at, finished_at
FROM calc.portfolio_run;
CREATE VIEW mart.v_scenario_result AS SELECT * FROM calc.scenario_result;
CREATE VIEW mart.v_instrument_result AS SELECT * FROM calc.instrument_result;
DO $$
DECLARE view_name text;
BEGIN
    FOREACH view_name IN ARRAY ARRAY['v_latest_curve', 'v_curve', 'v_stressed_curve', 'v_run_summary', 'v_scenario_result', 'v_instrument_result'] LOOP
        EXECUTE format('CREATE TRIGGER read_only INSTEAD OF INSERT OR UPDATE OR DELETE ON mart.%I FOR EACH ROW EXECUTE FUNCTION app.reject_change()', view_name);
    END LOOP;
END;
$$;
