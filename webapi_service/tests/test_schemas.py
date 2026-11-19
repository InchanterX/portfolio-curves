from decimal import Decimal
import json
import pytest
from pydantic import ValidationError

from webapi.schemas import CurvePayload, MethodCreate, MethodPatch, PasswordReset, Registration, ScenarioCreate


def test_numeric_precision_and_openapi_decimal_contract():
    method = MethodCreate(code='a', version_no=1, name='A', bucket_set_id=1,
                          parallel_shift_pp='12345678.1234567890', x='1.12345678')
    wire = json.loads(method.model_dump_json())
    assert wire['parallel_shift_pp'] == '12345678.1234567890'
    assert method.parallel_shift_pp == Decimal('12345678.1234567890')


@pytest.mark.parametrize('patch', [dict(version_no=0), dict(x='0'), dict(x='NaN'),
                                  dict(parallel_shift_pp='-1'), dict(x='1.123456789'),
                                  dict(parallel_shift_pp='123456789.1234567890'),
                                  dict(status='ready'), dict(name=' ')])
def test_invalid_method_create(patch):
    data = dict(code='a', version_no=1, name='A', bucket_set_id=1)
    with pytest.raises(ValidationError):
        MethodCreate(**(data | patch))


@pytest.mark.parametrize('patch', [dict(role='editor'), dict(status='active'), dict(email='invalid'),
                                  dict(password='short'), dict(display_name=' ')])
def test_registration_does_not_allow_privilege_escalation(patch):
    data = dict(email='test@example.org', display_name='User', password='password 123456')
    with pytest.raises(ValidationError):
        Registration(**(data | patch))


def test_secrets_are_redacted_and_not_whitespace_stripped():
    data = Registration(email='user@example.org', display_name='User', password='  secret pass  ')
    assert data.password.get_secret_value() == '  secret pass  '
    assert 'secret pass' not in repr(data)


def test_reset_password_policy():
    with pytest.raises(ValidationError):
        PasswordReset(token='a'*43, password='short')


def test_patch_distinguishes_omitted_and_explicit_null():
    assert MethodPatch().model_dump(exclude_unset=True) == {}
    assert MethodPatch(x=None).model_dump(exclude_unset=True) == {'x': None}


def test_payload_response_does_not_normalize_original_content():
    assert CurvePayload(payload='  original content  ', payload_sha256='a'*64).payload == '  original content  '


@pytest.mark.parametrize('patch', [dict(is_predefined=True), dict(is_active=False), dict(created_by='other'),
                                  dict(shift_type='invented'), dict(params=[]), dict(version_no=0)])
def test_scenario_rejects_invalid_or_protected_fields(patch):
    data = dict(code='a', version_no=1, name='A', shift_type='base')
    with pytest.raises(ValidationError):
        ScenarioCreate(**(data | patch))
