# Curves Web API

HTTP-сервис для **существующей PostgreSQL-схемы**, предоставленной в DBML.
Реализация находится в `webapi_service/webapi`. Расчётный движок `analyzer_service`
не меняется и не запускается из HTTP-обработчиков. Контракт предварительный:
фронтенд в репозитории пока отсутствует.

## Локальный запуск (PowerShell из корня репозитория)

```powershell
python -m venv webapi_service/.venv
webapi_service/.venv/Scripts/python.exe -m pip install -r webapi_service/requirements-dev.txt
$env:DATABASE_DSN = 'postgresql://USER:PASSWORD@HOST:5432/DBNAME'
webapi_service/.venv/Scripts/python.exe -m uvicorn webapi.main:app --app-dir webapi_service --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers --no-access-log
```

Пароль в DSN должен быть URL-encoded, если содержит специальные символы. Не
сохраняйте реальные значения в отслеживаемые файлы. `.env.example` — образец:
приложение читает переменные процесса, файл `.env` автоматически не загружает.

For Linux/macOS use `.venv/bin/python` instead of `Scripts/python.exe`, and
`export DATABASE_DSN='...'` instead of `$env:DATABASE_DSN = '...'`.

- `http://127.0.0.1:8000/docs` — Swagger и все схемы DTO.
- `http://127.0.0.1:8000/openapi.json` — машинный контракт.
- `/api/health` — liveness процесса, без обращения к БД.
- `/api/ready` — чтением проверяет наличие таблиц/полей, используемых сервисом.
  Ошибка подключения или несовместимая схема даёт 503. Это не проверка всех
  внешних ключей/индексов и не замена проверки миграций командой БД.

Без `DATABASE_DSN` доступны health и документация; операции с БД возвращают 503.
Сервис **никогда не выполняет DDL**. DBML не доказывает, что таблицы созданы.
До полноценного запуска команда БД должна установить согласованную схему и выдать
runtime-пользователю только необходимые SELECT/INSERT/UPDATE и доступ к sequence;
CREATE/DROP/TRUNCATE ему не нужны. Включите TLS для удалённой БД через параметры DSN.

## Переменные окружения

| Переменная | Значение по умолчанию | Назначение |
|---|---|---|
| `DATABASE_DSN` | отсутствует | PostgreSQL DSN; секрет |
| `SESSION_HOURS` | `24` | Срок новой сессии |
| `ACTION_TOKEN_MINUTES` | `30` | Срок одноразового токена |
| `AUTH_REQUESTS_PER_MINUTE` | `10` | Лимит запросов публичной авторизации на IP и отдельно на нормализованный email |
| `SMTP_HOST` | пусто | Сервер SMTP с STARTTLS |
| `SMTP_PORT` | `587` | Порт SMTP |
| `SMTP_USER`, `SMTP_PASSWORD` | пусто | SMTP-учётные данные; пароль — секрет |
| `SMTP_SENDER` | пусто | Адрес отправителя |
| `STORAGE_ADAPTER` | `disabled` | Другие значения пока не поддерживаются |
| `TEST_DATABASE_DSN` | отсутствует | Только для тестовой БД из `compose.test.yaml` |

Пул: максимум 8 подключений; timeout выдачи и соединения 5 секунд, SQL timeout
10 секунд. Ответы datetime — ISO 8601 с часовым поясом, соединения используют UTC.
Одна операция API — одна транзакция REPEATABLE READ. Commit происходит до отправки
успешного ответа; конфликты конкурентных транзакций дают 409, запрос можно повторить.
Изменение и запись аудита атомарны. Чтение связанных списков выполняется пакетами,
без запросов по одному на каждую точку или строку списка.

## Авторизация и права

Регистрация всегда создаёт `viewer/pending`; роль и статус нельзя передать в теле.
Пароль для регистрации/сброса: 12–128 символов, без изменения пробелов. Вход
принимает 1–128 символов, чтобы не навязывать политику создания существующим аккаунтам.
Хеш: scrypt N=32768/r=8/p=3, случайная соль 16 байт, constant-time сравнение.
Поддерживается текущий формат `scrypt$32768$8$3$...`; формат паролей, импортируемых
другими сервисами, необходимо согласовать. Другие форматы отклоняются.

