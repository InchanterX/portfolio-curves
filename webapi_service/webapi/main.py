from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, Path, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError
from psycopg import DataError, IntegrityError, OperationalError, ProgrammingError
from psycopg.errors import DeadlockDetected, SerializationFailure
from psycopg_pool import PoolTimeout

from . import schemas as dto
from .auth import AuthService
from .config import Settings
from .db import Database
from .errors import APIError
from .infrastructure import DisabledObjectStorage, SMTPNotifications
from .json_codec import decode_json, is_json_content_type
from .repository import Repository
from .security import RateLimiter
from .services import DataService

Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100000)]
ID = Annotated[int, Path(gt=0)]
bearer = HTTPBearer(auto_error=False)


class ExactJSONRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            if is_json_content_type(request.headers.get('content-type', '')):
                try:
                    body = await request.body()
                    if body:
                        request._json = decode_json(body)
                except (ValueError, UnicodeDecodeError, RecursionError):
                    raise APIError(422, 'validation_error', 'Invalid JSON document') from None
            return await original(request)
        return handler


def get_repo(request: Request):
    if not request.app.state.database:
        raise APIError(503, 'database_unavailable', 'DATABASE_DSN is not configured')
    with request.app.state.database.transaction() as conn:
        yield Repository(conn)


def auth_service(request: Request, repo=Depends(get_repo, scope='function')):
    return AuthService(repo, request.app.state.settings, request.app.state.notifications)


def current_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
                 auth=Depends(auth_service)):
    return auth.authenticate(credentials.credentials if credentials else '')


def data_service(repo=Depends(get_repo, scope='function'), user=Depends(current_user)):
    return DataService(repo, user)


def throttle(request: Request):
    # Never trust caller-supplied X-Forwarded-For. Configure trusted ingress explicitly.
    host = request.client.host if request.client else 'unknown'
    request.app.state.limiter.check(('ip', host))


def throttle_email(request, email):
    # Per-email key is hashed to avoid keeping email addresses in limiter memory.
    from .security import digest
    request.app.state.limiter.check(('email', digest(str(email).lower())))


