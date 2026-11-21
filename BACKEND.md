# Бэкенд GCURVE (IRRBB): REST API поверх Postgres

Фронтенд (`src/`) работает **без бэкенда** — на моках (`src/data/mock.ts`). Когда API
доступно, страницы забирают живые данные через `src/api/client.ts` (fetch → fallback на
моки, если сервер не ответил). Ниже — как поднять бэкенд и подключить его к фронтенду.

## Архитектура

```
React (vite, :5173) --/api/*--> Express (:4000) --SQL--> Postgres 16 (irrbb)
```

- Схема БД — шесть схем: `auth` (пользователи/сессии), `ref` (теноры, типы инструментов),
  `market` (кривые ОФЗ), `app` (портфели, сценарии, статусы, экспорт), `calc` (запуски,
  результаты, LLM), `audit` (append-only журнал).
- **Что уже есть в Postgres** — 16 таблиц (dbml: `backend/schema-existing.dbml`): не меняем.
- **Миграция** `backend/irrbb_migration.sql` — создаёт 11 таблиц и дополняет 5 (портфель,
  результаты расчёта, ЭКпрбк, детализация, LLM, экспорт xlsx, организации, статусы источников).
- Подробное описание схемы — в документе «IRRBB: что есть в Postgres и что создать».

## 1. Поднять Postgres 16

Вариант A — Docker:

```bash
docker run -d --name irrbb-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=irrbb \
  -p 5432:5432 postgres:16
```

Вариант B — Homebrew (macOS):

```bash
brew install postgresql@16
brew services start postgresql@16
createdb irrbb
```

## 2. Применить схему

Базовые 16 таблиц уже существуют в целевой БД (см. `backend/schema-existing.dbml`). Если
поднимаете чистую БД для демо — сначала восстановите базовую схему из бэкапа заказчика,
затем миграцию:

```bash
psql -d irrbb -f backend/irrbb_migration.sql   # создано/дополнено по документу IRRBB
psql -d irrbb -f backend/seed.sql              # демо-данные (перезапускаемо)
```

## 3. Запустить бэкенд

```bash
cd backend
cp .env.example .env          # поправьте DATABASE_URL при необходимости
npm install
npm run dev                   # http://localhost:4000
```

Проверка: `curl localhost:4000/api/health` → `{ "ok": true, "db": "up" }`.
Если БД недоступна — эндпоинты отвечают `503 { "error": "database_unavailable" }`,
и фронтенд продолжает работать на моках.

## 4. Подключить фронтенд

Прокси `/api → localhost:4000` **уже настроен** в `vite.config.ts`. Достаточно:

```bash
npm run dev     # корень проекта, :5173
```

Страница «Обзор» уже читает `GET /api/curves/current` (файл `src/pages/OverviewPage.tsx`,
хук `useApi` из `src/api/client.ts`). Паттерн подключения остальных страниц тот же:
`const { data, live } = useApi('/portfolios', PORTFOLIOS)` — пока бэкенд молчит, рендерятся
моки, `live === true` означает, что данные пришли с сервера.

## Эндпоинты

| Метод и путь | Данные (таблицы) | Экран |
|---|---|---|
| `GET /api/health` | `SELECT 1` | диагностика |
| `GET /api/tenors` | `ref.time_bucket` | справочник теноров |
| `GET /api/curves/current` | `market.curve` + `curve_point` | Обзор, Сравнение |
| `GET /api/curves/history?limit=` | `market.curve` + `curve_point` | История кривых |
| `GET /api/curves/stress?as_of=&r_parallel=…` | `market.curve_point` + порт `irrbb_core` | Стресс-кривые на дату, 7×19 (BCBS 368) |
| `GET /api/curves/stress/history?limit=` | то же, сводка по датам | История стресс-кривых (наклон, мин/макс) |
| `GET /api/portfolios` | `app.portfolio` + агрегаты | Портфели |
| `GET /api/portfolios/:id` | `app.portfolio_instrument` | Портфели, карточка |
| `GET /api/scenarios` | `app.scenario` | Сценарии сдвигов |
| `GET /api/calculations/latest` | `calc.curve_run` + `run_base_result` + `run_summary` + `run_scenario` | Результаты, AI-аналитика |
| `GET /api/calculations/:id/instruments?limit=&offset=` | `calc.run_instrument_result` | Детализация (пагинация 10/20/50) |
| `GET /api/llm-analysis/latest` | `calc.llm_analysis` | AI-аналитика |
| `GET /api/sources` | `app.source_status` | Настройки → Источники |
| `GET /api/users` | `auth.user_account` + `user_session` | Настройки → Пользователи |

## Правила маппинга (что считается на лету, согласно документу IRRBB)

- **Дни до погашения** = `round(tenor_years * 365)` (база 365).
- **Изменение к прошлой дате, п.п.** = `rate_pct` минус `rate_pct` того же тенора на
  предыдущей принятой ревизии (`status = 'accepted'`).
- **«Нет данных» по тенору** = тенор есть в `ref.time_bucket`, точки в `market.curve_point`
  нет; сопоставление по `tenor_years`. Нулевая доходность остаётся нулём.
- **Шоки сценария, б.п.** = `calc.stressed_curve_point.shift_pp * 100` (отдельная таблица
  шоков не нужна; в `app.scenario.params` не лезем).
- **Время выполнения** = `finished_at - started_at` в `calc.curve_run`.
- **ЭКпрбк и сценарий-минимум** не вычисляются ни БД, ни фронтом — только из
  `calc.run_summary` (заполняет Calculator).
- **Деньги — только RUB**; NULL = «нет данных», 0 — валидное значение.

## Справочники и роли

- **Роли БД** (`viewer`, `editor`, `auditor`, `admin`) ≠ роли фронта (`viewer`, `analyst`,
  `admin`). Согласуйте маппинг при интеграции (предположение: `editor/auditor` → `analyst`).
- **Типы инструментов БД**: `bond_ofz`, `bond_corp`, `loan`, `deposit`, `current_account`,
  `other` ↔ коды фронта: `ofz`, `corporate`, `deposit` (+ `municipal` при необходимости).
- Подписи статусов («Подключено», «Данные устарели»…) — константы на фронте
  (`SOURCE_STATUS_LABELS`), в БД только коды.

## Что осталось за рамками MVP (точки роста)

- POST `/api/calculations` — постановка расчёта в очередь `calc.curve_run` с
  `idempotency_key` (кнопка «Запустить расчёт» сейчас ведёт на демо-экран `/run`).
- POST `/api/exports` — задачи `app.export_job` (xlsx через S3/MinIO; для Node-генерации
  подходит `exceljs`).
- Аутентификация по `auth.user_session` (сейчас API открыт на чтение; добавьте middleware
  при подключении реального входа).
