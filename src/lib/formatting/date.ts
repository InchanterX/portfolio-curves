/**
 * Даты по модели Metabase (frontend/src/metabase/lib/formatting/date.tsx):
 * единая точка входа formatDateTime(value, unit?) вместо разрозненных хелперов.
 */

export type DateUnit = 'default' | 'date' | 'time' | 'datetime' | 'month-year';

function asDate(value: string | number | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value: string | number | Date | null | undefined, unit: DateUnit = 'default'): string {
  if (value === null || value === undefined) return '—';
  const d = asDate(value);
  if (!d) return String(value);

  switch (unit) {
    case 'date':
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    case 'time':
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    case 'month-year':
      return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    case 'datetime':
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
    default:
      return d.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
  }
}
