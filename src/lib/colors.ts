/**
 * Палитра по модели Metabase (frontend/src/metabase/lib/colors/):
 * именованные цвета + акцентная серия для графиков. Значения читаются из
 * CSS-переменных темы, поэтому светлая/тёмная темы переключаются сами.
 */

export const colors = {
  brand: '#7c5cfc',
  brandLight: '#9d7bff',
  summarize: '#8b5cf6',
  success: '#2fbf71',
  error: '#f4506a',
  warning: '#e8a13c',
  info: '#4aa8ff',
} as const;

export type ColorName = keyof typeof colors;

/** Цвет по имени (Metabase: color('brand')) */
export function color(name: ColorName): string {
  return colors[name];
}

/** Серия для многострочных графиков — как harmonizeColors у Metabase */
export const accentColors: string[] = [
  colors.brand,
  colors.success,
  colors.warning,
  colors.error,
  colors.info,
  '#c084fc',
  '#22c1a3',
];