Вход возвращает непрозрачный случайный bearer-токен (32 случайных байта), его
SHA-256 хранится в `auth.user_session`. Это сессия, не JWT. Для запросов используйте
`Authorization: Bearer TOKEN`. Не передавайте токен в query string и не сохраняйте
его в логах. Хранение токена в браузере согласуется с фронтендом; cookie-режим и
refresh-токены не добавлены. Перед production нужен HTTPS на ingress.

Подтверждение email активирует аккаунт; `disabled` не активируется токеном.
Сброс пароля отзывает все сессии. Использование токена атомарно и инвалидирует
другие неиспользованные токены того же назначения. Истёкшие/отозванные сессии и
неподтверждённые/отключённые аккаунты доступа не получают. Каждый запрос проверяет
состояние в БД. Записи аккаунта и сессии блокируются в едином порядке; одновременно
запросы одного пользователя могут выполняться последовательно.

Без SMTP регистрация и запросы писем возвращают 503, без фиктивного отправления.
Токены передаются только письмом, не HTTP-ответом. Для восстановления одинаковый
202 возвращается известному и неизвестному адресу, также при ошибке доставки для
конкретного адресата. При глобально отсутствующей конфигурации SMTP всем даётся 503.
Отправка синхронная: время ответа может отличаться; для более строгой защиты от
временного определения аккаунтов нужен согласованный асинхронный механизм доставки.
SMTP и PostgreSQL не образуют общую транзакцию: письмо может уйти перед неудачным
commit. При таком сбое пользователь запрашивает новый токен. Надёжный outbox требует
согласования схемы и сейчас не имитируется.

Rate limiter потокобезопасный, ограничен 10000 ключами, работает в одном процессе.
Запускайте один worker; при нескольких репликах лимит применяется отдельно на каждой.
Production HPA допускает до 3 реплик — общий предел умножается на число реплик.
Для общего лимита нужен ingress/shared limiter. `X-Forwarded-For` не принимается на
веру, Docker запускается с `--no-proxy-headers`. За proxy его адрес будет общим
ключом IP: настройте доверенный ingress и внешний лимит, не доверяйте произвольным
заголовкам. Пароли, токены и тела запросов в аудит не записываются.

## Контракт API

Все пути ниже имеют префикс `/api/v1`. Актуальные поля, nullable, enum, ограничения,
Request/Response JSON и security scheme представлены в `/openapi.json`.
`*` — активный подтверждённый пользователь; `own` — владелец. Приватные сущности
вне области доступа возвращают 404. Внутри доступного объекта нарушение права
изменения — 403, конфликт состояния/уникальности — 409.

