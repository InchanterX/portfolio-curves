-- =====================================================================
-- GCURVE: демонстрационные данные поверх irrbb_migration.sql
-- Перезапускаемо: проверки на существование, ничего не ломает.
-- Запуск: psql -d irrbb -f backend/seed.sql
-- =====================================================================
BEGIN;

-- Организация и демо-пользователь (email в нижнем регистре — под uq_user_account_email)
INSERT INTO app.organization (name)
SELECT 'ООО «ГКАПИТАЛ»'
 WHERE NOT EXISTS (SELECT 1 FROM app.organization WHERE name = 'ООО «ГКАПИТАЛ»');

INSERT INTO auth.user_account (email, display_name, password_hash, role, status, email_confirmed_at)
SELECT 'sonya@company.ru', 'Соня Иванова', 'demo-not-a-real-hash', 'admin', 'active', now()
 WHERE NOT EXISTS (SELECT 1 FROM auth.user_account WHERE lower(email) = 'sonya@company.ru');

UPDATE auth.user_account
   SET organization_id = (SELECT id FROM app.organization WHERE name = 'ООО «ГКАПИТАЛ»')
 WHERE email = 'sonya@company.ru'
   AND organization_id IS NULL;

-- Портфели (имена как на экране «Портфели»)
INSERT INTO app.portfolio (organization_id, name, version_no, created_by_user_id)
SELECT o.id, x.name, x.version_no, u.id
  FROM app.organization o
  JOIN auth.user_account u ON u.email = 'sonya@company.ru'
  JOIN (VALUES
      ('ОФЗ · Основной', 17),
      ('Ликвидный резерв', 9),
      ('Денежные облигации', 5)
  ) AS x(name, version_no) ON TRUE
 WHERE NOT EXISTS (
       SELECT 1 FROM app.portfolio p
        WHERE p.organization_id = o.id AND p.name = x.name AND p.deleted_at IS NULL);

-- Позиции основного портфеля (ISIN из демо-моков фронтенда)
INSERT INTO app.portfolio_instrument
    (portfolio_id, instrument_code, instrument_type_code, name, nominal_rub,
     interest_rate_pct, maturity_date, status, source_updated_at)
SELECT p.id, x.code, 'bond_ofz', x.name, x.nominal, x.rate, x.maturity::date, 'active', now()
  FROM app.portfolio p
  JOIN (VALUES
      ('RU000A1038V3', 'ОФЗ 26238',  7340000, 7.10, '2043-05-15'),
      ('RU000A101C78', 'ОФЗ 26240', 12384000, 6.90, '2042-07-21'),
      ('RU000A101K89', 'ОФЗ 26243', 21410900, 7.00, '2038-05-05'),
      ('RU000A102EJ9', 'ОФЗ 26244', 27906000, 6.70, '2036-03-06'),
      ('RU000A103TW1', 'ОФЗ 26246', 21087000, 6.40, '2034-02-15')
  ) AS x(code, name, nominal, rate, maturity) ON TRUE
 WHERE p.name = 'ОФЗ · Основной' AND p.deleted_at IS NULL
   AND NOT EXISTS (
       SELECT 1 FROM app.portfolio_instrument pi
        WHERE pi.portfolio_id = p.id AND pi.instrument_code = x.code AND pi.deleted_at IS NULL);

-- Статусы источников
UPDATE app.source_status
   SET status = 'connected', last_success_at = now() - interval '2 hours'
 WHERE source IN ('moex', 'calculator');

UPDATE app.source_status
   SET status = 'stale', last_success_at = now() - interval '30 hours'
 WHERE source = 'llm';

-- Описания типовых сценариев (если строки есть в каталоге)
UPDATE app.scenario
   SET description = 'Одинаковый сдвиг всех сроков кривой вверх на 100 базисных пунктов. Базовый стресс роста ставок.',
       approval_status = 'approved', is_mandatory = true
 WHERE shift_type = 'parallel_up' OR code ILIKE '%parallel%up%';

UPDATE app.scenario
   SET description = 'Разворот наклона: короткие сроки растут, длинные падают.',
       approval_status = 'approved', is_mandatory = true
 WHERE shift_type IN ('twist', 'steepener', 'flattener');

COMMIT;
