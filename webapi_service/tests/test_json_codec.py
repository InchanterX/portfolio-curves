from decimal import Decimal
import pytest
from webapi.json_codec import decode_json, is_json_content_type


def test_raw_request_and_jsonb_decimals_remain_exact():
    document = decode_json(b'{"rate":12.1234567890123456789012345,"count":9007199254740993}')
    assert document['rate'] == Decimal('12.1234567890123456789012345')
    assert document['count'] == 9007199254740993


@pytest.mark.parametrize('value', ['NaN', 'Infinity', '-Infinity', '{bad'])
def test_invalid_json_rejected(value):
    with pytest.raises(ValueError):
        decode_json(value)


@pytest.mark.parametrize('value', ['', 'application/json', 'APPLICATION/JSON; charset=utf-8',
                                  'application/vnd.curves+json'])
def test_all_json_media_types_use_decimal_decoder(value):
    assert is_json_content_type(value)


def test_non_json_media_type_is_not_decoded():
    assert not is_json_content_type('text/plain')
