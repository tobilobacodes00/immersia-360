import type { TrendPoint } from '@/server/admin-metrics';

/**
 * A weekly trend as a small line: a server-rendered SVG, no script. Weeks with no data leave a gap
 * rather than a zero. It is decoration for sighted readers (`aria-hidden`); the same numbers are in
 * the table-like list below it on the page, so nothing is conveyed by the picture alone.
 */
export function Sparkline({
  points,
  tone = 'ink',
  min = 0,
  max,
}: {
  points: TrendPoint[];
  tone?: 'ok' | 'bad' | 'ink';
  /** The scale's floor (default 0) and ceiling (default: the largest value). */
  min?: number;
  max?: number;
}) {
  const W = 132;
  const H = 36;
  const values = points.map((p) => p.value);
  const real = values.filter((v): v is number => v !== null);
  if (real.length === 0) return <div className="h-9 text-[13px] text-faint">No data yet</div>;
  const top = max ?? Math.max(...real, min + 1e-9);
  const span = Math.max(top - min, 1e-9);
  const x = (i: number) => (points.length === 1 ? W / 2 : 3 + (i * (W - 6)) / (points.length - 1));
  const y = (v: number) => H - 4 - ((Math.min(Math.max(v, min), top) - min) / span) * (H - 8);
  // Runs of consecutive weeks with data, so a gap is a gap; a lone week is a dot.
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push([x(i), y(v)]);
  });
  if (run.length) runs.push(run);
  const color = tone === 'ok' ? 'var(--color-ok)' : tone === 'bad' ? 'var(--color-bad)' : 'var(--color-ink)';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden className="overflow-visible">
      {runs.map((r) =>
        r.length > 1 ? (
          <polyline
            key={r[0]!.join()}
            points={r.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null,
      )}
      {runs.map((r) => {
        const [px, py] = r.at(-1)!;
        return <circle key={`${px}-${py}`} cx={px} cy={py} r={r.length === 1 ? 3 : 2.5} fill={color} />;
      })}
    </svg>
  );
}
