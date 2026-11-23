import { useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import { evaluateSlipAngleGripCurve } from '../../core/math/pacejka';
import type { IPhysicsBias } from '../../core/types';

interface PhysicsTabProps {
  baseline: IPhysicsBias;
  staged: IPhysicsBias;
  onChange: (next: IPhysicsBias) => void;
}

interface SliderSpec {
  key: keyof IPhysicsBias;
  label: string;
  unit: string;
  desc: string;
}

const SLIDERS: SliderSpec[] = [
  {
    key: 'pacejka_grip_mult',
    label: 'Pacejka Tire Grip Multiplier',
    unit: 'x',
    desc: 'Scales peak lateral & longitudinal friction D across all tire compounds.',
  },
  {
    key: 'aero_downforce_mult',
    label: 'Aero Downforce Multiplier',
    unit: 'x',
    desc: 'Scales splitter, diffuser, and rear wing downforce Cl globally.',
  },
  {
    key: 'aero_drag_mult',
    label: 'Aero Drag Multiplier',
    unit: 'x',
    desc: 'Scales aerodynamic drag Cd (directly impacts Vmax & straightline speed).',
  },
  {
    key: 'thermal_heat_soak_mult',
    label: 'Thermal Heat-Soak Multiplier',
    unit: 'x',
    desc: 'Scales engine, tire, and brake heat generation rate.',
  },
  {
    key: 'weight_inertia_mult',
    label: 'Weight & Rotational Inertia',
    unit: 'x',
    desc: 'Scales yaw/pitch/roll moments of inertia affecting turn-in agility.',
  },
  {
    key: 'turbo_lag_mult',
    label: 'Turbo Spool Lag Multiplier',
    unit: 'x',
    desc: 'Higher values slow turbo spool-up; lower values sharpen boost response.',
  },
];

export function PhysicsTab({ baseline, staged, onChange }: PhysicsTabProps) {
  const updateField = (key: keyof IPhysicsBias, val: number) => {
    onChange({
      ...staged,
      [key]: Math.round(val * 100) / 100,
    });
  };

  // 1. Pacejka Slip-Angle Grip Curve (0 deg -> 20 deg)
  const pacejkaData = useMemo(() => {
    const baseMu = 1.32; // Semi-Slick reference compound
    const width = 460;
    const height = 210;
    const padL = 42;
    const padR = 16;
    const padT = 16;
    const padB = 32;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxAngle = 20;
    const maxMu = 3.0;

    const buildPath = (mult: number) => {
      const pts: string[] = [];
      let peak = 0;
      let peakAngle = 0;
      for (let i = 0; i <= 80; i++) {
        const angle = (i / 80) * maxAngle;
        const mu = Math.max(0, evaluateSlipAngleGripCurve(angle, baseMu, mult));
        if (mu > peak) {
          peak = mu;
          peakAngle = angle;
        }
        const x = padL + (angle / maxAngle) * plotW;
        const y = padT + plotH - (Math.min(mu, maxMu) / maxMu) * plotH;
        pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
      }
      return { d: pts.join(' '), peak, peakAngle };
    };

    const baseCurve = buildPath(baseline.pacejka_grip_mult);
    const stagedCurve = buildPath(staged.pacejka_grip_mult);

    return {
      width,
      height,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      maxAngle,
      maxMu,
      baseCurve,
      stagedCurve,
    };
  }, [baseline.pacejka_grip_mult, staged.pacejka_grip_mult]);

  // 2. Aero Drag-vs-Downforce Speed Curve (0 -> 320 km/h)
  const aeroData = useMemo(() => {
    const width = 460;
    const height = 210;
    const padL = 46;
    const padR = 16;
    const padT = 16;
    const padB = 32;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxKph = 320;
    const maxKn = 14; // kN
    const rho = 1.225;
    const refArea = 2.05; // m^2
    const refCl = 0.85;
    const refCd = 0.36;

    const buildForcePath = (coeff: number, mult: number) => {
      const pts: string[] = [];
      let at300Kn = 0;
      for (let i = 0; i <= 64; i++) {
        const kph = (i / 64) * maxKph;
        const vMs = kph / 3.6;
        const forceKn = (0.5 * rho * vMs * vMs * refArea * coeff * mult) / 1000;
        if (Math.abs(kph - 300) < 3) at300Kn = forceKn;
        const x = padL + (kph / maxKph) * plotW;
        const y = padT + plotH - (Math.min(forceKn, maxKn) / maxKn) * plotH;
        pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
      }
      return { d: pts.join(' '), at300Kn };
    };

    const baseDf = buildForcePath(refCl, baseline.aero_downforce_mult);
    const stagedDf = buildForcePath(refCl, staged.aero_downforce_mult);
    const baseDrag = buildForcePath(refCd, baseline.aero_drag_mult);
    const stagedDrag = buildForcePath(refCd, staged.aero_drag_mult);
    const ldRatio =
      (refCl * staged.aero_downforce_mult) / Math.max(0.05, refCd * staged.aero_drag_mult);

    return {
      width,
      height,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      maxKph,
      maxKn,
      baseDf,
      stagedDf,
      baseDrag,
      stagedDrag,
      ldRatio,
    };
  }, [
    baseline.aero_downforce_mult,
    baseline.aero_drag_mult,
    staged.aero_downforce_mult,
    staged.aero_drag_mult,
  ]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      {/* Left: 6 Precision Sliders */}
      <div className="xl:col-span-5 space-y-3">
        <div className="bg-[#12161F] border border-[#1E2532] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Global Physics Math Biases
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Modifying any bias auto-bumps <code className="text-[#F59E0B]">version_id</code> to
                partition leaderboards.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onChange({ ...baseline })}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0A0C10] hover:bg-slate-800 border border-[#1E2532] text-[11px] text-slate-300 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>

          <div className="space-y-4">
            {SLIDERS.map((spec) => {
              const val = staged[spec.key];
              const baseVal = baseline[spec.key];
              const isModified = Math.abs(val - baseVal) > 1e-6;

              return (
                <div
                  key={spec.key}
                  className={`rounded-lg p-3 border transition-colors ${
                    isModified
                      ? 'bg-[#F59E0B]/5 border-[#F59E0B]/40'
                      : 'bg-[#0A0C10]/70 border-[#1E2532]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-200">{spec.label}</span>
                    <div className="flex items-center gap-2 font-mono text-xs">
                      {isModified && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F59E0B]/15 text-[#F59E0B]">
                          {baseVal.toFixed(2)}x →
                        </span>
                      )}
                      <span
                        className={`font-bold ${isModified ? 'text-[#F59E0B]' : 'text-[#00F0FF]'}`}
                      >
                        {val.toFixed(2)}
                        {spec.unit}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 mb-2">{spec.desc}</p>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.01}
                    value={val}
                    onChange={(e) => updateField(spec.key, Number.parseFloat(e.target.value))}
                    className="w-full accent-[#00F0FF] cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                    <span>0.50x</span>
                    <span>1.00x</span>
                    <span>1.50x</span>
                    <span>2.00x</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: Real-Time SVG Curve Visualizers */}
      <div className="xl:col-span-7 space-y-5">
        {/* Curve 1: Pacejka Slip-Angle Grip Curve */}
        <div className="bg-[#12161F] border border-[#1E2532] rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Pacejka Slip-Angle Grip Curve (0° – 20°)
              </h3>
              <p className="text-[11px] text-slate-400">
                Reference Semi-Slick (base μ = 1.32) · Live Magic Formula evaluation
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-4 border-t-2 border-dashed border-slate-500 inline-block" />
                KV Baseline ({pacejkaData.baseCurve.peak.toFixed(2)}μ)
              </span>
              <span className="flex items-center gap-1.5 text-[#00F0FF]">
                <span className="w-4 border-t-2 border-[#00F0FF] inline-block" />
                Staged ({pacejkaData.stagedCurve.peak.toFixed(2)}μ @{' '}
                {pacejkaData.stagedCurve.peakAngle.toFixed(1)}°)
              </span>
            </div>
          </div>

          <div className="bg-[#0A0C10] border border-[#1E2532] rounded-lg p-2 overflow-x-auto">
            <svg
              viewBox={`0 0 ${pacejkaData.width} ${pacejkaData.height}`}
              className="w-full h-auto max-h-[250px]"
            >
              {/* Horizontal Grid Lines */}
              {[0, 0.75, 1.5, 2.25, 3.0].map((muTick) => {
                const y =
                  pacejkaData.padT +
                  pacejkaData.plotH -
                  (muTick / pacejkaData.maxMu) * pacejkaData.plotH;
                return (
                  <g key={muTick}>
                    <line
                      x1={pacejkaData.padL}
                      y1={y}
                      x2={pacejkaData.width - pacejkaData.padR}
                      y2={y}
                      stroke="#1E2532"
                      strokeWidth="1"
                    />
                    <text
                      x={pacejkaData.padL - 8}
                      y={y + 3}
                      textAnchor="end"
                      fill="#64748B"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {muTick.toFixed(1)}μ
                    </text>
                  </g>
                );
              })}

              {/* Vertical Slip Angle Grid Lines */}
              {[0, 4, 8, 12, 16, 20].map((deg) => {
                const x = pacejkaData.padL + (deg / pacejkaData.maxAngle) * pacejkaData.plotW;
                return (
                  <g key={deg}>
                    <line
                      x1={x}
                      y1={pacejkaData.padT}
                      x2={x}
                      y2={pacejkaData.padT + pacejkaData.plotH}
                      stroke="#1E2532"
                      strokeWidth="1"
                    />
                    <text
                      x={x}
                      y={pacejkaData.height - 10}
                      textAnchor="middle"
                      fill="#64748B"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {deg}°
                    </text>
                  </g>
                );
              })}

              {/* Baseline Dashed Curve */}
              <path
                d={pacejkaData.baseCurve.d}
                fill="none"
                stroke="#64748B"
                strokeWidth="2"
                strokeDasharray="5 4"
              />

              {/* Live Staged Glowing Curve */}
              <path
                d={pacejkaData.stagedCurve.d}
                fill="none"
                stroke="#00F0FF"
                strokeWidth="2.75"
                style={{ filter: 'drop-shadow(0 0 6px rgba(0,240,255,0.55))' }}
              />
            </svg>
          </div>
        </div>

        {/* Curve 2: Aero Drag vs Downforce Speed Curve */}
        <div className="bg-[#12161F] border border-[#1E2532] rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Aero Downforce vs. Drag Curve (0 – 320 km/h)
              </h3>
              <p className="text-[11px] text-slate-400">
                Reference GT Aero (A = 2.05m², Cl = 0.85, Cd = 0.36) · Staged L/D:{' '}
                <span className="font-mono text-[#00F0FF] font-semibold">
                  {aeroData.ldRatio.toFixed(2)}:1
                </span>
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className="flex items-center gap-1.5 text-[#00F0FF]">
                <span className="w-3 h-0.5 bg-[#00F0FF] inline-block" />
                Downforce ({aeroData.stagedDf.at300Kn.toFixed(2)} kN @ 300)
              </span>
              <span className="flex items-center gap-1.5 text-[#F59E0B]">
                <span className="w-3 h-0.5 bg-[#F59E0B] inline-block" />
                Drag ({aeroData.stagedDrag.at300Kn.toFixed(2)} kN @ 300)
              </span>
            </div>
          </div>

          <div className="bg-[#0A0C10] border border-[#1E2532] rounded-lg p-2 overflow-x-auto">
            <svg
              viewBox={`0 0 ${aeroData.width} ${aeroData.height}`}
              className="w-full h-auto max-h-[250px]"
            >
              {/* Horizontal Force Grid */}
              {[0, 3.5, 7, 10.5, 14].map((kn) => {
                const y = aeroData.padT + aeroData.plotH - (kn / aeroData.maxKn) * aeroData.plotH;
                return (
                  <g key={kn}>
                    <line
                      x1={aeroData.padL}
                      y1={y}
                      x2={aeroData.width - aeroData.padR}
                      y2={y}
                      stroke="#1E2532"
                      strokeWidth="1"
                    />
                    <text
                      x={aeroData.padL - 8}
                      y={y + 3}
                      textAnchor="end"
                      fill="#64748B"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {kn.toFixed(0)}kN
                    </text>
                  </g>
                );
              })}

              {/* Vertical Speed Grid */}
              {[0, 80, 160, 240, 320].map((kph) => {
                const x = aeroData.padL + (kph / aeroData.maxKph) * aeroData.plotW;
                return (
                  <g key={kph}>
                    <line
                      x1={x}
                      y1={aeroData.padT}
                      x2={x}
                      y2={aeroData.padT + aeroData.plotH}
                      stroke="#1E2532"
                      strokeWidth="1"
                    />
                    <text
                      x={x}
                      y={aeroData.height - 10}
                      textAnchor="middle"
                      fill="#64748B"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {kph}
                    </text>
                  </g>
                );
              })}

              {/* Baseline Curves (Dashed) */}
              <path
                d={aeroData.baseDf.d}
                fill="none"
                stroke="#475569"
                strokeWidth="1.75"
                strokeDasharray="5 4"
              />
              <path
                d={aeroData.baseDrag.d}
                fill="none"
                stroke="#64748B"
                strokeWidth="1.75"
                strokeDasharray="3 3"
              />

              {/* Staged Downforce (Cyan) & Drag (Amber) */}
              <path
                d={aeroData.stagedDf.d}
                fill="none"
                stroke="#00F0FF"
                strokeWidth="2.5"
                style={{ filter: 'drop-shadow(0 0 5px rgba(0,240,255,0.5))' }}
              />
              <path
                d={aeroData.stagedDrag.d}
                fill="none"
                stroke="#F59E0B"
                strokeWidth="2.5"
                style={{ filter: 'drop-shadow(0 0 5px rgba(245,158,11,0.45))' }}
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
