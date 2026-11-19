from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator

PositiveID = Annotated[int, Field(gt=0)]
Name = Annotated[str, Field(min_length=1, max_length=256)]
Code = Annotated[str, Field(min_length=1, max_length=64)]
Amount = Annotated[Decimal, Field(max_digits=18, decimal_places=10, allow_inf_nan=False)]
Years = Annotated[Decimal, Field(max_digits=12, decimal_places=8, gt=0, allow_inf_nan=False)]
Shift = Annotated[Amount, Field(ge=0)]
ScenarioType = Literal['base', 'parallel_up', 'parallel_down', 'steepener', 'flattener',
                       'short_up', 'short_down', 'custom_by_bucket']


class DTO(BaseModel):
    model_config = ConfigDict(extra='forbid')


class InputDTO(DTO):
    @field_validator('*', mode='before')
    @classmethod
    def trim_text_except_secrets(cls, value, info):
        if isinstance(value, str) and info.field_name not in {'password', 'token', 'access_token'}:
            return value.strip()
        return value


class ErrorBody(DTO):
    code: str
    message: str


class ErrorResponse(DTO):
    error: ErrorBody


class Accepted(DTO):
    message: str = 'Request accepted'


class LoginCredentials(InputDTO):
    email: Annotated[EmailStr, Field(max_length=320)]
    password: SecretStr

    @field_validator('password')
    @classmethod
    def login_password_size(cls, value):
        if not 1 <= len(value.get_secret_value()) <= 128:
            raise ValueError('Password must contain 1 to 128 characters')
        return value


class Credentials(LoginCredentials):

    @field_validator('password')
    @classmethod
    def password_size(cls, value):
        if not 12 <= len(value.get_secret_value()) <= 128:
            raise ValueError('Password must contain 12 to 128 characters')
        return value


class Registration(Credentials):
    display_name: Name


class ProfilePatch(InputDTO):
    display_name: Name


class EmailRequest(InputDTO):
    email: Annotated[EmailStr, Field(max_length=320)]


class ActionRequest(InputDTO):
    token: Annotated[str, Field(min_length=40, max_length=128)]


class PasswordReset(ActionRequest):
    password: SecretStr
    _check_password = field_validator('password')(Credentials.password_size.__func__)


class User(DTO):
    id: int
    email: str
    display_name: str
    role: Literal['viewer', 'editor']
    status: Literal['pending', 'active', 'disabled']
    email_confirmed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class Session(DTO):
    id: int
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None


class LoginResult(DTO):
    access_token: str
    token_type: Literal['bearer'] = 'bearer'
    expires_at: datetime
    user: User


T = TypeVar('T')


class Page(DTO, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class BucketSet(DTO):
    id: int
    code: str
    version_no: int
    name: str


class Bucket(DTO):
    bucket_set_id: int
    bucket_no: int
    label: str
    lower_years: Decimal
    upper_years: Decimal | None
    tenor_years: Decimal


class BucketDetail(BucketSet):
    buckets: list[Bucket]


class Curve(DTO):
    id: int
    ingestion_batch_id: int
    source: str
    curve_code: str
    currency_code: str
    curve_date: date
    revision: int
    status: Literal['loading', 'accepted', 'rejected']
    rate_convention: str | None
    payload_sha256: str
    loaded_at: datetime


class CurvePoint(DTO):
    curve_id: int
    point_no: int
    tenor_years: Decimal
    rate_pct: Decimal


class Ingestion(DTO):
    id: int
    source: str
    status: str
    started_at: datetime
    finished_at: datetime | None


class CurveDetail(Curve):
    points: list[CurvePoint]
    ingestion: Ingestion


class CurvePayload(DTO):
    payload: Any
    payload_sha256: str


class MethodFields(DTO):
    name: Name
    bucket_set_id: PositiveID
    x: Years | None = None
    parallel_shift_pp: Shift | None = None
    short_shift_pp: Shift | None = None
    long_shift_pp: Shift | None = None
    floor_mode: Literal['none', 'constant', 'by_bucket'] | None = None
    floor_params: Any = None
    interpolation_method: Code | None = None
    extrapolation_method: Code | None = None
    nearest_method: Code | None = None
    rate_convention: Code | None = None
    source_document: Annotated[str, Field(max_length=512)] | None = None


class MethodCreate(MethodFields, InputDTO):
    code: Code
    version_no: PositiveID
    floor_params: dict[str, Any] | None = None


class MethodPatch(InputDTO):
    name: Name | None = None
    bucket_set_id: PositiveID | None = None
    x: Years | None = None
    parallel_shift_pp: Shift | None = None
    short_shift_pp: Shift | None = None
    long_shift_pp: Shift | None = None
    floor_mode: Literal['none', 'constant', 'by_bucket'] | None = None
    floor_params: dict[str, Any] | None = None
    interpolation_method: Code | None = None
    extrapolation_method: Code | None = None
    nearest_method: Code | None = None
    rate_convention: Code | None = None
    source_document: Annotated[str, Field(max_length=512)] | None = None


class Methodology(MethodFields):
    id: int
    code: str
    version_no: int
    status: Literal['draft', 'ready', 'retired']
    created_by: str
    created_by_user_id: int | None
    created_at: datetime


class MethodDetail(Methodology):
    bucket_set: BucketDetail


class ScenarioFields(DTO):
    code: Code
    version_no: PositiveID
    name: Name
    shift_type: ScenarioType
    params: dict[str, Any] | None = None


class ScenarioCreate(ScenarioFields, InputDTO):
    pass


class ScenarioPatch(InputDTO):
    name: Name | None = None
    shift_type: ScenarioType | None = None
    params: dict[str, Any] | None = None


class Scenario(ScenarioFields):
    id: int
    is_predefined: bool
    is_active: bool
    created_by: str
    created_by_user_id: int | None
    created_at: datetime


class Run(DTO):
    id: int
    curve_id: int
    methodology_id: int
    bucket_set_id: int
    status: Literal['pending', 'running', 'succeeded', 'failed', 'cancelled']
    reporting_date: date
    created_by: str
    created_by_user_id: int | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    engine_version: str | None


class RunDetail(Run):
    curve: Curve
    methodology: Methodology
    bucket_set: BucketDetail
    scenarios: list[Scenario]


class PointSource(DTO):
    point_no: int
    weight: Decimal | None
    tenor_years: Decimal
    rate_pct: Decimal


class BasePoint(DTO):
    curve_run_id: int
    curve_id: int
    bucket_set_id: int
    bucket_no: int
    rate_pct: Decimal
    value_source: str
    exp_factor: Decimal
    one_minus_exp_factor: Decimal
    floor_pct: Decimal | None
    sources: list[PointSource]


class StressPoint(DTO):
    curve_run_id: int
    scenario_id: int
    bucket_no: int
    shift_pp: Decimal
    rate_before_floor_pct: Decimal
    rate_pct: Decimal


class RunResults(DTO):
    run_id: int
    bucket_set: BucketDetail
    base_points: list[BasePoint]
    stressed_points: list[StressPoint]


