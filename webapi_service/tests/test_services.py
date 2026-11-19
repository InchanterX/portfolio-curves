from contextlib import nullcontext
from unittest.mock import Mock

import pytest
from webapi.auth import AuthService
from webapi.config import Settings
from webapi.errors import APIError
from webapi.infrastructure import SMTPNotifications
from webapi.schemas import MethodPatch, ScenarioCreate, ScenarioPatch
from webapi.services import DataService


def service(row=None, role='editor'):
    repo = Mock()
    repo.get.return_value = row
    repo.conn.transaction.return_value = nullcontext()
    return DataService(repo, {'id': 1, 'role': role})


@pytest.mark.parametrize('kind,row', [
    ('runs', {'created_by_user_id': 2}),
    ('scenarios', {'created_by_user_id': 2, 'is_predefined': False}),
    ('methods', {'created_by_user_id': 2, 'status': 'draft'}),
])
def test_private_entities_are_hidden(kind, row):
    with pytest.raises(APIError) as caught:
        service(row).get(kind, 10)
    assert caught.value.status == 404


@pytest.mark.parametrize('kind,row', [
    ('scenarios', {'created_by_user_id': 2, 'is_predefined': True}),
    ('methods', {'created_by_user_id': 2, 'status': 'ready'}),
    ('runs', {'created_by_user_id': 1}),
])
def test_allowed_scope(kind, row):
    assert service(row).get(kind, 10) == row


def test_viewer_cannot_write():
    with pytest.raises(APIError) as caught:
        service(role='viewer').create('scenarios', ScenarioCreate(code='a', version_no=1, name='a', shift_type='base'))
    assert caught.value.status == 403


@pytest.mark.parametrize('status', ['ready', 'retired'])
def test_published_methodologies_are_immutable(status):
    with pytest.raises(APIError) as caught:
        service({'created_by_user_id': 1, 'status': status}).patch('methods', 1, MethodPatch(name='New'))
    assert caught.value.code == 'immutable_methodology'


def test_referenced_draft_is_immutable():
    s = service({'created_by_user_id': 1, 'status': 'draft'})
    s.repo.one.return_value = {'id': 1}
    with pytest.raises(APIError) as caught:
        s.patch('methods', 1, MethodPatch(name='New'))
    assert caught.value.code == 'entity_in_use'
    s.repo.patch.assert_not_called()


@pytest.mark.parametrize('predefined,active', [(True, True), (False, False)])
def test_predefined_and_inactive_scenarios_are_immutable(predefined, active):
    s = service({'created_by_user_id': 1, 'is_predefined': predefined, 'is_active': active})
    with pytest.raises(APIError) as caught:
        s.patch('scenarios', 1, ScenarioPatch(name='New'))
    assert caught.value.code == 'immutable_scenario'


@pytest.mark.parametrize('status', ['pending', 'running', 'failed', 'cancelled'])
def test_unfinished_or_failed_runs_never_return_results(status):
    s = service({'created_by_user_id': 1, 'status': status})
    with pytest.raises(APIError) as caught:
        s.run_results(1)
    assert caught.value.code == 'results_unavailable'
    s.repo.all.assert_not_called()


def test_incomplete_success_is_not_reported_as_valid_results():
    s = service({'created_by_user_id': 1, 'status': 'succeeded', 'bucket_set_id': 1})
    s.repo.all.return_value = []
    s.repo.bucket_detail.return_value = {'buckets': [{'bucket_no': 1}]}
    with pytest.raises(APIError) as caught:
        s.run_results(1)
    assert caught.value.code == 'incomplete_results'


def test_sources_are_grouped_without_n_plus_one():
    s = service({'created_by_user_id': 1, 'status': 'succeeded', 'bucket_set_id': 1})
    s.repo.all.side_effect = [
        [{'bucket_no': 1}], [{'bucket_no': 1, 'point_no': 3}],
        [{'scenario_id': 2, 'bucket_no': 1}], [{'scenario_id': 2}],
    ]
    s.repo.bucket_detail.return_value = {'buckets': [{'bucket_no': 1}]}
    result = s.run_results(1)
    assert result['base_points'][0]['sources'] == [{'point_no': 3}]
    assert s.repo.all.call_count == 4


@pytest.mark.parametrize('values', [dict(shift_type='custom_by_bucket', params={}),
                                   dict(shift_type='parallel_up', params={'unknown': 1})])
def test_undefined_parameter_contract_is_blocked(values):
    with pytest.raises(APIError) as caught:
        service().validate_scenario(values)
    assert caught.value.code == 'scenario_contract_pending'


def test_email_delivery_is_not_simulated():
    with pytest.raises(APIError) as caught:
        SMTPNotifications(Settings()).require_available()
    assert caught.value.status == 503


@pytest.mark.parametrize('status,confirmed', [('pending', None), ('disabled', True), ('active', None)])
def test_non_active_or_unconfirmed_accounts_are_blocked(status, confirmed):
    with pytest.raises(APIError) as caught:
        AuthService.check_active({'status': status, 'email_confirmed_at': confirmed})
    assert caught.value.status == 403


def test_recovery_response_does_not_disclose_smtp_failure_for_existing_account():
    repo, mail = Mock(), Mock()
    repo.one.return_value = {'id': 1, 'email': 'user@example.org', 'status': 'active', 'email_confirmed_at': True}
    repo.conn.transaction.return_value = nullcontext()
    mail.send_token.side_effect = APIError(503, 'notifications_unavailable', 'Delivery failed')
    auth = AuthService(repo, Settings(), mail)
    assert auth.request_action('user@example.org', 'reset_password') == {'message': 'Request accepted'}
    repo.one.return_value = None
    assert auth.request_action('unknown@example.org', 'reset_password') == {'message': 'Request accepted'}


@pytest.mark.parametrize('token', ['', 'a'*129])
def test_missing_or_oversized_sessions_rejected_before_database(token):
    auth = AuthService(Mock(), Settings(), Mock())
    with pytest.raises(APIError) as caught:
        auth.authenticate(token)
    assert caught.value.status == 401
    auth.repo.one.assert_not_called()


def test_expired_or_revoked_session_is_rejected():
    repo = Mock()
    repo.one.side_effect = [{'user_id': 1, 'id': 1}, {'id': 1}, None]
    with pytest.raises(APIError) as caught:
        AuthService(repo, Settings(), Mock()).authenticate('a'*43)
    assert caught.value.code == 'invalid_session'