| Метод | Маршрут | Доступ | Request / query → Response DTO | Успех | Таблицы | Статус |
|---|---|---|---|---|---|---|
| POST | `/auth/register` | Публичный, limiter | Registration → Accepted | 202 | auth.user_account/action_token, audit | SMTP обязателен |
| POST | `/auth/login` | Публичный, limiter | LoginCredentials → LoginResult | 200 | auth.user_account/user_session | Реализован |
| POST | `/auth/logout` | * own | без тела → без тела | 204 | auth.user_session, audit | Реализован |
| POST | `/auth/email-confirmation/request` | Публичный, limiter | EmailRequest → Accepted | 202 | auth.action_token/user_account | SMTP обязателен |
| POST | `/auth/email-confirmation/confirm` | Публичный, limiter | ActionRequest → Accepted | 200 | auth.action_token/user_account, audit | Реализован |
| POST | `/auth/password-reset/request` | Публичный, limiter | EmailRequest → Accepted | 202 | auth.action_token/user_account | SMTP обязателен |
| POST | `/auth/password-reset/confirm` | Публичный, limiter | PasswordReset → Accepted | 200 | auth.action_token/user_session/user_account, audit | Реализован |
| GET | `/users/me` | * own | — → User | 200 | auth.user_account | Реализован |
| PATCH | `/users/me` | * own | ProfilePatch(display_name) → User | 200 | auth.user_account, audit | Реализован |
| GET | `/users/me/sessions` | * own | limit/offset → Page[Session] | 200 | auth.user_session | Реализован |
| DELETE | `/users/me/sessions/{id}` | * own | — → без тела, отзыв | 204 | auth.user_session, audit | Реализован |
| GET | `/reference/bucket-sets` | * | code/version_no, page → Page[BucketSet] | 200 | ref.bucket_set | Реализован |
| GET | `/reference/bucket-sets/{id}` | * | — → BucketDetail с buckets | 200 | ref.bucket_set/time_bucket | Реализован |
| GET | `/reference/bucket-sets/{id}/buckets` | * | — → Bucket[] | 200 | ref.bucket_set/time_bucket | Реализован |
| GET | `/market/curves` | * | source/curve_code/currency_code/curve_date/revision/status, page → Page[Curve] | 200 | market.curve | Реализован |
| GET | `/market/curves/{id}` | * | — → CurveDetail с points/ingestion | 200 | market.curve/curve_point/ingestion_batch | Реализован |
| GET | `/market/curves/{id}/points` | * | — → CurvePoint[] | 200 | market.curve/curve_point | Реализован |
| GET | `/market/curves/{id}/payload` | * | — → CurvePayload | 200 | market.curve | Реализован |
| GET | `/methodologies` | * scope | code/version_no/status, page → Page[Methodology] | 200 | app.methodology_version | Реализован |
| GET | `/methodologies/{id}` | * scope | — → MethodDetail с bucket_set/buckets | 200 | app.methodology_version, ref | Реализован |
| POST | `/methodologies` | editor | MethodCreate → Methodology | 201 | app.methodology_version, ref, audit | Только начальный draft |
| PATCH | `/methodologies/{id}` | editor own | MethodPatch → Methodology | 200 | app.methodology_version, calc.curve_run, ref, audit | Только unused draft |
| GET | `/scenarios` | * scope | code/version_no/shift_type/is_active/is_predefined, page → Page[Scenario] | 200 | app.scenario | Реализован |
| GET | `/scenarios/{id}` | * scope | — → Scenario | 200 | app.scenario | Реализован |
| POST | `/scenarios` | editor | ScenarioCreate → Scenario | 201 | app.scenario, audit | Стандартный тип, params=null |
| PATCH | `/scenarios/{id}` | editor own | ScenarioPatch → Scenario | 200 | app.scenario, calc.run_scenario, audit | Только unused active custom-owned |
| GET | `/runs` | * own | status/curve_id/methodology_id/reporting_date, page → Page[Run] | 200 | calc.curve_run | Реализован |
| GET | `/runs/{id}` | * own | — → RunDetail с curve/methodology/buckets/scenarios | 200 | calc.curve_run/run_scenario, market, app, ref | Реализован |
| GET | `/runs/{id}/results` | * own | — → RunResults с base_points/sources/stressed_points/buckets | 200 | все 5 calc, market.curve_point, ref | Только полный succeeded |

`page`: `limit=1..100` (50), `offset=0..100000` (0), `sort=id`, `descending=false`.
Ответ: `{"items":[],"total":0,"limit":50,"offset":0}`. Сортировка имеет tie-breaker
по id. Допустимые поля sort: reference — id/code/version_no; curves —
id/curve_date/revision/loaded_at; methodologies/scenarios — id/code/version_no/created_at;
runs — id/created_at/reporting_date. Другие значения дают 422.
Точные совпадения фильтров, без неявного выбора последней ревизии. Все ревизии
доступны; правила latest нет. `payload` вынесен отдельно, чтобы не раздувать списки.
Идентификатор пути в OpenAPI называется `entity_id`, тип — положительное целое.

Общие ошибки: 400 недействительный action-token; 401 неверный пароль/сессия;
403 аккаунт недоступен/нет прав; 404 нет сущности в доступной области;
409 конфликт/неизвестный контракт/неполный результат; 422 DTO/query/JSON;
429 лимит; 503 БД/схема/уведомления недоступны; 413 тело больше 1 MiB.
Ошибка: `{"error":{"code":"results_unavailable","message":"Run status is running"}}`.
Validation errors не отражают входные секреты. SQL и имена constraint наружу не выдаются.

