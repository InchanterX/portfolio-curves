"""Input facade for the business layer.

This is intentionally not a web framework. A future HTTP/RPC adapter can call
this facade without moving business rules into the transport layer.
"""

from datetime import date

from .domain import AnalysisExecution
from .service import IRRBBService


class IRRBBAPI:
    def __init__(self, service: IRRBBService) -> None:
        self._service = service

    def calculate(self, as_of: date) -> AnalysisExecution:
        return self._service.run(as_of)
