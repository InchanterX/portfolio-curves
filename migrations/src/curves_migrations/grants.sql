GRANT CONNECT ON DATABASE curves_db TO metabase_reader,
curves_collector;

GRANT USAGE ON SCHEMA ref,
market,
app,
calc,
mart,
public TO metabase_reader;

GRANT
SELECT
    ON ALL TABLES IN SCHEMA ref,
    market,
    app,
    calc,
    mart TO metabase_reader;

GRANT
SELECT
    ON public.deals TO metabase_reader;

GRANT USAGE ON SCHEMA market TO curves_collector;

GRANT
SELECT
,
INSERT
,
UPDATE ON ALL TABLES IN SCHEMA market TO curves_collector;

GRANT USAGE,
SELECT
    ON ALL SEQUENCES IN SCHEMA market TO curves_collector;

ALTER DEFAULT PRIVILEGES FOR ROLE curves_migrator IN SCHEMA ref,
market,
app,
calc,
mart
GRANT
SELECT
    ON TABLES TO metabase_reader;

ALTER DEFAULT PRIVILEGES FOR ROLE curves_migrator IN SCHEMA market
GRANT
SELECT
,
INSERT
,
UPDATE ON TABLES TO curves_collector;

ALTER DEFAULT PRIVILEGES FOR ROLE curves_migrator IN SCHEMA market
GRANT USAGE,
SELECT
    ON SEQUENCES TO curves_collector;