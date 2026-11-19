from contextlib import contextmanager

from psycopg.rows import dict_row
from psycopg.types.json import set_json_loads
from psycopg_pool import ConnectionPool
from .json_codec import decode_json


def configure_connection(conn):
    # Keep numbers inside JSONB exact as well as NUMERIC columns.
    set_json_loads(decode_json, conn)


class Database:
    def __init__(self, dsn):
        self.pool = ConnectionPool(dsn, min_size=0, max_size=8, open=False,
                                   timeout=5, kwargs={'row_factory': dict_row,
                                   'connect_timeout': 5, 'options': '-c statement_timeout=10000 -c timezone=UTC'},
                                   configure=configure_connection)

    def open(self):
        self.pool.open()

    def close(self):
        self.pool.close()

    @contextmanager
    def transaction(self):
        with self.pool.connection() as conn:
            with conn.transaction():
                conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
                yield conn
