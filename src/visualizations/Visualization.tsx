import type { ReactNode } from 'react';
import { CurveChart } from '../components/CurveChart';

/**
 * Реестр визуализаций по модели Metabase
 * (frontend/src/metabase/visualizations/index.js): компонент выбирается
 * ключом display ('line'), настройки графика едут отдельным объектом
 * settings — как «graph.*» у Metabase.
 */

export type DisplayType = 'line';

export interface Series {
  label: string;
  values: (number | null)[];
  color?: string;
  dashed?: boolean;
}

export interface ChartSettings {
  /** формат подписей оси Y (Metabase: graph.y_axis.format) */
  'graph.y_axis.format'?: (v: number) => string;
  height?: number;
}

export interface VisualizationProps {
  display: DisplayType;
  labels: string[];
  series: Series[];
  settings?: ChartSettings;
  height?: number;
}

type VisualizationRender = (props: VisualizationProps) => ReactNode;

const registry: Record<DisplayType, VisualizationRender> = {
  line: ({ labels, series, settings, height }) => (
    <CurveChart
      labels={labels}
      series={series}
      height={height ?? settings?.height ?? 300}
      yFormat={settings?.['graph.y_axis.format'] ?? ((v) => String(v))}
    />
  ),
};

/** Добавить/переопределить тип визуализации (Metabase: registerVisualization). */
export function registerVisualization(display: DisplayType, render: VisualizationRender) {
  registry[display] = render;
}

export function Visualization(props: VisualizationProps) {
  return <>{registry[props.display](props)}</>;
}
