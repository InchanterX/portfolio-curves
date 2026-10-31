from alembic import context


def run_migrations() -> None:
    """Apply each revision transactionally using the caller-owned connection."""
    connection = context.config.attributes.get("connection")
    if connection is None:
        raise RuntimeError("Use curves-migrate to run migrations with a session lock")
    context.configure(
        connection=connection,
        version_table_schema="public",
        transaction_per_migration=True,
        include_schemas=True,
    )
    with context.begin_transaction():
        context.run_migrations()


run_migrations()
