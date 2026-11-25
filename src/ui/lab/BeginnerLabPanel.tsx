import { useMemo } from 'react';
import { Check, Gauge, Lock, Sliders, Sparkles } from 'lucide-react';
import { createStarterBuild, PARTS_CATALOG } from '../../content';
import { compileVehicleBuild } from '../../core/math/vehicleCompiler';
import type {
  ICompiledVehicle,
  IGlobalBalanceConfig,
  IVehicleBuildConfig,
  TireCompound,
} from '../../core/types';
import { formatSpeedFromKph, speedUnitLabel, type SpeedUnit } from '../settingsStore';

interface BeginnerLabPanelProps {
  build: IVehicleBuildConfig;
  compiled: ICompiledVehicle;
  balanceConfig: IGlobalBalanceConfig;
  speedUnit: SpeedUnit;
  isOwned: (id: string) => boolean;
  onChangeBuild: (next: IVehicleBuildConfig) => void;
  onSwitchToAdvanced: () => void;
}

interface EnginePackage {
  id: string;
  name: string;
  summary: string;
  apply: (b: IVehicleBuildConfig) => IVehicleBuildConfig;
  matches: (b: IVehicleBuildConfig) => boolean;
}

const ENGINE_PACKAGES: EnginePackage[] = [
  {
    id: 'oem_clubsport',
    name: 'OEM Clubsport 2.0 NA',
    summary: 'Modest, progressive throttle for learning corner speed & clean braking.',
    apply: (b) => ({
      ...b,
      engine: {
        ...b.engine,
        displacementL: 2.0,
        aspiration: 'Naturally Aspirated',
        camshaftProfile: 0.3,
        revLimiterRpm: 7500,
        ecuTune: 'Balanced',
      },
      equippedPartIds: { ...b.equippedPartIds, aspirationId: 'eng_asp_na' },
    }),
    matches: (b) =>
      b.engine.aspiration === 'Naturally Aspirated' &&
      b.engine.displacementL <= 2.1 &&
      b.engine.ecuTune === 'Balanced',
  },
  {
    id: 'street_sport',
    name: 'Street Sport 2.4 NA',
    summary: 'Broader mid-range torque with sharper response out of tight hairpins.',
    apply: (b) => ({
      ...b,
      engine: {
        ...b.engine,
        displacementL: 2.4,
        aspiration: 'Naturally Aspirated',
        camshaftProfile: 0.5,
        revLimiterRpm: 7750,
        ecuTune: 'Balanced',
      },
      equippedPartIds: { ...b.equippedPartIds, aspirationId: 'eng_asp_na' },
    }),
    matches: (b) =>
      b.engine.aspiration === 'Naturally Aspirated' &&
      b.engine.displacementL > 2.1 &&
      b.engine.displacementL <= 2.6,
  },
  {
    id: 'attack_na',
    name: 'Club Attack 2.8 NA',
    summary: 'High-revving race cam + attack map. More pull, faster engine heat.',
    apply: (b) => ({
      ...b,
      engine: {
        ...b.engine,
        displacementL: 2.8,
        aspiration: 'Naturally Aspirated',
        camshaftProfile: 0.8,
        revLimiterRpm: 8500,
        ecuTune: 'Qualifying Attack',
      },
      equippedPartIds: { ...b.equippedPartIds, aspirationId: 'eng_asp_na' },
    }),
    matches: (b) =>
      b.engine.aspiration === 'Naturally Aspirated' &&
      b.engine.displacementL > 2.6,
  },
];

