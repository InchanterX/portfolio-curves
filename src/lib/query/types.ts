/**
 * Dataset по модели Metabase: результат «вопроса» (question) в виде
 * колонок с метаданными + строк значений. Форматирование ячеек выбирается
 * semanticType колонки (см. src/lib/formatting/value.ts).
 */
import type { ColumnFormat, SemanticType } from '../formatting/value';

export interface DatasetColumn extends ColumnFormat {
  name: string;
  semanticType?: SemanticType;
  /** явное выравнивание; по умолчанию числа — вправо */
  align?: 'left' | 'right';
}

export interface Dataset {
  cols: DatasetColumn[];
  rows: unknown[][];
}

export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

/** Декларативный «вопрос»: эндпоинт + мок-фолбэк в форме dataset. */
export interface Question {
  endpoint: string;
  fallback: Dataset;
}

const NUMERIC: SemanticType[] = ['number', 'percent', 'delta-pp', 'bps', 'currency', 'currency-mln', 'share'];

export function isNumericColumn(col: DatasetColumn): boolean {
  return col.semanticType !== undefined && NUMERIC.includes(col.semanticType);
}

/** Колонка датасета → CSS-выравнивание ячеек */
export function datasetColumnAlign(col: DatasetColumn): 'left' | 'right' {
  return col.align ?? (isNumericColumn(col) ? 'right' : 'left');
}
