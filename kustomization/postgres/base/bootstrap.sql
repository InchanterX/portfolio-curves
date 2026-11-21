\set ON_ERROR_STOP on
\set ECHO none
\getenv migrator_password MIGRATOR_PASSWORD
\getenv collector_password COLLECTOR_PASSWORD
\getenv reader_password READER_PASSWORD
\getenv app_password METABASE_PASSWORD
SELECT format('CREATE ROLE %I LOGIN', name)
FROM (VALUES ('curves_migrator'), ('curves_collector'), ('metabase_reader'), ('metabase_app')) AS roles(name)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = name) \gexec
SELECT format('ALTER ROLE curves_migrator PASSWORD %L', :'migrator_password') \gexec
SELECT format('ALTER ROLE curves_collector PASSWORD %L', :'collector_password') \gexec
SELECT format('ALTER ROLE metabase_reader PASSWORD %L', :'reader_password') \gexec
SELECT format('ALTER ROLE metabase_app PASSWORD %L', :'app_password') \gexec
SELECT 'CREATE DATABASE metabase_app OWNER metabase_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'metabase_app') \gexec
REVOKE ALL ON DATABASE metabase_app FROM PUBLIC;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE metabase_app TO metabase_app;
REVOKE CONNECT ON DATABASE curves_db FROM PUBLIC;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE curves_db TO curves_migrator;
GRANT CONNECT ON DATABASE curves_db TO metabase_reader, curves_collector;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO curves_migrator;
-- Only transfer objects managed by this project's migrations, never all admin objects.
DO $$
DECLARE obj record;
BEGIN
    FOR obj IN SELECT nspname FROM pg_namespace
        WHERE nspname IN ('ref','market','app','calc','audit','mart','auth')
    LOOP
        EXECUTE format('ALTER SCHEMA %I OWNER TO curves_migrator', obj.nspname);
    END LOOP;
    FOR obj IN SELECT n.nspname, c.relname, c.relkind
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE (n.nspname IN ('ref','market','app','calc','audit','mart','auth')
            OR (n.nspname = 'public' AND c.relname IN ('alembic_version','deals')))
            AND c.relkind IN ('r','p','v','m')
            AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = 'curves_migrator')
    LOOP
        EXECUTE format('ALTER %s %I.%I OWNER TO curves_migrator',
            CASE obj.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
            obj.nspname, obj.relname);
    END LOOP;
    FOR obj IN SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('ref','market','app','calc','audit','mart','auth') AND p.prokind = 'f'
    LOOP
        EXECUTE format('ALTER FUNCTION %I.%I(%s) OWNER TO curves_migrator', obj.nspname, obj.proname, obj.args);
    END LOOP;
END $$;
