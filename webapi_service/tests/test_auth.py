from contextlib import nullcontext
from datetime import datetime, timezone
from unittest.mock import Mock

import pytest
from webapi.auth import AuthService
from webapi.config import Settings
from webapi.errors import APIError
from webapi.schemas import LoginCredentials, PasswordReset, Registration, User
from webapi.security import digest, hasher


def user():
    now = datetime.now(timezone.utc)
    return dict(id=1, email='user@example.org', display_name='Test', role='viewer', status='active',
                email_confirmed_at=now, created_at=now, updated_at=now,
                password_hash=hasher.hash('password 123456'))


def auth():
    repo = Mock()
    repo.conn.transaction.return_value = nullcontext()
    return AuthService(repo, Settings(), Mock())


def test_successful_login_returns_raw_token_once_and_never_hashes():
    service, record = auth(), user()
    service.repo.one.side_effect = [record, {'expires_at': record['created_at']}]
    result = service.login(LoginCredentials(email=record['email'], password='password 123456'))
    assert set(result['user']) == set(User.model_fields)
    assert 'password_hash' not in repr(result)
    sql, values = service.repo.one.call_args.args
    assert values[1] == digest(result['access_token'])
    assert result['access_token'] not in values


@pytest.mark.parametrize('exists', [True, False])
def test_bad_credentials_share_same_error(exists):
    service = auth()
    service.repo.one.return_value = user() if exists else None
    with pytest.raises(APIError) as caught:
        service.login(LoginCredentials(email='user@example.org', password='wrong'))
    assert caught.value.status == 401 and caught.value.code == 'invalid_credentials'


def test_registration_cannot_assign_role_or_status_and_sends_only_raw_action_token():
    service = auth()
    service.repo.one.return_value = user()
    body = Registration(email='user@example.org', password='password 123456', display_name='Test')
    assert service.register(body) == {'message': 'Request accepted'}
    statement, args = service.repo.one.call_args.args
    assert 'role' not in statement.split('VALUES')[0].split('(')[1]
    assert args[2].startswith('scrypt$')
    email, purpose, raw = service.notifications.send_token.call_args.args
    assert purpose == 'verify_email'
    token_args = service.repo.conn.execute.call_args.args[1]
    assert digest(raw) in token_args and raw not in token_args


@pytest.mark.parametrize('mode', ['unknown', 'expired', 'used', 'disabled'])
def test_invalid_action_tokens_cannot_mutate_account(mode):
    service = auth()
    record = user()
    if mode == 'disabled':
        record['status'] = 'disabled'
    service.repo.one.side_effect = ([None] if mode == 'unknown' else
                                    [{'user_id': 1}, record, None if mode in {'expired', 'used'} else {'id': 1}])
    with pytest.raises(APIError) as caught:
        service.consume_action('a'*43, 'verify_email')
    assert caught.value.code == 'invalid_action_token'
    service.repo.conn.execute.assert_not_called()


def test_password_reset_invalidates_all_sessions_and_sibling_tokens():
    service, record = auth(), user()
    service.repo.one.side_effect = [{'user_id': 1}, record, {'id': 1}]
    body = PasswordReset(token='a'*43, password='new password 123456')
    service.consume_action(body.token, 'reset_password', body.password)
    calls = service.repo.conn.execute.call_args_list
    assert any('UPDATE auth.user_session SET revoked_at' in call.args[0] for call in calls)
    assert any('UPDATE auth.action_token SET used_at' in call.args[0] for call in calls)
    assert all('new password' not in str(call.args) for call in calls)


def test_disabled_accounts_do_not_receive_recovery_tokens():
    service = auth()
    service.repo.one.return_value = user() | {'status': 'disabled'}
    service.request_action('user@example.org', 'reset_password')
    service.notifications.send_token.assert_not_called()
