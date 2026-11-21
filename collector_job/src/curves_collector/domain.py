from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class Curve:
    date: date
    points: tuple[tuple[Decimal, Decimal], ...]
