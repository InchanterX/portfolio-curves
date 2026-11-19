"""Parameterized PostgreSQL queries. Identifiers come only from server-owned metadata."""
from psycopg import sql
from psycopg.types.json import Jsonb
import simplejson

from . import schemas as dto
from .errors import missing

TABLES = {
    'buckets': ('ref', 'bucket_set', dto.BucketSet),
    'curves': ('market', 'curve', dto.Curve),
    'methods': ('app', 'methodology_version', dto.Methodology),
    'scenarios': ('app', 'scenario', dto.Scenario),
    'runs': ('calc', 'curve_run', dto.Run),
}
USER_COLUMNS = ', '.join(dto.User.model_fields)
SESSION_COLUMNS = ', '.join(dto.Session.model_fields)


def json_value(value):
    return Jsonb(value, dumps=lambda v: simplejson.dumps(v, use_decimal=True))


class Repository:
    def __init__(self, conn):
        self.conn = conn

    def one(self, query, args=()):
        return self.conn.execute(query, args).fetchone()

    def all(self, query, args=()):
        return self.conn.execute(query, args).fetchall()

    @staticmethod
    def table(kind):
        schema, name, _ = TABLES[kind]
        return sql.Identifier(schema, name)

    @staticmethod
    def columns(kind):
        return sql.SQL(', ').join(map(sql.Identifier, TABLES[kind][2].model_fields))

    def get(self, kind, entity_id, lock=False):
        result = self.one(sql.SQL('SELECT {} FROM {} WHERE id = %s {}').format(
            self.columns(kind), self.table(kind), sql.SQL('FOR UPDATE' if lock else '')),
            (entity_id,))
        if result is None:
            missing()
        return result

    def page(self, kind, filters, scope, limit, offset, sort, descending):
        allowed_sorts = {
            'buckets': {'id', 'code', 'version_no'},
            'curves': {'id', 'curve_date', 'revision', 'loaded_at'},
            'methods': {'id', 'code', 'version_no', 'created_at'},
            'scenarios': {'id', 'code', 'version_no', 'created_at'},
            'runs': {'id', 'created_at', 'reporting_date'},
        }
        from .errors import APIError
        if sort not in allowed_sorts[kind]:
            raise APIError(422, 'invalid_sort', 'Unsupported sort field')
        conditions, values = [], []
        for key, value in filters.items():
            if value is not None:
                assert key in TABLES[kind][2].model_fields
                conditions.append(sql.SQL('{} = %s').format(sql.Identifier(key)))
                values.append(value)
        if scope:
            condition, args = scope
            conditions.append(sql.SQL(condition))
            values.extend(args)
        where = sql.SQL(' AND ').join(conditions) if conditions else sql.SQL('TRUE')
        count = self.one(sql.SQL('SELECT count(*) AS total FROM {} WHERE {}').format(
            self.table(kind), where), values)['total']
        items = self.all(sql.SQL('SELECT {} FROM {} WHERE {} ORDER BY {} {}, id {} LIMIT %s OFFSET %s').format(
            self.columns(kind), self.table(kind), where, sql.Identifier(sort),
            sql.SQL('DESC' if descending else 'ASC'), sql.SQL('DESC' if descending else 'ASC')),
            [*values, limit, offset])
        return dict(items=items, total=count, limit=limit, offset=offset)

    def insert(self, kind, values):
        values = {k: json_value(v) if k in {'params', 'floor_params'} and v is not None else v
                  for k, v in values.items()}
        return self.one(sql.SQL('INSERT INTO {} ({}) VALUES ({}) RETURNING {}').format(
            self.table(kind), sql.SQL(', ').join(map(sql.Identifier, values)),
            sql.SQL(', ').join(sql.Placeholder() for _ in values), self.columns(kind)),
            list(values.values()))

    def patch(self, kind, entity_id, values):
        values = {k: json_value(v) if k in {'params', 'floor_params'} and v is not None else v
                  for k, v in values.items()}
        if not values:
            return self.get(kind, entity_id)
        return self.one(sql.SQL('UPDATE {} SET {} WHERE id = %s RETURNING {}').format(
            self.table(kind), sql.SQL(', ').join(sql.SQL('{} = %s').format(sql.Identifier(k))
                                                for k in values), self.columns(kind)),
            [*values.values(), entity_id])

    def audit(self, user, action, kind, entity_id, changed_fields=()):
        # Field names only; never copy request bodies, passwords or tokens into the log.
        self.conn.execute('INSERT INTO audit.audit_log '
                          '(actor, actor_user_id, action, entity_type, entity_id, details) '
                          'VALUES (%s, %s, %s, %s, %s, %s)',
                          (f"user:{user['id']}", user['id'], action, kind, entity_id,
                           json_value({'changed_fields': sorted(changed_fields)})))

    def bucket_detail(self, entity_id):
        result = self.get('buckets', entity_id)
        result['buckets'] = self.all('SELECT * FROM ref.time_bucket WHERE bucket_set_id = %s '
                                     'ORDER BY bucket_no', (entity_id,))
        return result
