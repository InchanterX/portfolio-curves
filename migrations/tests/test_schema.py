import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSIONS = ROOT / "src/curves_migrations/alembic/versions"


def normalize(value: str) -> str:
    """Normalize identifier quoting and layout for structural comparisons."""
    return re.sub(r'[\s"`()]+', "", value).lower()


def schema_sources() -> tuple[str, str]:
    """Read table definitions and the corresponding human-readable DBML."""
    sql = "\n".join(
        (VERSIONS / name).read_text(encoding="utf-8")
        for name in ["0001_inputs.sql", "0002_calculations.sql"]
    )
    return sql, (ROOT / "docs/schema.dbml").read_text(encoding="utf-8")


def test_dbml_tables_columns_and_defaults():
    """Keep every documented column, type, nullability and default aligned with SQL."""
    sql, dbml = schema_sources()
    sql_tables = dict(re.findall(r"CREATE TABLE ([\w.]+) \(\n(.*?)\n\);", sql, re.S))
    dbml_tables = {
        f"{schema}.{table}": body
        for schema, table, body in re.findall(
            r'^Table "(\w+)"\."(\w+)" \{\n(.*?)^\}', dbml, re.S | re.M
        )
    }
    assert sql_tables.keys() == dbml_tables.keys()
    for name, body in sql_tables.items():
        sql_columns = {}
        for column, kind, settings in re.findall(
            r"^    ([a-z_][a-z0-9_]*) ([a-z]+(?:\([\d,]+\))?)([^\n]*)", body, re.M
        ):
            default = re.search(r"DEFAULT ([^,\n]+)", settings)
            sql_columns[column] = (
                kind,
                "NOT NULL" in settings or "IDENTITY" in settings,
                "IDENTITY" in settings,
                normalize(default[1]) if default else None,
            )
        dbml_columns = {}
        for column, kind, settings in re.findall(
            r'^  "(\w+)" ([a-z]+(?:\([\d,]+\))?)([^\n]*)', dbml_tables[name], re.M
        ):
            default = re.search(r"default: ([^\]]+)", settings)
            dbml_columns[column] = (
                kind,
                "not null" in settings,
                "increment" in settings,
                normalize(default[1]) if default else None,
            )
        assert sql_columns == dbml_columns, name


def test_dbml_keys_indexes_and_checks():
    """Preserve named keys, conditional uniqueness, indexes and check constraints."""
    sql, dbml = schema_sources()
    sql_indexes = {
        name: (kind == "PRIMARY KEY", True, normalize(columns))
        for name, kind, columns in re.findall(
            r"CONSTRAINT (\w+) (PRIMARY KEY|UNIQUE) \(([^)]+)\)", sql
        )
    }
    for unique, name, columns in re.findall(
        r"CREATE (UNIQUE )?INDEX (\w+) ON [\w.]+\((.*)\);", sql
    ):
        sql_indexes[name] = (False, bool(unique), normalize(columns))
    dbml_indexes = {}
    for block in re.findall(r"  Indexes \{\n(.*?)\n  \}", dbml, re.S):
        for columns, settings, name in re.findall(
            r'^    (.*?) \[(.*?)name: "(\w+)"\]', block, re.M
        ):
            dbml_indexes[name] = (
                "pk" in settings,
                "unique" in settings or "pk" in settings,
                normalize(columns),
            )
    assert sql_indexes == dbml_indexes
    assert set(re.findall(r"CONSTRAINT (\w+) CHECK", sql)) == set(
        re.findall(r"\[name: '(\w+)'\]", dbml)
    )


def test_dbml_foreign_keys():
    """Match named relationships and ordered composite key columns to SQL."""
    sql, dbml = schema_sources()
    sql_refs = {}
    for table, body in re.findall(r"CREATE TABLE ([\w.]+) \(\n(.*?)\n\);", sql, re.S):
        for name, columns, parent, parent_columns in re.findall(
            r"CONSTRAINT (\w+) FOREIGN KEY \(([^)]+)\) REFERENCES ([\w.]+)\(([^)]+)\)",
            body,
        ):
            sql_refs[name] = (
                table,
                normalize(columns),
                parent,
                normalize(parent_columns),
            )
    dbml_refs = {}
    for (
        name,
        parent_schema,
        parent,
        parent_columns,
        schema,
        table,
        columns,
    ) in re.findall(
        r'^Ref "(\w+)":"(\w+)"\."(\w+)"\.(.*?) < "(\w+)"\."(\w+)"\.(.*?)$', dbml, re.M
    ):
        dbml_refs[name] = (
            f"{schema}.{table}",
            normalize(columns),
            f"{parent_schema}.{parent}",
            normalize(parent_columns),
        )
    assert sql_refs == dbml_refs


def test_dbml_contains_no_comments_or_views():
    """Keep the diagram limited to documented tables without explanatory comments."""
    _, dbml = schema_sources()
    assert not re.search(r"//|/\*|\bNote\b|Table \"mart\"", dbml)
