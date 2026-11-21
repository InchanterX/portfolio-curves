/**
 * formatValue по модели Metabase (frontend/src/metabase/lib/formatting/value.tsx):
 * форматирование выбирается метаданными колонки, а не вручную в каждой ячейке.
 *
 *   formatValue(v, { semanticType: 'percent' })  → «16,52 %»
 *   formatValue(v, { semanticType: 'delta-pp' }) → «+0,16 п.п.»
 *
 * Таблица задаёт колонкам semanticType/formatOptions — и ячейки форматируются сами.
 */
import { formatDateTime } from './date';
import { formatNumber, type FormatNumberOptions } from './number';

export type SemanticType =
  | 'text'
  | 'number'
  | 'percent'
  | 'delta-pp'
  | 'bps'
  | 'currency'
  | 'currency-mln'
  | 'share'
  | 'date'
  | 'datetime';

export interface ColumnFormat {
  semanticType?: SemanticType;
  formatOptions?: FormatNumberOptions;
}

const signedPrefix = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');

export function getColumnFormatter(column: ColumnFormat = {}): (value: unknown) => string {
  const { semanticType = 'text', formatOptions } = column;

  return (value: unknown) => {
    if (value === null || value === undefined) return 'Нет данных';

    switch (semanticType) {
      case 'number':
        return formatNumber(value as number, { signed: false, ...formatOptions });
      case 'percent':
        return formatNumber(value as number, { numberStyle: 'percent', signed: false, ...formatOptions });
      case 'delta-pp': {
        const v = value as number;
        return `${signedPrefix(v)}${formatNumber(Math.abs(v), { signed: false, decimals: 2, ...formatOptions })} п.п.`;
      }
      case 'bps': {
        const v = value as number;
        return `${signedPrefix(v)}${formatNumber(Math.abs(v), { signed: false, decimals: 0, ...formatOptions })} б.п.`;
      }
      case 'currency':
        return formatNumber(value as number, { numberStyle: 'currency', decimals: 0, ...formatOptions });
      case 'currency-mln':
        return formatNumber(value as number, { numberStyle: 'compact', ...formatOptions });
      case 'share': {
        const v = value as number;
        return `${signedPrefix(v)}${formatNumber(Math.abs(v), { signed: false, decimals: 2, ...formatOptions })} %`;
      }
      case 'date':
        return formatDateTime(value as string, 'date');
      case 'datetime':
        return formatDateTime(value as string, 'datetime');
      default:
        return String(value);
    }
  };
}

export function formatValue(value: unknown, column: ColumnFormat = {}): string {
  return getColumnFormatter(column)(value);
}
