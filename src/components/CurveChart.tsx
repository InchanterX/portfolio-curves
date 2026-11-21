import { useId, useMemo, useState } from 'react';

export interface Series {
  label: string;
  color?: string;
  dashed?: boolean;
  /** (xIndex, value) pairs; null пропускается */
  values: (number | null)[];
}

interface Props {
  labels: string[];
  series: Series[];
  height?: number;
  yFormat?: (v: number) => string;
  yTicks?: number;
  compareIndex?: number; // индекс базовой серии для подсветки Δ (не обязательно)
  accent?: string;
}

const PAD = { l: 44, r: 14, t: 14, b: 30 };

export function CurveChart({
  labels,
  series,
  height = 260,
  yFormat = (v) => `${v}%`,
  yTicks = 5,
  accent = 'var(--accent)',
}: Props) {
  const gid = useId().replace(/[:]/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const minV = Math.floor((all.length ? Math.min(...all) : 0) * 10) / 10 - 0.15;
  const maxV = Math.ceil((all.length ? Math.max(...all) : 1) * 10) / 10 + 0.15;

  const w = 640;
  const iw = w - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;

  const x = (i: number) => PAD.l + (i / Math.max(labels.length - 1, 1)) * iw;
  const y = (v: number) => PAD.t + ((maxV - v) / (maxV - minV)) * ih;

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < yTicks; i++) {
      out.push(Number((minV + ((maxV - minV) / (yTicks - 1)) * i).toFixed(2)));
    }
    return out;
  }, [minV, maxV, yTicks]);

  function linePath(values: (number | null)[]): string {
    let d = '';
    values.forEach((v, i) => {
      if (v === null) return;
      d += d ? ` L ${x(i).toFixed(1)} ${y(v).toFixed(1)}` : `M ${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    });
    return d;
  }

  function areaPath(values: (number | null)[]): string {
    const pts = values
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean) as string[];
    if (pts.length < 2) return '';
    const first = pts[0].split(',')[0];
    const last = pts[pts.length - 1].split(',')[0];
    const base = (PAD.t + ih).toFixed(1);
    return `M ${first} ${base} L ${pts.join(' L ')} L ${last} ${base} Z`;
  }

  const labelEvery = Math.ceil(labels.length / 6);

  return (
    <div className="chart-root" style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * w;
          const idx = Math.round(((px - PAD.l) / iw) * (labels.length - 1));
          setHover(idx >= 0 && idx < labels.length ? idx : null);
        }}
      >
        <defs>
          <linearGradient id={`area-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" />
            <text x={PAD.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-3)">
              {yFormat(Number(t.toFixed(2)))}
            </text>
          </g>
        ))}

        {labels.map((l, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--text-3)">
              {l}
            </text>
          ) : null,
        )}

        {series.map((s, si) => {
          const color = s.color ?? accent;
          const isArea = si === series.length - 1 && !s.dashed;
          return (
            <g key={si}>
              {isArea && <path d={areaPath(s.values)} fill={`url(#area-${gid})`} />}
              <path
                d={linePath(s.values)}
                fill="none"
                stroke={color}
                strokeWidth={s.dashed ? 1.6 : 2.4}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--border-strong)" strokeDasharray="3 3" />
            {series.map((s, si) => {
              const v = s.values[hover];
              if (v === null || v === undefined) return null;
              return (
                <circle
                  key={si}
                  cx={x(hover)}
                  cy={y(v)}
                  r={s.dashed ? 3.5 : 4.5}
                  fill="var(--surface)"
                  stroke={s.color ?? accent}
                  strokeWidth={2}
                />
              );
            })}
          </g>
        )}
      </svg>

      {hover !== null && (
        <div
          className="chart-tip"
          style={{
            position: 'absolute',
            top: 6,
            left: `${(x(hover) / 640) * 100}%`,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
          }}
        >
          <div className="chart-tip-title">{labels[hover]}</div>
          {series.map((s, si) => {
            const v = s.values[hover];
            if (v === null || v === undefined) return null;
            return (
              <div key={si} className="chart-tip-row">
                <span className="chart-tip-dot" style={{ background: s.color ?? accent }} />
                {s.label}: <b>{yFormat(v)}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
