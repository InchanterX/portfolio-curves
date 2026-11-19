from .errors import APIError, missing
from . import schemas as dto


class DataService:
    def __init__(self, repo, user):
        self.repo, self.user = repo, user

    def scope(self, kind):
        if kind == 'scenarios':
            return '(is_predefined OR created_by_user_id = %s)', [self.user['id']]
        if kind == 'methods':
            return "(status = 'ready' OR created_by_user_id = %s)", [self.user['id']]
        if kind == 'runs':
            return 'created_by_user_id = %s', [self.user['id']]
        return None

    def visible(self, kind, row):
        own = row.get('created_by_user_id') == self.user['id']
        if ((kind == 'runs' and not own)
            or (kind == 'scenarios' and not own and not row['is_predefined'])
            or (kind == 'methods' and not own and row['status'] != 'ready')):
            missing()
        return row

    def get(self, kind, entity_id):
        return self.visible(kind, self.repo.get(kind, entity_id))

    def page(self, kind, filters, limit, offset, sort, descending):
        return self.repo.page(kind, filters, self.scope(kind), limit, offset, sort, descending)

    def curve_detail(self, entity_id):
        row = self.get('curves', entity_id)
        row['points'] = self.repo.all('SELECT * FROM market.curve_point WHERE curve_id=%s '
                                     'ORDER BY point_no', (entity_id,))
        row['ingestion'] = self.repo.one('SELECT id,source,status,started_at,finished_at '
                                         'FROM market.ingestion_batch WHERE id=%s',
                                         (row['ingestion_batch_id'],))
        return row

    def curve_payload(self, entity_id):
        self.get('curves', entity_id)
        return self.repo.one('SELECT payload,payload_sha256 FROM market.curve WHERE id=%s', (entity_id,))

    def method_detail(self, entity_id):
        row = self.get('methods', entity_id)
        row['bucket_set'] = self.repo.bucket_detail(row['bucket_set_id'])
        return row

    def editor(self):
        if self.user['role'] != 'editor':
            raise APIError(403, 'forbidden', 'Editor role required')

    def validate_scenario(self, values):
        if values['shift_type'] == 'custom_by_bucket':
            # DBML only requires an object; its semantics are not yet specified.
            raise APIError(409, 'scenario_contract_pending',
                           'custom_by_bucket parameter contract requires agreement with the calculation team')
        if values.get('params') is not None:
            raise APIError(409, 'scenario_contract_pending',
                           'Scenario parameter contract is not configured; use methodology parameters')

    def create(self, kind, data):
        self.editor()
        values = data.model_dump()
        if kind == 'methods':
            self.repo.get('buckets', values['bucket_set_id'])
        else:
            self.validate_scenario(values)
        # Initial versions only. New versions of an existing code need a versioning policy.
        self.repo.one('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',
                      (kind + ':' + values['code'],))
        if values['version_no'] != 1:
            raise APIError(409, 'version_policy_pending', 'Only initial version 1 is enabled')
        from psycopg import sql
        if self.repo.one(sql.SQL('SELECT id FROM {} WHERE code=%s LIMIT 1').format(self.repo.table(kind)),
                         (values['code'],)):
            raise APIError(409, 'version_exists', 'Code already exists; versioning policy requires agreement')
        values.update(created_by=f"user:{self.user['id']}", created_by_user_id=self.user['id'])
        row = self.repo.insert(kind, values)
        self.repo.audit(self.user, 'create', kind, row['id'], data.model_fields_set)
        return row

    def patch(self, kind, entity_id, data):
        self.editor()
        row = self.visible(kind, self.repo.get(kind, entity_id, lock=True))
        if row['created_by_user_id'] != self.user['id']:
            raise APIError(403, 'forbidden', 'Only the author may edit')
        if kind == 'methods' and row['status'] != 'draft':
            raise APIError(409, 'immutable_methodology', 'Only unused drafts may be edited')
        if kind == 'scenarios' and (row['is_predefined'] or not row['is_active']):
            raise APIError(409, 'immutable_scenario', 'Predefined or inactive scenarios cannot be edited')
        query = ('SELECT id FROM calc.curve_run WHERE methodology_id=%s LIMIT 1' if kind == 'methods'
                 else 'SELECT curve_run_id FROM calc.run_scenario WHERE scenario_id=%s LIMIT 1')
        if self.repo.one(query, (entity_id,)):
            raise APIError(409, 'entity_in_use', 'An entity referenced by a calculation is immutable')
        values = data.model_dump(exclude_unset=True)
        merged = {**row, **values}
        if kind == 'methods':
            # Validate the merged model, including explicit NULL for non-nullable fields.
            dto.MethodCreate.model_validate({k: merged[k] for k in dto.MethodCreate.model_fields})
            self.repo.get('buckets', merged['bucket_set_id'])
        else:
            dto.ScenarioCreate.model_validate({k: merged[k] for k in dto.ScenarioCreate.model_fields})
            self.validate_scenario(merged)
        result = self.repo.patch(kind, entity_id, values)
        if values:
            self.repo.audit(self.user, 'update', kind, entity_id, values)
        return result

    def run_detail(self, entity_id):
        row = self.get('runs', entity_id)
        # Associated historical definitions belong to this authorized run, even if now retired.
        row['curve'] = self.repo.get('curves', row['curve_id'])
        row['methodology'] = self.repo.get('methods', row['methodology_id'])
        if row['methodology']['bucket_set_id'] != row['bucket_set_id']:
            raise APIError(409, 'inconsistent_run', 'Run and methodology bucket sets do not match')
        row['bucket_set'] = self.repo.bucket_detail(row['bucket_set_id'])
        row['scenarios'] = self.repo.all('SELECT s.* FROM app.scenario s JOIN calc.run_scenario rs '
                                        'ON s.id=rs.scenario_id WHERE rs.curve_run_id=%s ORDER BY s.id',
                                        (entity_id,))
        return row

    def run_results(self, entity_id):
        row = self.get('runs', entity_id)
        if row['status'] != 'succeeded':
            raise APIError(409, 'results_unavailable', f"Run status is {row['status']}")
        points = self.repo.all('SELECT * FROM calc.base_curve_point WHERE curve_run_id=%s '
                               'ORDER BY bucket_no', (entity_id,))
        sources = self.repo.all('SELECT b.bucket_no, b.point_no, b.weight, p.tenor_years, p.rate_pct '
                                'FROM calc.base_point_source b JOIN market.curve_point p '
                                'ON (p.curve_id,p.point_no)=(b.curve_id,b.point_no) '
                                'WHERE b.curve_run_id=%s ORDER BY b.bucket_no,b.point_no', (entity_id,))
        by_bucket = {}
        for source in sources:
            by_bucket.setdefault(source.pop('bucket_no'), []).append(source)
        for point in points:
            point['sources'] = by_bucket.get(point['bucket_no'], [])
        buckets = self.repo.bucket_detail(row['bucket_set_id'])
        if {p['bucket_no'] for p in points} != {b['bucket_no'] for b in buckets['buckets']}:
            raise APIError(409, 'incomplete_results', 'Succeeded run has incomplete base points')
        stressed = self.repo.all('SELECT * FROM calc.stressed_curve_point WHERE curve_run_id=%s '
                                 'ORDER BY scenario_id,bucket_no', (entity_id,))
        scenarios = self.repo.all('SELECT scenario_id FROM calc.run_scenario WHERE curve_run_id=%s', (entity_id,))
        expected = {(s['scenario_id'], b['bucket_no']) for s in scenarios for b in buckets['buckets']}
        if {(p['scenario_id'], p['bucket_no']) for p in stressed} != expected:
            raise APIError(409, 'incomplete_results', 'Succeeded run has incomplete stressed points')
        return dict(run_id=entity_id, bucket_set=buckets, base_points=points, stressed_points=stressed)

