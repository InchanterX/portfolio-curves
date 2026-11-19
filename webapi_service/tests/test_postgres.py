"""Real PostgreSQL tests. Never initialize, truncate or migrate an arbitrary DSN.

Start compose.test.yaml first. Each test uses a rollback-only transaction and
each HTTP request a nested savepoint. Fixtures are synthetic test data only.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import os
import uuid

import pytest

psycopg = pytest.importorskip('psycopg', reason='Install requirements-dev.txt for PostgreSQL tests')
pytest.importorskip('simplejson')
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row
from fastapi.testclient import TestClient

from webapi.config import Settings
from webapi.db import configure_connection
from webapi.main import create_app
from webapi.security import digest, hasher


class RecordingNotifications:
    """Explicit test double injected only in tests; not a production adapter."""
    def __init__(self):
        self.sent = []

    def require_available(self):
        pass

    def send_token(self, email, purpose, token):
        self.sent.append((email, purpose, token))


class RollbackDatabase:
    def __init__(self, conn):
        self.conn = conn

    def open(self):
        pass

    def close(self):
        pass

    @contextmanager
    def transaction(self):
        with self.conn.transaction():
            yield self.conn


@pytest.fixture
def env():
    dsn = os.getenv('TEST_DATABASE_DSN')
    if not dsn:
        pytest.skip('TEST_DATABASE_DSN not set; use dedicated compose.test.yaml')
    info = conninfo_to_dict(dsn)
    if info.get('dbname') != 'curves_webapi_test' or info.get('host') not in {'localhost', '127.0.0.1'}:
        pytest.fail('Integration tests require the explicit local curves_webapi_test database')
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        configure_connection(conn)
        with conn.transaction(force_rollback=True):
            notifications = RecordingNotifications()
            app = create_app(Settings(auth_requests_per_minute=1000), RollbackDatabase(conn), notifications)
            with TestClient(app) as client:
                yield client, conn, notifications


def create_user(conn, role='viewer', status='active'):
    suffix = uuid.uuid4().hex
    user = conn.execute('INSERT INTO auth.user_account '
                        '(email,display_name,password_hash,role,status,email_confirmed_at) '
                        'VALUES (%s,%s,%s,%s,%s,%s) RETURNING id,email',
                        (f'{suffix}@example.org', 'Test', hasher.hash('test password 123'), role, status,
                         datetime.now(timezone.utc) if status == 'active' else None)).fetchone()
    raw = uuid.uuid4().hex + uuid.uuid4().hex
    session = conn.execute('INSERT INTO auth.user_session(user_id,token_hash,expires_at) '
                           "VALUES (%s,%s,now()+interval '1 hour') RETURNING id", (user['id'], digest(raw))).fetchone()
    return user, {'Authorization': f'Bearer {raw}'}, session['id']


def test_registration_confirmation_login_and_logout(env):
    client, conn, mail = env
    body = dict(email='new@example.org', display_name='New', password='strong password 123')
    assert client.post('/api/v1/auth/register', json=body).status_code == 202
    record = conn.execute("SELECT * FROM auth.user_account WHERE email='new@example.org'").fetchone()
    assert record['status'] == 'pending' and record['role'] == 'viewer'
    assert record['password_hash'] != body['password']
    credentials = {k: body[k] for k in ('email', 'password')}
    assert client.post('/api/v1/auth/login', json=credentials).status_code == 403
    token = mail.sent[-1][2]
    assert conn.execute('SELECT token_hash FROM auth.action_token').fetchone()['token_hash'] == digest(token)
    confirm = '/api/v1/auth/email-confirmation/confirm'
    assert client.post(confirm, json={'token': token}).status_code == 200
    assert client.post(confirm, json={'token': token}).status_code == 400
    login = client.post('/api/v1/auth/login', json=credentials)
    assert login.status_code == 200
    assert 'password_hash' not in login.text and 'token_hash' not in login.text
    headers = {'Authorization': 'Bearer ' + login.json()['access_token']}
    assert client.get('/api/v1/users/me', headers=headers).status_code == 200
    assert client.post('/api/v1/auth/logout', headers=headers).status_code == 204
    assert client.get('/api/v1/users/me', headers=headers).status_code == 401
    assert client.post('/api/v1/auth/login', json=credentials | {'password': 'wrong password 123'}).status_code == 401


@pytest.mark.parametrize('mode', ['missing', 'invalid', 'expired', 'revoked', 'disabled', 'pending'])
def test_session_and_account_access(env, mode):
    client, conn, _ = env
    user, headers, session = create_user(conn, status=mode if mode in {'disabled', 'pending'} else 'active')
    if mode == 'missing':
        headers = {}
    elif mode == 'invalid':
        headers = {'Authorization': 'Bearer invalid'}
    elif mode == 'expired':
        conn.execute("UPDATE auth.user_session SET created_at=now()-interval '2 hour', "
                     "expires_at=now()-interval '1 hour' WHERE id=%s", (session,))
    elif mode == 'revoked':
        conn.execute('UPDATE auth.user_session SET revoked_at=now() WHERE id=%s', (session,))
    result = client.get('/api/v1/users/me', headers=headers)
    assert result.status_code == (403 if mode in {'disabled', 'pending'} else 401)
    assert set(result.json()) == {'error'}


def test_password_reset_is_single_use_and_revokes_sessions(env):
    client, conn, mail = env
    user, headers, _ = create_user(conn)
    request_path = '/api/v1/auth/password-reset/request'
    assert client.post(request_path, json={'email': user['email']}).status_code == 202
    token = mail.sent[-1][2]
    assert client.post(request_path, json={'email': 'absent@example.org'}).json() == {'message': 'Request accepted'}
    reset = dict(token=token, password='different password 123')
    confirm = '/api/v1/auth/password-reset/confirm'
    assert client.post(confirm, json=reset).status_code == 200
    assert client.post(confirm, json=reset).status_code == 400
    assert client.get('/api/v1/users/me', headers=headers).status_code == 401
    assert client.post('/api/v1/auth/login', json=dict(email=user['email'], password=reset['password'])).status_code == 200


def test_profile_and_session_ownership(env):
    client, conn, _ = env
    user, headers, session = create_user(conn)
    other, _, other_session = create_user(conn)
    path = '/api/v1/users/me'
    assert client.patch(path, headers=headers, json={'display_name': 'Renamed'}).json()['display_name'] == 'Renamed'
    assert client.patch(path, headers=headers, json={'role': 'editor'}).status_code == 422
    assert client.delete(f'{path}/sessions/{other_session}', headers=headers).status_code == 404
    listed = client.get(f'{path}/sessions', headers=headers).json()
    assert [s['id'] for s in listed['items']] == [session]
    assert 'token_hash' not in str(listed)


def seed_curve(conn):
    suffix = uuid.uuid4().hex
    batch = conn.execute("INSERT INTO market.ingestion_batch(source) VALUES ('TEST') RETURNING id").fetchone()['id']
    curve = conn.execute("INSERT INTO market.curve(ingestion_batch_id,source,curve_code,curve_date,payload,payload_sha256) "
                         "VALUES (%s,'TEST',%s,'2026-11-19','{}',%s) RETURNING id", (batch, suffix, 'a'*64)).fetchone()['id']
    conn.execute("INSERT INTO market.curve_point VALUES (%s,1,1.00000001,12.1234567890)", (curve,))
    return curve


def test_curve_filters_pagination_sort_precision_and_injection(env):
    client, conn, _ = env
    _, headers, _ = create_user(conn)
    curve = seed_curve(conn)
    response = client.get('/api/v1/market/curves?source=TEST&limit=1&sort=curve_date&descending=true', headers=headers)
    assert response.status_code == 200 and response.json()['total'] >= 1
    assert len(response.json()['items']) == 1
    detail = client.get(f'/api/v1/market/curves/{curve}', headers=headers).json()
    assert detail['points'][0]['rate_pct'] == '12.1234567890'
    assert detail['points'][0]['tenor_years'] == '1.00000001'
    assert detail['ingestion']['source'] == 'TEST'
    assert client.get('/api/v1/market/curves', params={'source': "' OR 1=1 --"}, headers=headers).json()['total'] == 0
    assert client.get('/api/v1/market/curves', params={'sort': 'id; DROP TABLE market.curve'}, headers=headers).status_code == 422
    assert client.get('/api/v1/market/curves?limit=101', headers=headers).status_code == 422
    assert client.get('/api/v1/market/curves/999999999', headers=headers).status_code == 404


def seed_buckets(conn):
    bs = conn.execute('INSERT INTO ref.bucket_set(code,version_no,name) VALUES (%s,1,%s) RETURNING id',
                      (uuid.uuid4().hex, 'Test buckets')).fetchone()['id']
    conn.execute("INSERT INTO ref.time_bucket VALUES (%s,2,'2y',1,2,2),(%s,1,'1y',0,1,1)", (bs, bs))
    return bs


def test_draft_crud_conflicts_audit_and_access(env):
    client, conn, _ = env
    user, headers, _ = create_user(conn, role='editor')
    _, viewer_headers, _ = create_user(conn)
    bs = seed_buckets(conn)
    body = dict(code=uuid.uuid4().hex, version_no=1, name='Test', bucket_set_id=bs, x='4.00000000')
    assert client.post('/api/v1/methodologies', headers=viewer_headers, json=body).status_code == 403
    response = client.post('/api/v1/methodologies', headers=headers, json=body)
    assert response.status_code == 201, response.text
    entity_id = response.json()['id']
    assert client.post('/api/v1/methodologies', headers=headers, json=body).status_code == 409
    path = f'/api/v1/methodologies/{entity_id}'
    assert client.get(path, headers=viewer_headers).status_code == 404
    assert client.patch(path, headers=headers, json={'x': '2.12345678'}).json()['x'] == '2.12345678'
    assert client.patch(path, headers=headers, json={'name': None}).status_code == 422
    assert client.get(path, headers=headers).json()['name'] == 'Test'
    assert client.patch(path, headers=headers, json={'status': 'ready'}).status_code == 422
    detail = client.get(path, headers=headers).json()
    assert [b['bucket_no'] for b in detail['bucket_set']['buckets']] == [1, 2]
    assert conn.execute('SELECT count(*) AS n FROM audit.audit_log WHERE entity_id=%s AND entity_type=%s',
                        (entity_id, 'methods')).fetchone()['n'] == 2


def test_scenario_crud_and_predefined_protection(env):
    client, conn, _ = env
    user, headers, _ = create_user(conn, role='editor')
    body = dict(code=uuid.uuid4().hex, version_no=1, name='User scenario', shift_type='parallel_up')
    response = client.post('/api/v1/scenarios', json=body, headers=headers)
    assert response.status_code == 201, response.text
    scenario = response.json()['id']
    path = f'/api/v1/scenarios/{scenario}'
    assert client.patch(path, json={'name': 'Updated'}, headers=headers).status_code == 200
    assert client.post('/api/v1/scenarios', json=body, headers=headers).status_code == 409
    assert client.post('/api/v1/scenarios', json=body | {'code': uuid.uuid4().hex, 'shift_type': 'custom_by_bucket', 'params': {}}, headers=headers).status_code == 409
    conn.execute('UPDATE app.scenario SET is_predefined=true WHERE id=%s', (scenario,))
    assert client.patch(path, json={'name': 'Wrong'}, headers=headers).status_code == 409


def test_run_relations_statuses_and_complete_results(env):
    client, conn, _ = env
    user, headers, _ = create_user(conn, role='editor')
    _, other_headers, _ = create_user(conn)
    bs, curve = seed_buckets(conn), seed_curve(conn)
    method = conn.execute('INSERT INTO app.methodology_version(code,version_no,name,bucket_set_id,created_by) '
                          "VALUES (%s,1,'Draft',%s,'test') RETURNING id", (uuid.uuid4().hex, bs)).fetchone()['id']
    scenario = conn.execute('INSERT INTO app.scenario(code,version_no,name,shift_type,created_by) '
                            "VALUES (%s,1,'Base','base','test') RETURNING id", (uuid.uuid4().hex,)).fetchone()['id']
    run = conn.execute('INSERT INTO calc.curve_run(curve_id,methodology_id,bucket_set_id,reporting_date,created_by,created_by_user_id) '
                       "VALUES (%s,%s,%s,'2026-11-19','test',%s) RETURNING id", (curve, method, bs, user['id'])).fetchone()['id']
    conn.execute('INSERT INTO calc.run_scenario VALUES (%s,%s)', (run, scenario))
    path = f'/api/v1/runs/{run}'
    assert client.get(path, headers=other_headers).status_code == 404
    assert client.get(path, headers=headers).json()['scenarios'][0]['id'] == scenario
    for status in ('pending', 'running', 'failed', 'cancelled'):
        conn.execute('UPDATE calc.curve_run SET status=%s WHERE id=%s', (status, run))
        assert client.get(path + '/results', headers=headers).status_code == 409
    conn.execute("UPDATE calc.curve_run SET status='succeeded' WHERE id=%s", (run,))
    assert client.get(path + '/results', headers=headers).status_code == 409
    for bucket in (1, 2):
        conn.execute("INSERT INTO calc.base_curve_point VALUES (%s,%s,%s,%s,12.1234567890,'known',0.5,0.5,NULL)",
                     (run, curve, bs, bucket))
        conn.execute('INSERT INTO calc.base_point_source VALUES (%s,%s,%s,1,1)', (run, bucket, curve))
        conn.execute('INSERT INTO calc.stressed_curve_point VALUES (%s,%s,%s,0,12.1234567890,12.1234567890)', (run, scenario, bucket))
    result = client.get(path + '/results', headers=headers)
    assert result.status_code == 200, result.text
    assert result.json()['base_points'][0]['rate_pct'] == '12.1234567890'
    assert result.json()['base_points'][0]['sources'][0]['weight'] == '1.000000000000'
    assert len(result.json()['stressed_points']) == 2


def test_database_constraints_and_ready_requirements(env):
    _, conn, _ = env
    bs = seed_buckets(conn)
    with pytest.raises(psycopg.errors.CheckViolation):
        with conn.transaction():
            conn.execute("INSERT INTO app.methodology_version(code,version_no,name,status,bucket_set_id,created_by) "
                         "VALUES ('invalid-ready',1,'Invalid','ready',%s,'test')", (bs,))
    first = conn.execute("INSERT INTO app.scenario(code,version_no,name,shift_type,created_by) "
                          "VALUES ('active-constraint',1,'A','base','test') RETURNING id").fetchone()['id']
    with pytest.raises(psycopg.errors.UniqueViolation):
        with conn.transaction():
            conn.execute("INSERT INTO app.scenario(code,version_no,name,shift_type,created_by) "
                         "VALUES ('active-constraint',2,'B','base','test')")


def test_health_and_schema_readiness(env):
    client, _, _ = env
    assert client.get('/api/health').status_code == 200
    assert client.get('/api/ready').status_code == 200


def test_http_errors_validation_and_openapi(env):
    client, _, _ = env
    assert client.get('/no-such-route').json()['error']['code'] == 'http_error'
    result = client.post('/api/v1/auth/login', json={'email': 'bad', 'password': 'never-echo-this'})
    assert result.status_code == 422 and 'never-echo-this' not in result.text
    assert client.post('/api/v1/auth/login', content=b'{bad', headers={'Content-Type': 'application/json'}).status_code == 422
    spec = client.get('/openapi.json').json()
    assert '/api/v1/runs/{entity_id}/results' in spec['paths']
    assert 'password_hash' not in spec['components']['schemas']['User']['properties']
