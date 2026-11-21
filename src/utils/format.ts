/**
 * Совместимость со старым API форматирования. Ядро — src/lib/formatting/*
 * (модель Metabase: formatNumber/formatDateTime/formatValue). Новый код должен
 * ходить через lib/formatting напрямую.
 */
import { formatDateTime } from '../lib/formatting/date';
import { formatNumber } from '../lib/formatting/number';

/** Доходность / ставка, % годовых */
export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Нет данных';
  return formatNumber(v, { numberStyle: 'percent', signed: false });
}

/** Изменение в п.п. */
export function fmtPp(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Нет данных';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(v), { signed: false })} п.п.`;
}

/** Шок в б.п. */
export function fmtBps(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Нет данных';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(v), { signed: false, decimals: 0 })} б.п.`;
}

/** Сумма в млн ₽ (абсолютное значение, без знака) */
export function fmtMln(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Нет данных';
  return formatNumber(v, { numberStyle: 'compact', signed: false });
}

/** Дельта в млн ₽ со знаком */
export function fmtMlnDelta(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Нет данных';
  return formatNumber(v, { numberStyle: 'compact' });
}

/** Сумма в ₽ с разделителями */
export function fmtRub(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Нет данных';
  return formatNumber(v, { numberStyle: 'currency', decimals: 0, signed: false });
}

/** Абсолютная дельта в ₽ */
export function fmtDeltaRub(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Нет данных';
  return formatNumber(v, { numberStyle: 'currency', decimals: 0 });
}

/** Доля, % */
export function fmtShare(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Нет данных';
  const sign = v > 0 ? '+' : '−';
  return `${sign}${formatNumber(Math.abs(v), { signed: false })} %`;
}

export function fmtDate(iso: string): string {
  return formatDateTime(iso, 'date');
}

export function fmtDateTime(iso: string): string {
  return formatDateTime(iso, 'datetime');
}

export function fmtTime(iso: string): string {
  return formatDateTime(iso, 'time');
}

/** numeric(24,4) → строка с 4 знаками (для таблиц детализации) */
export function fmtNum4(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Нет данных';
  return formatNumber(v, { decimals: 4, signed: false });
}
