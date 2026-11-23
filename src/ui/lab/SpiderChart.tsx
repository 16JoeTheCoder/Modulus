import type { ISpiderMetrics } from '../../core/types';

interface SpiderChartProps {
  spider: ISpiderMetrics;
}

const AXES: Array<{ key: keyof ISpiderMetrics; label: string; short: string }> = [
  { key: 'acceleration', label: 'Acceleration', short: 'ACC' },
  { key: 'topSpeed', label: 'Top Speed', short: 'SPD' },
  { key: 'corneringG', label: 'Cornering G', short: 'GRIP' },
  { key: 'braking', label: 'Braking', short: 'BRK' },
  { key: 'thermalStability', label: 'Thermal', short: 'THRM' },
  { key: 'aeroEfficiency', label: 'Aero Eff.', short: 'AERO' },
];

export function SpiderChart({ spider }: SpiderChartProps) {
  const cx = 100;
  const cy = 96;
  const maxR = 68;
  const rings = [0.25, 0.5, 0.75, 1.0];

  const pointAt = (index: number, frac: number): { x: number; y: number } => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / AXES.length;
    return {
      x: cx + Math.cos(angle) * maxR * frac,
      y: cy + Math.sin(angle) * maxR * frac,
    };
  };

  const dataPolygon = AXES.map((axis, idx) => {
    const val = Math.max(0, Math.min(100, spider[axis.key])) / 100;
    const p = pointAt(idx, val);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#0D1118]/90 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          Spider-Balance Diamond
        </span>
        <span className="font-mono text-[10px] text-cyan-400">6-AXIS INDEX</span>
      </div>

      <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[160px_1fr]">
        <svg viewBox="0 0 200 192" className="mx-auto h-36 w-40 select-none">
          {rings.map((ring) => {
            const pts = AXES.map((_, idx) => {
              const p = pointAt(idx, ring);
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            }).join(' ');
            return (
              <polygon
                key={ring}
                points={pts}
                fill="none"
                stroke="#1E293B"
                strokeWidth={ring === 1 ? 1.2 : 0.8}
              />
            );
          })}

          {AXES.map((axis, idx) => {
            const outer = pointAt(idx, 1);
            const labelPt = pointAt(idx, 1.22);
            return (
              <g key={axis.key}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={outer.x}
                  y2={outer.y}
                  stroke="#1E293B"
                  strokeWidth={0.8}
                />
                <text
                  x={labelPt.x}
                  y={labelPt.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-slate-400 font-mono text-[9px] font-semibold"
                >
                  {axis.short}
                </text>
              </g>
            );
          })}

          <polygon
            points={dataPolygon}
            fill="rgba(0, 240, 255, 0.22)"
            stroke="#00F0FF"
            strokeWidth={1.8}
            strokeLinejoin="round"
          />

          {AXES.map((axis, idx) => {
            const val = Math.max(0, Math.min(100, spider[axis.key])) / 100;
            const p = pointAt(idx, val);
            return (
              <circle
                key={axis.key}
                cx={p.x}
                cy={p.y}
                r={2.8}
                fill="#00F0FF"
                stroke="#0A0C10"
                strokeWidth={1}
              />
            );
          })}
        </svg>

        <div className="space-y-1.5">
          {AXES.map((axis) => {
            const score = Math.round(spider[axis.key]);
            const barColor =
              score >= 75
                ? 'bg-cyan-400'
                : score >= 50
                ? 'bg-emerald-400'
                : score >= 30
                ? 'bg-amber-400'
                : 'bg-rose-500';
            return (
              <div key={axis.key} className="space-y-0.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">{axis.label}</span>
                  <span className="font-mono font-semibold text-slate-200">{score}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${barColor}`}
                    style={{ width: `${Math.max(4, Math.min(100, score))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