def create_app(settings=None, database=None, notifications=None):
    settings = settings or Settings.from_env()
    db = database or (Database(settings.database_dsn) if settings.database_dsn else None)

    @asynccontextmanager
    async def lifespan(app):
        if db:
            db.open()
        yield
        if db:
            db.close()

    errors = {code: {'model': dto.ErrorResponse} for code in (400, 401, 403, 404, 409, 413, 422, 429, 500, 503)}
    app = FastAPI(title='Curves Web API', version='1.0.0', lifespan=lifespan, responses=errors)
    app.state.settings = settings
    app.state.database = db
    app.state.notifications = notifications or SMTPNotifications(settings)
    app.state.storage = DisabledObjectStorage()
    app.state.limiter = RateLimiter(settings.auth_requests_per_minute)

    @app.exception_handler(APIError)
    async def api_error(request, exc):
        headers = {'WWW-Authenticate': 'Bearer'} if exc.status == 401 else {}
        if exc.status == 429:
            headers['Retry-After'] = '60'
        return JSONResponse(status_code=exc.status, content={'error': {'code': exc.code, 'message': exc.message}},
                            headers=headers)

    @app.exception_handler(Exception)
    async def internal_error(request, exc):
        return JSONResponse(status_code=500, content={'error': {'code': 'internal_error',
                                                               'message': 'Unexpected server error'}})

    @app.exception_handler(RequestValidationError)
    @app.exception_handler(ValidationError)
    @app.exception_handler(DataError)
    async def validation_error(request, exc):
        # Pydantic errors may contain raw passwords/tokens; never serialize their input/context.
        return JSONResponse(status_code=422, content={'error': {'code': 'validation_error',
                                                               'message': 'Invalid request fields'}})

    @app.exception_handler(IntegrityError)
    async def integrity_error(request, exc):
        return JSONResponse(status_code=409, content={'error': {'code': 'constraint_conflict',
                                                               'message': 'Database constraint conflict'}})

    @app.exception_handler(DeadlockDetected)
    @app.exception_handler(SerializationFailure)
    async def transaction_error(request, exc):
        return JSONResponse(status_code=409, content={'error': {'code': 'transaction_conflict',
                                                               'message': 'Concurrent update; retry request'}})

    @app.exception_handler(PoolTimeout)
    @app.exception_handler(OperationalError)
    @app.exception_handler(ProgrammingError)
    async def database_error(request, exc):
        return JSONResponse(status_code=503, content={'error': {'code': 'database_unavailable',
                                                               'message': 'Database unavailable or schema incompatible'}})

    from starlette.exceptions import HTTPException

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return JSONResponse(status_code=exc.status_code,
                            content={'error': {'code': 'http_error', 'message': str(exc.detail)}})

    @app.middleware('http')
    async def security_headers(request, call_next):
        if request.method in {'POST', 'PATCH', 'PUT'}:
            chunks, size = [], 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > 1048576:
                    return JSONResponse(status_code=413, content={'error': {'code': 'body_too_large',
                                                                         'message': 'Body exceeds 1 MiB'}})
                chunks.append(chunk)
            request._body = b''.join(chunks)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.get('/api/health', tags=['health'])
    def health():
        return {'status': 'ok'}

    @app.get('/api/ready', tags=['health'])
    def ready(repo=Depends(get_repo, scope='function')):
        # SELECT only. Check all tables/columns used; never initialize schema on startup.
        from psycopg import sql
        from .repository import TABLES
        for kind in TABLES:
            repo.conn.execute(sql.SQL('SELECT {} FROM {} LIMIT 0').format(repo.columns(kind), repo.table(kind)))
        for table in ('auth.user_account', 'auth.user_session', 'auth.action_token', 'ref.time_bucket',
                      'market.ingestion_batch', 'market.curve_point', 'calc.run_scenario',
                      'calc.base_curve_point', 'calc.base_point_source', 'calc.stressed_curve_point',
                      'audit.audit_log'):
            repo.conn.execute(sql.SQL('SELECT * FROM {} LIMIT 0').format(sql.Identifier(*table.split('.'))))
        return {'status': 'ready'}

    router = APIRouter(prefix='/api/v1', route_class=ExactJSONRoute)
    auth_router = APIRouter(prefix='/auth', tags=['auth'], dependencies=[Depends(throttle)],
                            route_class=ExactJSONRoute)

    @auth_router.post('/register', response_model=dto.Accepted, status_code=202)
    def register(body: dto.Registration, request: Request, auth=Depends(auth_service)):
        throttle_email(request, body.email)
        return auth.register(body)

    @auth_router.post('/login', response_model=dto.LoginResult)
    def login(body: dto.LoginCredentials, request: Request, auth=Depends(auth_service)):
        throttle_email(request, body.email)
        return auth.login(body)

    @auth_router.post('/email-confirmation/request', response_model=dto.Accepted, status_code=202)
    def request_confirmation(body: dto.EmailRequest, request: Request, auth=Depends(auth_service)):
        throttle_email(request, body.email)
        return auth.request_action(body.email, 'verify_email')

    @auth_router.post('/email-confirmation/confirm', response_model=dto.Accepted)
    def confirm(body: dto.ActionRequest, auth=Depends(auth_service)):
        return auth.consume_action(body.token, 'verify_email')

    @auth_router.post('/password-reset/request', response_model=dto.Accepted, status_code=202)
    def request_reset(body: dto.EmailRequest, request: Request, auth=Depends(auth_service)):
        throttle_email(request, body.email)
        return auth.request_action(body.email, 'reset_password')

    @auth_router.post('/password-reset/confirm', response_model=dto.Accepted)
    def reset(body: dto.PasswordReset, auth=Depends(auth_service)):
        return auth.consume_action(body.token, 'reset_password', body.password)

    @router.post('/auth/logout', status_code=204, tags=['auth'])
    def logout(user=Depends(current_user), auth=Depends(auth_service)):
        auth.revoke(user, user['session_id'])
        return Response(status_code=204)

    @router.get('/users/me', response_model=dto.User, tags=['users'])
    def me(user=Depends(current_user)):
        return {k: user[k] for k in dto.User.model_fields}

    @router.patch('/users/me', response_model=dto.User, tags=['users'])
    def patch_profile(body: dto.ProfilePatch, user=Depends(current_user), auth=Depends(auth_service)):
        return auth.profile(user, body)

    @router.get('/users/me/sessions', response_model=dto.Page[dto.Session], tags=['users'])
    def sessions(limit: Limit = 50, offset: Offset = 0, user=Depends(current_user), auth=Depends(auth_service)):
        return auth.sessions(user, limit, offset)

    @router.delete('/users/me/sessions/{entity_id}', status_code=204, tags=['users'])
    def revoke(entity_id: ID, user=Depends(current_user), auth=Depends(auth_service)):
        auth.revoke(user, entity_id)
        return Response(status_code=204)

    @router.get('/reference/bucket-sets', response_model=dto.Page[dto.BucketSet], tags=['reference'])
    def buckets(code: str | None = None, version_no: Annotated[int | None, Query(gt=0)] = None,
                limit: Limit = 50, offset: Offset = 0, sort: str = 'id', descending: bool = False,
                service=Depends(data_service)):
        return service.page('buckets', dict(code=code, version_no=version_no), limit, offset, sort, descending)

    @router.get('/reference/bucket-sets/{entity_id}', response_model=dto.BucketDetail, tags=['reference'])
    def bucket_detail(entity_id: ID, service=Depends(data_service)):
        return service.repo.bucket_detail(entity_id)

    @router.get('/reference/bucket-sets/{entity_id}/buckets', response_model=list[dto.Bucket], tags=['reference'])
    def bucket_points(entity_id: ID, service=Depends(data_service)):
        return service.repo.bucket_detail(entity_id)['buckets']

    @router.get('/market/curves', response_model=dto.Page[dto.Curve], tags=['market'])
    def curves(source: str | None = None, curve_code: str | None = None,
               currency_code: Annotated[str | None, Query(pattern='^[A-Z]{3}$')] = None,
               curve_date: date | None = None, revision: Annotated[int | None, Query(gt=0)] = None,
               status: Literal['loading', 'accepted', 'rejected'] | None = None,
               limit: Limit = 50, offset: Offset = 0, sort: str = 'id', descending: bool = False,
               service=Depends(data_service)):
        return service.page('curves', dict(source=source, curve_code=curve_code, currency_code=currency_code,
                            curve_date=curve_date, revision=revision, status=status), limit, offset, sort, descending)

    @router.get('/market/curves/{entity_id}', response_model=dto.CurveDetail, tags=['market'])
    def curve_detail(entity_id: ID, service=Depends(data_service)):
        return service.curve_detail(entity_id)

    @router.get('/market/curves/{entity_id}/points', response_model=list[dto.CurvePoint], tags=['market'])
    def curve_points(entity_id: ID, service=Depends(data_service)):
        return service.curve_detail(entity_id)['points']

    @router.get('/market/curves/{entity_id}/payload', response_model=dto.CurvePayload, tags=['market'])
    def curve_payload(entity_id: ID, service=Depends(data_service)):
        return service.curve_payload(entity_id)

    @router.get('/methodologies', response_model=dto.Page[dto.Methodology], tags=['methodologies'])
    def methodologies(code: str | None = None, version_no: Annotated[int | None, Query(gt=0)] = None,
                      status: Literal['draft', 'ready', 'retired'] | None = None,
                      limit: Limit = 50, offset: Offset = 0, sort: str = 'id', descending: bool = False,
                      service=Depends(data_service)):
        return service.page('methods', dict(code=code, version_no=version_no, status=status),
                            limit, offset, sort, descending)

    @router.get('/methodologies/{entity_id}', response_model=dto.MethodDetail, tags=['methodologies'])
    def methodology(entity_id: ID, service=Depends(data_service)):
        return service.method_detail(entity_id)

    @router.post('/methodologies', response_model=dto.Methodology, status_code=201, tags=['methodologies'])
    def create_method(body: dto.MethodCreate, service=Depends(data_service)):
        return service.create('methods', body)

    @router.patch('/methodologies/{entity_id}', response_model=dto.Methodology, tags=['methodologies'])
    def patch_method(entity_id: ID, body: dto.MethodPatch, service=Depends(data_service)):
        return service.patch('methods', entity_id, body)

    @router.get('/scenarios', response_model=dto.Page[dto.Scenario], tags=['scenarios'])
    def scenarios(code: str | None = None, version_no: Annotated[int | None, Query(gt=0)] = None,
                  shift_type: dto.ScenarioType | None = None, is_active: bool | None = None,
                  is_predefined: bool | None = None, limit: Limit = 50, offset: Offset = 0,
                  sort: str = 'id', descending: bool = False, service=Depends(data_service)):
        return service.page('scenarios', dict(code=code, version_no=version_no, shift_type=shift_type,
                            is_active=is_active, is_predefined=is_predefined), limit, offset, sort, descending)

    @router.get('/scenarios/{entity_id}', response_model=dto.Scenario, tags=['scenarios'])
    def scenario(entity_id: ID, service=Depends(data_service)):
        return service.get('scenarios', entity_id)

    @router.post('/scenarios', response_model=dto.Scenario, status_code=201, tags=['scenarios'])
    def create_scenario(body: dto.ScenarioCreate, service=Depends(data_service)):
        return service.create('scenarios', body)

    @router.patch('/scenarios/{entity_id}', response_model=dto.Scenario, tags=['scenarios'])
    def patch_scenario(entity_id: ID, body: dto.ScenarioPatch, service=Depends(data_service)):
        return service.patch('scenarios', entity_id, body)

    @router.get('/runs', response_model=dto.Page[dto.Run], tags=['runs'])
    def runs(status: Literal['pending', 'running', 'succeeded', 'failed', 'cancelled'] | None = None,
             curve_id: Annotated[int | None, Query(gt=0)] = None,
             methodology_id: Annotated[int | None, Query(gt=0)] = None,
             reporting_date: date | None = None, limit: Limit = 50, offset: Offset = 0,
             sort: str = 'id', descending: bool = False, service=Depends(data_service)):
        return service.page('runs', dict(status=status, curve_id=curve_id, methodology_id=methodology_id,
                            reporting_date=reporting_date), limit, offset, sort, descending)

    @router.get('/runs/{entity_id}', response_model=dto.RunDetail, tags=['runs'])
    def run(entity_id: ID, service=Depends(data_service)):
        return service.run_detail(entity_id)

    @router.get('/runs/{entity_id}/results', response_model=dto.RunResults, tags=['runs'])
    def results(entity_id: ID, service=Depends(data_service)):
        return service.run_results(entity_id)

    router.include_router(auth_router)
    app.include_router(router)
    return app


app = create_app()
