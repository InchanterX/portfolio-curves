import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from decimal import Decimal, InvalidOperation
from http import HTTPStatus

from curves_collector.domain import Curve

ENDPOINT = "https://www.cbr.ru/secinfo/secinfo.asmx"
FIELDS = (
    ("v_0_25", "0.25"), ("v_0_5", "0.5"), ("v_0_75", "0.75"),
    ("v_1_0", "1"), ("v_2_0", "2"), ("v_3_0", "3"),
    ("v_5_0", "5"), ("v_7_0", "7"), ("v_10_0", "10"),
    ("v_15_0", "15"), ("v_20_0", "20"), ("v_30_0", "30"),
)


def parse_response(data: bytes, start: date, end: date) -> list[Curve]:
    """Validate and convert the SOAP dataset without changing source values."""
    root = ET.fromstring(data)
    local = lambda element: element.tag.rsplit("}", 1)[-1]  # noqa: E731
    if any(local(node) == "Fault" for node in root.iter()):
        raise ValueError("CBR returned a SOAP fault")
    if not any(local(node) == "zcyc_paramsResult" for node in root.iter()):
        raise ValueError("CBR response has no zcyc_paramsResult")
    curves = []
    seen = set()
    for row in root.iter():
        if local(row) != "ZCYC":
            continue
        values = {local(child): child.text for child in row}
        try:
            day = date.fromisoformat(values["D0"][:10])
            points = tuple((Decimal(tenor), Decimal(values[field])) for field, tenor in FIELDS)
            if not all(rate.is_finite() for _, rate in points):
                raise ValueError("Non-finite rate")
        except (KeyError, TypeError, ValueError, InvalidOperation) as exc:
            raise ValueError("Invalid CBR curve row") from exc
        if not start <= day <= end or day in seen:
            raise ValueError("Unexpected or duplicate CBR observation date")
        seen.add(day)
        curves.append(Curve(day, points))
    return sorted(curves, key=lambda curve: curve.date)


class CbrClient:
    def fetch(self, start: date, end: date) -> list[Curve]:
        """Fetch observations with bounded retries for transient HTTP failures."""
        body = f'''<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body><zcyc_params xmlns="http://web.cbr.ru/">
<FromDate>{start.isoformat()}T00:00:00</FromDate><ToDate>{end.isoformat()}T00:00:00</ToDate>
</zcyc_params></soap:Body></soap:Envelope>'''.encode()
        for attempt in range(4):
            request = urllib.request.Request(ENDPOINT, data=body, headers={
                "Content-Type": "text/xml; charset=utf-8",
                "SOAPAction": '"http://web.cbr.ru/zcyc_params"',
            })
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    return parse_response(response.read(), start, end)
            except urllib.error.HTTPError as exc:
                if exc.code not in (HTTPStatus.TOO_MANY_REQUESTS, 500, 502, 503, 504) or attempt == 3:
                    raise
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise
            time.sleep(2**attempt)
        raise RuntimeError("CBR request retries exhausted")
