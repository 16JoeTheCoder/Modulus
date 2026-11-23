import type { ICompiledVehicle } from '../../core/types';

interface DynoChartProps {
  compiled: ICompiledVehicle;
}

export function DynoChart({ compiled }: DynoChartProps) {
  const curve = compiled.dynoCurve;
  if (curve.length < 2) return null;

  const width = 320;
  const height = 136;
  const padL = 28;
  const padR = 10;
  const padT = 12;
  const padB = 20;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const minRpm = curve[0].rpm;
  const maxRpm = Math.max(minRpm + 1000, compiled.revLimiterRpm);
  const maxTorque = Math.max(200, ...curve.map((p) => p.torqueNm)) * 1.1;
  const maxPower = Math.max(150, ...curve.map((p) => p.powerHp)) * 1.1;
  const yMax = Math.max(maxTorque, maxPower);

  const xOf = (rpm: number) => padL + ((rpm - minRpm) / (maxRpm - minRpm)) * plotW;
  const yOf = (val: number) => padT + plotH - (val / yMax) * plotH;

  const torquePath = curve
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xOf(p.rpm).toFixed(1)} ${yOf(p.torqueNm).toFixed(1)}`)
    .join(' ');

  const powerPath = curve
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xOf(p.rpm).toFixed(1)} ${yOf(p.powerHp).toFixed(1)}`)
    .join(' ');

  // Compute gear shift-drop RPM markers from redline
  const ratios = compiled.build.drivetrain.gearRatios;
  const shiftDrops: Array<{ gear: number; dropRpm: number }> = [];
  for (let i = 0; i < ratios.length - 1; i++) {
    const ratioDrop = ratios[i + 1] / Math.max(0.1, ratios[i]);
    const dropRpm = compiled.redlineRpm * ratioDrop;
    if (dropRpm >= minRpm && dropRpm <= maxRpm) {
      shiftDrops.push({ gear: i + 2, dropRpm });
    }
  }

  const redlineX = xOf(compiled.redlineRpm);
  const peakPowerX = xOf(compiled.peakPowerRpm);
  const peakPowerY = yOf(compiled.peakPowerHp);
  const peakTorqueX = xOf(compiled.peakTorqueRpm);
  const peakTorqueY = yOf(compiled.peakTorqueNm);

  const rpmTicks = [2000, 4000, 6000, 8000, 10000].filter((r) => r >= minRpm && r <= maxRpm);

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#0D1118]/90 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          Live Virtual Dyno
        </span>
        <div className="flex items-center gap-2.5 font-mono text-[10px]">
          <span className="text-cyan-400">
            {compiled.peakPowerHp.toFixed(0)} HP @ {(compiled.peakPowerRpm / 1000).toFixed(1)}k
          </span>
          <span className="text-amber-400">
            {compiled.peakTorqueNm.toFixed(0)} Nm @ {(compiled.peakTorqueRpm / 1000).toFixed(1)}k
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full select-none">
        {/* Horizontal Grid */}
        {[0.25, 0.5, 0.75, 1].map((frac) => {
          const y = padT + plotH * (1 - frac);
          const val = Math.round(yMax * frac);
          return (
            <g key={frac}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke="#1E293B"
                strokeWidth={0.7}
              />
              <text
                x={padL - 4}
                y={y}
                textAnchor="end"
                dominantBaseline="central"
                className="fill-slate-500 font-mono text-[8px]"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Redline zone */}
        <rect
          x={redlineX}
          y={padT}
          width={Math.max(0, width - padR - redlineX)}
          height={plotH}
          fill="rgba(244, 63, 94, 0.14)"
        />
        <line
          x1={redlineX}
          y1={padT}
          x2={redlineX}
          y2={padT + plotH}
          stroke="#F43F5E"
          strokeWidth={1}
          strokeDasharray="3 2"
        />

        {/* Gear Shift-Drop Lines */}
        {shiftDrops.map((sd) => {
          const sx = xOf(sd.dropRpm);
          return (
            <g key={sd.gear}>
              <line
                x1={sx}
                y1={padT}
                x2={sx}
                y2={padT + plotH}
                stroke="rgba(148, 163, 184, 0.25)"
                strokeWidth={0.8}
                strokeDasharray="2 3"
              />
              <text
                x={sx}
                y={padT + 7}
                textAnchor="middle"
                className="fill-slate-500 font-mono text-[7px]"
              >
                G{sd.gear}
              </text>
            </g>
          );
        })}

        {/* Torque Curve (#F59E0B) */}
        <path
          d={torquePath}
          fill="none"
          stroke="#F59E0B"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Power Curve (#00F0FF) */}
        <path
          d={powerPath}
          fill="none"
          stroke="#00F0FF"
          strokeWidth={2.2}
          strokeLinejoin="round"
        />

        {/* Peak Callout Dots */}
        <circle cx={peakTorqueX} cy={peakTorqueY} r={3} fill="#F59E0B" stroke="#0A0C10" strokeWidth={1} />
        <circle cx={peakPowerX} cy={peakPowerY} r={3.2} fill="#00F0FF" stroke="#0A0C10" strokeWidth={1} />

        {/* X Axis RPM Ticks */}
        {rpmTicks.map((rpm) => (
          <text
            key={rpm}
            x={xOf(rpm)}
            y={height - 5}
            textAnchor="middle"
            className="fill-slate-500 font-mono text-[8px]"
          >
            {(rpm / 1000).toFixed(0)}k
          </text>
        ))}
      </svg>
    </div>
  );
}
