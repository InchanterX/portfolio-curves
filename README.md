# GCURVE — Анализ процентного риска (IRRBB)

Фронтенд платформы аналитики кривой ОФЗ: кривые, портфели, сценарии сдвигов, расчёты
NPV/NII и ЭКпрбк, AI-аналитика, настройки. React 19 + TypeScript + Vite.

## Команды

```bash
npm run dev     # dev-сервер :5173 (проксирует /api -> http://localhost:4000)
npm run build   # tsc -b && vite build
npm run lint    # oxlint
```

## Бэкенд

В [`backend/`](backend/) — REST API (Express + pg) поверх Postgres 16 по схемам
`auth / ref / market / app / calc / audit`. Миграция — `backend/irrbb_migration.sql`,
демо-данные — `backend/seed.sql`. Фронтенд при недоступном API прозрачно работает
на моках (`src/api/client.ts`). Пошаговое подключение — в **[BACKEND.md](BACKEND.md)**.

## Архитектура фронтенда (по мотивам Metabase)

Идеи и API-модели взяты из [metabase/metabase](https://github.com/metabase/metabase)
(переосмыслены под React 19 + TypeScript, без прямого копирования — Metabase под AGPL-3.0,
копипаст кода в закрытый проект недопустим без открытия исходников):

| Слой | У нас | Аналог в Metabase |
|---|---|---|
| Форматирование | `src/lib/formatting/` (`formatNumber` с `numberStyle/decimals/scale`, `formatDateTime`, `formatValue(value, {column})` — формат по метаданным колонки) | `lib/formatting/number|date|value` |
| Таблицы | `DataTable` на **TanStack Table v8** (та же версия, что у них), dataset-режим: `cols` с `semanticType` + `rows`, сортировка/пагинация; `pageSize <= 0` отключает пагинацию | `data-grid/use-data-grid-instance` |
| Данные | «Вопросы» `src/lib/query/questions.ts` + `useDataset` — декларативный эндпоинт + мок-fallback, ответ в форме `dataset { cols, rows }` | question → dataset |
| Графики | реестр визуализаций `src/visualizations/Visualization.tsx` (`display: 'line'`, настройки вида `graph.y_axis.format`), рендер — наш SVG `CurveChart` | `visualizations` + `registerVisualization` |
| Палитра | `src/lib/colors.ts` — `color('brand')`, серия `accentColors` для многосерийных графиков | `lib/colors` |

