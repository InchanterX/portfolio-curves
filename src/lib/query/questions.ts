/**
 * Декларативные «вопросы» (Metabase: question = запрос + настройки отображения).
 * Каждый вопрос знает эндпоинт API и мок-fallback в форме dataset:
 * страница не собирает данные руками, только выбирает вопрос.
 */
import { CURVE_CURRENT, CURVE_PREVIOUS, TENORS } from '../../data/mock';
import type { Question } from './types';

const tenorLabel = (code: string) => TENORS.find((t) => t.code === code)?.label ?? code;

export const QUESTIONS = {
  /** Точки текущей кривой — вкладка «Таблица» на Обзоре */
  curvePoints: {
    endpoint: '/curves/current/points',
    fallback: {
      cols: [
        { name: 'Срок', semanticType: 'text' as const },
        { name: 'Дней до погашения', semanticType: 'number' as const },
        { name: 'Дата оценки', semanticType: 'date' as const },
        { name: 'Доходность', semanticType: 'percent' as const },
        { name: 'Изменение', semanticType: 'delta-pp' as const },
      ],
      rows: CURVE_CURRENT.points.map((p) => [
        tenorLabel(p.tenorCode),
        p.daysToMaturity,
        CURVE_CURRENT.curveDate,
        p.yieldPct,
        p.changePp,
      ]),
    },
  },

  /** Сравнение двух дат — Обзор/Сравнение и страница «Сравнение дат» */
  curveCompare: {
    endpoint: '/curves/compare',
    fallback: {
      cols: [
        { name: 'Срок', semanticType: 'text' as const },
        { name: 'Текущая', semanticType: 'percent' as const },
        { name: 'Предыдущая', semanticType: 'percent' as const },
        { name: 'Δ, п.п.', semanticType: 'delta-pp' as const },
      ],
      rows: TENORS.map((t, i) => [
        t.label,
        CURVE_CURRENT.points[i]?.yieldPct ?? null,
        CURVE_PREVIOUS.points[i]?.yieldPct ?? null,
        CURVE_CURRENT.points[i]?.changePp ?? null,
      ]),
    },
  },
} satisfies Record<string, Question>;
