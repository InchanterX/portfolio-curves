import { useMemo, useState, type ReactNode } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { formatValue, type ColumnFormat } from '../lib/formatting/value';
import { datasetColumnAlign, type Dataset } from '../lib/query/types';

/**
 * Таблица на TanStack Table v8 — тот же движок, что у data-grid Metabase
 * (frontend/src/metabase/data-grid/hooks/use-data-grid-instance.tsx):
 * сортировка через getSortedRowModel, пагинация getPaginationRowModel
 * (pageSize <= 0 отключает её — как DISABLED_PAGINATION_STATE у Metabase).
 *
 * Два режима входных данных:
 *  1. dataset (модель Metabase): cols с semanticType/formatOptions — ячейки
 *     форматируются сами через formatValue;
 *  2. columns/rows (объекты) — обратная совместимость, миграция на dataset постепенная.
 */

export interface Column<T> {
  key: string;
  title: string;
  render: (row: T, index: number) => ReactNode;
  sortValue?: (row: T) => number | string | null;
  align?: 'left' | 'right';
  /** опционально: форматирование по колонке (форматтер получает значение sortValue) */
  format?: ColumnFormat;
}

interface DatasetProps {
  dataset: Dataset;
  pageSize?: number;
  onRowClick?: (row: unknown[], index: number) => void;
  isRowSelected?: (row: unknown[], index: number) => boolean;
}

interface LegacyProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  isRowSelected?: (row: T) => boolean;
  pageSize?: number;
  empty?: ReactNode;
}

function compareValues(a: number | string | null, b: number | string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), 'ru');
}

/* ------------------------- dataset-режим ------------------------- */

const columnHelper = createColumnHelper<unknown[]>();

function DatasetTable({ dataset, pageSize = 10, onRowClick, isRowSelected }: DatasetProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const cols = dataset.cols;

  const columns = useMemo(
    () =>
      cols.map((col, colIndex) =>
        columnHelper.accessor((row) => row[colIndex], {
          id: String(colIndex),
          enableSorting: true,
          sortingFn: (a, b) => compareValues(a.original[colIndex] as never, b.original[colIndex] as never),
          cell: (info) => {
            const raw = info.getValue();
            const formatted = formatValue(raw, col);
            const numeric = col.semanticType && col.semanticType !== 'text' && col.semanticType !== 'date' && col.semanticType !== 'datetime';
            const negative = typeof raw === 'number' && raw < 0;
            const positive = typeof raw === 'number' && raw > 0 && (col.semanticType === 'delta-pp' || col.semanticType === 'share' || col.semanticType === 'bps');
            return (
              <span className={`${numeric ? 'num' : ''} ${negative ? 'neg' : positive ? 'pos' : ''}`}>
                {colIndex === 0 ? <b>{formatted}</b> : formatted}
              </span>
            );
          },
        }),
      ),
    [cols],
  );

  // Metabase: pageSize <= 0 отключает пагинацию (DISABLED_PAGINATION_STATE)
  const enablePagination = pageSize > 0;

  const table = useReactTable<unknown[]>({
    data: dataset.rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: enablePagination ? getPaginationRowModel() : undefined,
    ...(enablePagination ? { initialState: { pagination: { pageSize } } } : {}),
  });

  const model = table.getRowModel();
  const total = dataset.rows.length;
  const pageIndex = enablePagination ? table.getState().pagination.pageIndex : 0;
  const shownPageSize = enablePagination ? table.getState().pagination.pageSize : total;

  return (
    <div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header, i) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className="sortable"
                      style={{ textAlign: datasetColumnAlign(cols[i]) }}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {cols[i].name}
                      {sorted === 'asc' ? <span className="thead-sort">▲</span> : sorted === 'desc' ? <span className="thead-sort">▼</span> : null}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr
                key={row.id}
                className={`${onRowClick ? 'clickable' : ''} ${isRowSelected?.(row.original, row.index) ? 'selected-row' : ''}`}
                onClick={() => onRowClick?.(row.original, row.index)}
              >
                {row.getVisibleCells().map((cell, i) => (
                  <td key={cell.id} style={{ textAlign: datasetColumnAlign(cols[i]) }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {enablePagination && total > pageSize && (
        <Pagination
          from={pageIndex * shownPageSize + 1}
          to={Math.min((pageIndex + 1) * shownPageSize, total)}
          total={total}
          page={pageIndex + 1}
          pages={table.getPageCount()}
          onPage={(p) => table.setPageIndex(p - 1)}
        />
      )}
    </div>
  );
}

function Pagination(props: { from: number; to: number; total: number; page: number; pages: number; onPage: (p: number) => void; label?: string }) {
  return (
    <div className="pagination">
      <span>
        {props.from}–{props.to} из {props.total}
      </span>
      {Array.from({ length: props.pages }, (_, i) => (
        <button key={i} className={`page ${props.page === i + 1 ? 'active' : ''}`} onClick={() => props.onPage(i + 1)}>
          {i + 1}
        </button>
      ))}
    </div>
  );
}

/* ------------------------- legacy-режим ------------------------- */

function LegacyTable<T>({ columns, rows, rowKey, onRowClick, isRowSelected, pageSize = 10, empty }: LegacyProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => compareValues(col.sortValue!(a), col.sortValue!(b)) * sort.dir);
  }, [rows, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages);
  const slice = sorted.slice((cur - 1) * pageSize, cur * pageSize);

  if (!rows.length && empty) return <>{empty}</>;

  return (
    <div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.sortValue ? 'sortable' : ''}
                  style={{ textAlign: c.align }}
                  onClick={() => {
                    if (!c.sortValue) return;
                    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }));
                  }}
                >
                  {c.title}
                  {sort?.key === c.key && <span className="thead-sort">{sort.dir === 1 ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className={`${onRowClick ? 'clickable' : ''} ${isRowSelected?.(row) ? 'selected-row' : ''}`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align }}>
                    {c.render(row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <Pagination
          from={(cur - 1) * pageSize + 1}
          to={Math.min(cur * pageSize, sorted.length)}
          total={sorted.length}
          page={cur}
          pages={pages}
          onPage={setPage}
        />
      )}
    </div>
  );
}

export function DataTable<T>(props: LegacyProps<T>): ReactNode;
export function DataTable(props: DatasetProps): ReactNode;
export function DataTable<T>(props: LegacyProps<T> | DatasetProps) {
  if ('dataset' in props) {
    return <DatasetTable {...props} />;
  }
  return <LegacyTable {...props} />;
}