const HANDLING_PRESETS: Array<{
  id: string;
  name: string;
  summary: string;
  apply: (b: IVehicleBuildConfig) => IVehicleBuildConfig;
  matches: (b: IVehicleBuildConfig) => boolean;
}> = [
  {
    id: 'stable',
    name: 'Stable & Forgiving',
    summary: 'Calm turn-in, safe front brake bias (63%), mild understeer at the limit.',
    apply: (b) => ({
      ...b,
      suspension: {
        ...b.suspension,
        arbFrontNmm: 55,
        arbRearNmm: 30,
        springRateFrontNmm: 80,
        springRateRearNmm: 80,
        camberFrontDeg: -2.0,
        camberRearDeg: -1.6,
      },
      brakes: { ...b.brakes, brakeBiasFrontPct: 63 },
      drivetrain: { ...b.drivetrain, diffAccelLockPct: 35, diffDecelLockPct: 25 },
    }),
    matches: (b) => b.suspension.arbFrontNmm >= 52 && b.suspension.arbRearNmm <= 35,
  },
  {
    id: 'balanced',
    name: 'Balanced Clubsport',
    summary: 'Neutral corner balance with readable front-to-rear weight transfer.',
    apply: (b) => ({
      ...b,
      suspension: {
        ...b.suspension,
        arbFrontNmm: 45,
        arbRearNmm: 40,
        springRateFrontNmm: 85,
        springRateRearNmm: 90,
        camberFrontDeg: -2.4,
        camberRearDeg: -1.8,
      },
      brakes: { ...b.brakes, brakeBiasFrontPct: 60 },
      drivetrain: { ...b.drivetrain, diffAccelLockPct: 45, diffDecelLockPct: 20 },
    }),
    matches: (b) =>
      b.suspension.arbFrontNmm >= 40 &&
      b.suspension.arbFrontNmm < 52 &&
      b.suspension.arbRearNmm >= 36 &&
      b.suspension.arbRearNmm <= 46,
  },
  {
    id: 'sharp',
    name: 'Sharp Turn-In',
    summary: 'Stiffer rear bar & forward toe-out for eager rotation into technical S-bends.',
    apply: (b) => ({
      ...b,
      suspension: {
        ...b.suspension,
        arbFrontNmm: 35,
        arbRearNmm: 55,
        springRateFrontNmm: 95,
        springRateRearNmm: 105,
        camberFrontDeg: -3.0,
        camberRearDeg: -2.0,
        toeFrontDeg: -0.2,
      },
      brakes: { ...b.brakes, brakeBiasFrontPct: 57 },
      drivetrain: { ...b.drivetrain, diffAccelLockPct: 55, diffDecelLockPct: 15 },
    }),
    matches: (b) => b.suspension.arbRearNmm > 46 && b.suspension.arbRearNmm <= 65,
  },
  {
    id: 'drift',
    name: 'Playful Slide',
    summary: 'High accel diff lock + stiff rear ARB to initiate and hold predictable drifts.',
    apply: (b) => ({
      ...b,
      suspension: {
        ...b.suspension,
        arbFrontNmm: 30,
        arbRearNmm: 75,
        springRateFrontNmm: 90,
        springRateRearNmm: 95,
        camberFrontDeg: -3.4,
        camberRearDeg: -1.2,
      },
      brakes: { ...b.brakes, brakeBiasFrontPct: 58 },
      drivetrain: { ...b.drivetrain, diffAccelLockPct: 80, diffDecelLockPct: 60 },
    }),
    matches: (b) => b.suspension.arbRearNmm > 65,
  },
];

const GEARING_PRESETS: Array<{
  id: string;
  label: string;
  ratio: number;
  note: string;
}> = [
  { id: 'short', label: 'Short (4.55)', ratio: 4.55, note: 'Quicker exits, earlier upshifts' },
  { id: 'balanced', label: 'Balanced (4.10)', ratio: 4.1, note: 'All-round technical pace' },
  { id: 'tall', label: 'Tall (3.55)', ratio: 3.55, note: 'Higher top speed, fewer shifts' },
];