## Связи, ограничения, состояние

Используются все 16 таблиц DBML. Composite FK связывают запуск с методологией и
набором интервалов, базовую точку — с тем же запуском/кривой/интервалом, источники —
с исходной точкой рынка, стрессовые точки — с run_scenario и base_curve_point.
Эти ограничения должна установить команда БД. API не заменяет их проверками в коде.

Приложение валидирует размеры строк, enum, конечность/точность Decimal, положительные
версии/id, обязательные поля и права. PostgreSQL обеспечивает FK/unique/check;
нарушение откатывает всю операцию вместе с аудитом. Отдельно защищены immutable
версии, ссылки на использованные сущности и авторство. Блокировка редактируемой
строки препятствует гонке с появлением FK-ссылки со стороны вычислительного сервиса.
Новая версия существующего code заблокирована до согласования политики; также
проверяется уникальность кода при конкурирующих созданиях.

Статус ready не принимается ни при создании, ни в PATCH: переходы не согласованы.
`ck_methodology_ready` требует полный набор параметров и корректную floor-конфигурацию
также для retired (условие разрешает неполноту только draft). Поэтому до реализации
переходов нельзя просто назначить retired неполному черновику. Тестовый SQL повторяет
это ограничение; production DDL намеренно не добавлен.

Объект запуска возвращает фактический статус. Результаты только для succeeded,
с проверкой покрытия всех интервалов и сценариев. Ошибки расчётного сервиса могут
содержать секреты: сырое `error_message` наружу не выдаётся до согласования
санитизированного контракта. `claimed_by`, `heartbeat_at`, `attempt` не меняются и
не входят в публичный Run DTO. Исторические определения внутри доступного запуска
доступны независимо от их текущего статуса.

Аудит пишет идентификатор пользователя, действие, сущность и имена изменённых полей.
Самостоятельного GET `/audit` нет: у обеих ролей отсутствует подтверждённое право
его чтения. Управление аккаунтами других пользователей также не реализовано.

## Тесты

Unit-тесты не требуют БД и проверяют безопасность, DTO, ограничения прав, жизненный
цикл сессий/токенов и результаты через явно инъецированные test doubles:

```powershell
webapi_service/.venv/Scripts/python.exe -m pytest webapi_service/tests -q
```

Без `TEST_DATABASE_DSN` интеграционные проверки пропускаются. Это не подтверждение
подключения к PostgreSQL. Изолированная среда (Docker Desktop Linux engine включён):

```powershell
docker compose -p curves-webapi-test -f webapi_service/compose.test.yaml up -d --wait
$env:TEST_DATABASE_DSN = 'postgresql://webapi_test:isolated-test-only@127.0.0.1:55432/curves_webapi_test'
webapi_service/.venv/Scripts/python.exe -m pytest webapi_service/tests -q
docker compose -p curves-webapi-test -f webapi_service/compose.test.yaml down
```

Контейнер использует tmpfs и test-only `tests/schema.sql`, без production volumes.
Тесты допускают только localhost/127.0.0.1 и имя БД `curves_webapi_test`; не используйте
это имя для реальных данных. Каждый тест откатывает свою транзакцию; DROP/TRUNCATE
и production-миграции тесты не выполняют. Тестовые данные не подмешиваются в API.
Для запуска самого API на этой тестовой схеме можно явно назначить `DATABASE_DSN`
равным тестовому DSN; это исключительно тестовое окружение.

Docker-образ (контекст именно каталог сервиса):

```powershell
docker build -t curves-webapi:local webapi_service
docker run --rm -p 127.0.0.1:8000:8000 --env DATABASE_DSN curves-webapi:local
```

В Docker `localhost` обозначает контейнер: для PostgreSQL на хосте Windows
используйте `host.docker.internal` в DSN. SMTP-переменные передавайте отдельно.


