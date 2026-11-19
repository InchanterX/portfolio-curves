"""Decode JSON without converting decimal numbers to binary floating point."""
from decimal import Decimal
import json


def reject_constant(value):
    raise ValueError('Non-finite JSON numbers are not supported')


def decode_json(value):
    return json.loads(value, parse_float=Decimal, parse_constant=reject_constant)


def is_json_content_type(value):
    media_type = value.split(';')[0].strip().lower()
    return (not media_type or media_type == 'application/json'
            or media_type.startswith('application/') and media_type.endswith('+json'))
