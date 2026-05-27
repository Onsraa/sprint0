// BarChart — dependency-free horizontal bars (styled divs). Each bar is scaled
// against `max` (defaults to the largest value). `format` renders the trailing
// value label; `colorFor` lets callers color bars by threshold (e.g. >100%).

export interface BarDatum {
  label: string;
  value: number;
}

export function BarChart({
  data,
  max,
  format = (v) => String(v),
  colorFor,
}: {
  data: BarDatum[];
  max?: number;
  format?: (v: number) => string;
  colorFor?: (v: number) => string;
}) {
  const peak = max ?? Math.max(1, ...data.map((d) => d.value));

  return (
    <div role="img" aria-label="bar chart">
      {data.map((d) => {
        const pct = Math.min(100, Math.max(0, (d.value / peak) * 100));
        const color = colorFor ? colorFor(d.value) : 'var(--accent)';
        return (
          <div className="bar-row" key={d.label}>
            <span className="bar-name" title={d.label}>
              {d.label}
            </span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${pct}%`, background: color }}
              />
            </span>
            <span className="bar-val">{format(d.value)}</span>
          </div>
        );
      })}
    </div>
  );
}
