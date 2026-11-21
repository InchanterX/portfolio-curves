interface BarRow {
  label: string;
  value: number; // млн ₽, знак задаёт направление
}

interface Props {
  rows: BarRow[];
  format?: (v: number) => string;
}

/** Горизонтальные бары «влияние на NPV» относительно нулевой оси */
export function ImpactBars({ rows, format = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} млн ₽` }: Props) {
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <div className="bars">
      {rows.map((r) => {
        const wPct = (Math.abs(r.value) / maxAbs) * 46;
        const positive = r.value >= 0;
        return (
          <div className="bar-row" key={r.label}>
            <span className="muted">{r.label}</span>
            <div className="bar-track">
              <span className="bar-zero" />
              <span
                className="bar-fill"
                style={{
                  left: positive ? '50%' : `${50 - wPct}%`,
                  width: `${wPct}%`,
                  background: positive ? 'var(--green)' : 'var(--red)',
                  opacity: 0.75,
                }}
              />
            </div>
            <span className={`bar-val num ${positive ? 'pos' : 'neg'}`}>{format(r.value)}</span>
          </div>
        );
      })}
    </div>
  );
}
