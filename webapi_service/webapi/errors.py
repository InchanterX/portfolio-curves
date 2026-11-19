from dataclasses import dataclass


@dataclass
class APIError(Exception):
    status: int
    code: str
    message: str


def missing():
    raise APIError(404, 'not_found', 'Resource not found')