export function BeginnerLabPanel({
  build,
  compiled,
  balanceConfig,
  speedUnit,
  isOwned,
  onChangeBuild,
  onSwitchToAdvanced,
}: BeginnerLabPanelProps) {
  const baselineCompiled = useMemo(
    () => compileVehicleBuild(createStarterBuild(), balanceConfig),
    [balanceConfig]
  );

  const tireParts = useMemo(
    () => PARTS_CATALOG.filter((p) => p.module === 'tires' && p.subCategory === 'compound'),
    []
  );

  const unitLabel = speedUnitLabel(speedUnit);
  const deltaPower = Math.round(compiled.peakPowerHp - baselineCompiled.peakPowerHp);
  const deltaMass = Math.round(compiled.totalMassKg - baselineCompiled.totalMassKg);
  const deltaTop =
    formatSpeedFromKph(compiled.estimatedTopSpeedKph, speedUnit) -
    formatSpeedFromKph(baselineCompiled.estimatedTopSpeedKph, speedUnit);

  return (
    <div className="space-y-4">
      {/* Live Delta vs Stock Banner */}
      <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/8 p-2.5">
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-cyan-300">
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            Delta vs Stock Baseline
          </span>
          <span className="font-mono text-slate-400">Same Build File</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
          <div className="rounded bg-slate-950/75 px-2 py-1">
            <div className="text-[8px] text-slate-500">POWER</div>
            <div className={deltaPower >= 0 ? 'text-emerald-300' : 'text-amber-300'}>
              {deltaPower >= 0 ? `+${deltaPower}` : deltaPower} HP
            </div>
          </div>
          <div className="rounded bg-slate-950/75 px-2 py-1">
            <div className="text-[8px] text-slate-500">MASS</div>
            <div className={deltaMass <= 0 ? 'text-emerald-300' : 'text-amber-300'}>
              {deltaMass > 0 ? `+${deltaMass}` : deltaMass} kg
            </div>
          </div>
          <div className="rounded bg-slate-950/75 px-2 py-1">
            <div className="text-[8px] text-slate-500">TOP SPD</div>
            <div className={deltaTop >= 0 ? 'text-cyan-300' : 'text-amber-300'}>
              {deltaTop >= 0 ? `+${deltaTop}` : deltaTop} {unitLabel}
            </div>
          </div>
        </div>
      </div>

      {/* 1. OEM Engine Packages */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          1. OEM Engine Package
        </div>
        <div className="space-y-1.5">
          {ENGINE_PACKAGES.map((pkg) => {
            const active = pkg.matches(build);
            return (
              <button
                key={pkg.id}
                type="button"
                onClick={() => onChangeBuild(pkg.apply(build))}
                className={`w-full rounded-xl border p-2.5 text-left transition ${
                  active
                    ? 'border-cyan-400 bg-cyan-500/15 text-white'
                    : 'border-slate-800 bg-slate-900/75 text-slate-200 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold">
                  <span>{pkg.name}</span>
                  {active && <Check className="h-3.5 w-3.5 text-cyan-400" />}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">{pkg.summary}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Tire Compound */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          2. Tire Compound
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {tireParts.slice(0, 6).map((part) => {
            const owned = isOwned(part.id);
            const active = build.equippedPartIds.tireCompoundId === part.id;
            return (
              <button
                key={part.id}
                type="button"
                disabled={!owned}
                onClick={() =>
                  onChangeBuild({
                    ...build,
                    equippedPartIds: { ...build.equippedPartIds, tireCompoundId: part.id },
                    wheelsAndTires: {
                      ...build.wheelsAndTires,
                      tireCompound: part.specKey as TireCompound,
                    },
                  })
                }
                className={`rounded-lg border p-2 text-left transition ${
                  active
                    ? 'border-cyan-400 bg-cyan-500/15 text-white'
                    : owned
                    ? 'border-slate-800 bg-slate-900/75 text-slate-200 hover:border-slate-600'
                    : 'cursor-not-allowed border-slate-800/60 bg-slate-950/60 text-slate-500'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span className="truncate">{part.specKey}</span>
                  {!owned && <Lock className="h-3 w-3 text-amber-400/70" />}
                  {active && <Check className="h-3 w-3 text-cyan-400" />}
                </div>
                <div className="mt-0.5 truncate text-[9px] text-slate-400">
                  {owned ? part.description : 'Unlock in Advanced Lab'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Final Drive Gearing */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          <span>3. Final Drive Gearing</span>
          <span className="font-mono text-cyan-300">
            {build.drivetrain.finalDriveRatio.toFixed(2)} ·{' '}
            {formatSpeedFromKph(compiled.estimatedTopSpeedKph, speedUnit)} {unitLabel}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {GEARING_PRESETS.map((g) => {
            const active = Math.abs(build.drivetrain.finalDriveRatio - g.ratio) < 0.18;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() =>
                  onChangeBuild({
                    ...build,
                    drivetrain: { ...build.drivetrain, finalDriveRatio: g.ratio },
                  })
                }
                className={`rounded-lg border p-2 text-left transition ${
                  active
                    ? 'border-cyan-400 bg-cyan-500/15 text-white'
                    : 'border-slate-800 bg-slate-900/75 text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="font-mono text-[10px] font-bold">{g.label}</div>
                <div className="mt-0.5 text-[9px] leading-tight text-slate-400">{g.note}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Handling Balance Preset */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          4. Handling & Brake Balance
        </div>
        <div className="space-y-1.5">
          {HANDLING_PRESETS.map((preset) => {
            const active = preset.matches(build);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChangeBuild(preset.apply(build))}
                className={`w-full rounded-xl border p-2.5 text-left transition ${
                  active
                    ? 'border-cyan-400 bg-cyan-500/15 text-white'
                    : 'border-slate-800 bg-slate-900/75 text-slate-200 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold">
                  <span>{preset.name}</span>
                  {active && <Check className="h-3.5 w-3.5 text-cyan-400" />}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">{preset.summary}</div>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onSwitchToAdvanced}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/80 py-2 text-xs font-semibold text-cyan-300 transition hover:border-cyan-400"
      >
        <Sliders className="h-3.5 w-3.5" />
        <span>Open Full 8-Module Advanced Lab</span>
        <Gauge className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
