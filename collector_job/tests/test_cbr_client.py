from datetime import date
from decimal import Decimal

import pytest

from curves_collector.adapters.cbr_client import FIELDS, parse_response


def response(rows):
    """Build a minimal namespaced response matching the CBR SOAP dataset."""
    return f'<Envelope><zcyc_paramsResult><data>{rows}</data></zcyc_paramsResult></Envelope>'.encode()


def row(day="2026-11-20", missing=None, value="13.54"):
    """Build a source row with all known tenors."""
    fields = ''.join(f'<{name}>{value}</{name}>' for name, _ in FIELDS if name != missing)
    return f'<ZCYC><D0>{day}T00:00:00+03:00</D0>{fields}</ZCYC>'


def test_parse_twelve_original_points_and_date():
    curves = parse_response(response(row()), date(2026, 11, 1), date(2026, 11, 30))
    assert len(curves) == 1
    assert len(curves[0].points) == 12
    assert curves[0].points[-1] == (Decimal('30'), Decimal('13.54'))
    assert curves[0].date == date(2026, 11, 20)


@pytest.mark.parametrize('rows', [row(missing='v_30_0'), row(value='NaN'), row() + row()])
def test_reject_invalid_rows(rows):
    with pytest.raises(ValueError):
        parse_response(response(rows), date(2026, 11, 1), date(2026, 11, 30))


def test_empty_result_and_invalid_envelope():
    assert parse_response(response(''), date(2026, 11, 1), date(2026, 11, 30)) == []
    with pytest.raises(ValueError):
        parse_response(b'<Envelope><Fault /></Envelope>', date(2026, 11, 1), date(2026, 11, 30))
