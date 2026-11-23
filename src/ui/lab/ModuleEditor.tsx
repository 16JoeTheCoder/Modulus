import { useState } from 'react';
import { Check, Lock, ShoppingCart } from 'lucide-react';
import { CHASSIS_CATALOG, PARTS_CATALOG } from '../../content';
import type {
  AspirationType,
  BlockMaterial,
  BodyPanelMaterial,
  CaliperPistons,
  DifferentialType,
  DrivetrainLayout,
  EcuTuneMap,
  EngineLayout,
  ExhaustMaterial,
  FrameMaterial,
  FrontSplitterSpec,
  GearboxType,
  IPartSchema,
  IVehicleBuildConfig,
  PartModuleCategory,
  RadiatorSpec,
  RearDiffuserSpec,
  RearWingSpec,
  RimMaterial,
  RollCageSpec,
  RotorMaterial,
  SuspensionLayout,
  TireCompound,
} from '../../core/types';

interface ModuleEditorProps {
  activeModule: PartModuleCategory;
  build: IVehicleBuildConfig;
  priceMult: number;
  isOwned: (id: string) => boolean;
  onPurchase: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onChangeBuild: (next: IVehicleBuildConfig) => void;
}

const DEFAULT_RATIOS: Record<number, number[]> = {
  5: [3.58, 2.18, 1.5, 1.12, 0.86],
  6: [3.62, 2.26, 1.64, 1.28, 1.04, 0.86],
  7: [3.75, 2.48, 1.84, 1.44, 1.18, 0.98, 0.82],
};

function gearCountForType(type: GearboxType): number {
  if (type.startsWith('5')) return 5;
  if (type.startsWith('7')) return 7;
  return 6;
}

function resizeGearRatios(current: number[], targetCount: number): number[] {
  const defaults = DEFAULT_RATIOS[targetCount] ?? DEFAULT_RATIOS[6];
  return Array.from({ length: targetCount }, (_, i) => current[i] ?? defaults[i]);
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  precision = 0,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  precision?: number;
  hint?: string;
  onChange: (val: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-slate-300">{label}</span>
        <span className="font-mono font-semibold text-cyan-300">
          {value.toFixed(precision)}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-cyan-400"
      />
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}

function DiscretePills<T extends string>({
  label,
  options,
  value,
  disabledOptions,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  disabledOptions?: readonly T[];
  onChange: (val: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-slate-300">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = opt === value;
          const disabled = disabledOptions?.includes(opt) ?? false;
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt)}
              className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                active
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                  : disabled
                  ? 'cursor-not-allowed border-slate-800/60 bg-slate-900/40 text-slate-600'
                  : 'border-slate-700/80 bg-slate-900/80 text-slate-300 hover:border-slate-500 hover:text-white'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PartSelector({
  label,
  module,
  subCategory,
  equippedPartId,
  priceMult,
  isOwned,
  onPurchase,
  onEquip,
}: {
  label: string;
  module: PartModuleCategory;
  subCategory: string;
  equippedPartId: string;
  priceMult: number;
  isOwned: (id: string) => boolean;
  onPurchase: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onEquip: (part: IPartSchema) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const parts = PARTS_CATALOG.filter(
    (p) => p.module === module && p.subCategory === subCategory
  );

  const handleSelect = async (part: IPartSchema) => {
    setErrMsg(null);
    if (isOwned(part.id)) {
      onEquip(part);
      return;
    }
    setBusyId(part.id);
    const res = await onPurchase(part.id);
    setBusyId(null);
    if (res.ok) {
      onEquip(part);
    } else if (res.error) {
      setErrMsg(res.error);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          {label}
        </span>
        {errMsg && <span className="text-[10px] font-medium text-rose-400">{errMsg}</span>}
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {parts.map((part) => {
          const owned = isOwned(part.id);
          const equipped = equippedPartId === part.id;
          const scaledPrice = Math.round(part.price * priceMult);
          const isBusy = busyId === part.id;

          return (
            <button
              key={part.id}
              type="button"
              disabled={isBusy}
              onClick={() => void handleSelect(part)}
              className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                equipped
                  ? 'border-cyan-400 bg-cyan-500/15 text-white'
                  : owned
                  ? 'border-slate-800 bg-slate-900/75 text-slate-200 hover:border-slate-600'
                  : 'border-amber-500/30 bg-slate-900/60 text-slate-300 hover:border-amber-400/70'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <span className="truncate">{part.name}</span>
                  {equipped && <Check className="h-3.5 w-3.5 shrink-0 text-cyan-400" />}
                </div>
                <div className="truncate text-[10px] text-slate-400">{part.description}</div>
              </div>
              <div className="shrink-0">
                {equipped ? (
                  <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300">
                    EQUIPPED
                  </span>
                ) : owned ? (
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                    OWNED
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                    {isBusy ? (
                      '...'
                    ) : (
                      <>
                        <Lock className="h-2.5 w-2.5" />
                        <ShoppingCart className="h-2.5 w-2.5" />
                        {scaledPrice.toLocaleString()} CR
                      </>
                    )}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SWATCHES = ['#00F0FF', '#F59E0B', '#FF3B30', '#10B981', '#F8FAFC', '#A855F7', '#F97316', '#3B82F6'];

export function ModuleEditor({
  activeModule,
  build,
  priceMult,
  isOwned,
  onPurchase,
  onChangeBuild,
}: ModuleEditorProps) {
  const [chassisErr, setChassisErr] = useState<string | null>(null);
  const [buyingChassisId, setBuyingChassisId] = useState<string | null>(null);

  const currentChassis =
    CHASSIS_CATALOG.find((c) => c.id === build.chassisId) ?? CHASSIS_CATALOG[0];

  const handleSelectChassis = async (chassisId: string) => {
    setChassisErr(null);
    const target = CHASSIS_CATALOG.find((c) => c.id === chassisId);
    if (!target) return;

    if (!isOwned(chassisId)) {
      setBuyingChassisId(chassisId);
      const res = await onPurchase(chassisId);
      setBuyingChassisId(null);
      if (!res.ok) {
        setChassisErr(res.error ?? 'Unable to purchase chassis');
        return;
      }
    }

    const nextDrivetrain = target.supportedDrivetrains.includes(build.chassis.drivetrain)
      ? build.chassis.drivetrain
      : target.defaultDrivetrain;

    onChangeBuild({
      ...build,
      chassisId: target.id,
      paintHex: target.primaryColorHex,
      accentHex: target.accentColorHex,
      chassis: {
        ...build.chassis,
        drivetrain: nextDrivetrain,
        wheelbaseM: target.baseWheelbaseM,
        trackWidthM: target.baseTrackWidthM,
      },
    });
  };

  if (activeModule === 'chassis') {
    const allDrivetrains: DrivetrainLayout[] = ['FF', 'FR', 'MR', 'RR', 'AWD'];
    const unsupportedDrivetrains = allDrivetrains.filter(
      (d) => !currentChassis.supportedDrivetrains.includes(d)
    );

    return (
      <div className="space-y-4">
        {/* Chassis Switcher */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              Chassis Platform
            </span>
            {chassisErr && <span className="text-[10px] text-rose-400">{chassisErr}</span>}
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {CHASSIS_CATALOG.map((ch) => {
              const owned = isOwned(ch.id);
              const active = ch.id === build.chassisId;
              const price = Math.round(ch.price * priceMult);
              return (
                <button
                  key={ch.id}
                  type="button"
                  disabled={buyingChassisId === ch.id}
                  onClick={() => void handleSelectChassis(ch.id)}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                    active
                      ? 'border-cyan-400 bg-cyan-500/15 text-white'
                      : owned
                      ? 'border-slate-800 bg-slate-900/75 text-slate-200 hover:border-slate-600'
                      : 'border-amber-500/30 bg-slate-900/60 text-slate-300 hover:border-amber-400/70'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: ch.primaryColorHex }}
                      />
                      <span className="truncate">{ch.name}</span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {ch.baseMassKg}kg
                      </span>
                    </div>
                    <div className="truncate text-[10px] text-slate-400">{ch.subtitle}</div>
                  </div>
                  <div className="shrink-0">
                    {active ? (
                      <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300">
                        ACTIVE
                      </span>
                    ) : owned ? (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                        EQUIP
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                        <Lock className="h-2.5 w-2.5" />
                        {price.toLocaleString()} CR
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <DiscretePills
          label="Drivetrain Layout"
          options={allDrivetrains}
          disabledOptions={unsupportedDrivetrains}
          value={build.chassis.drivetrain}
          onChange={(drivetrain) =>
            onChangeBuild({ ...build, chassis: { ...build.chassis, drivetrain } })
          }
        />

        <DiscretePills<FrameMaterial>
          label="Frame Material"
          options={['Mild Steel', 'Chromoly', 'Aluminum', 'Carbon Monocoque']}
          value={build.chassis.frameMaterial}
          onChange={(frameMaterial) =>
            onChangeBuild({ ...build, chassis: { ...build.chassis, frameMaterial } })
          }
        />

        <DiscretePills<RollCageSpec>
          label="Roll Cage Spec"
          options={['None', 'Half-Cage', 'Full FIA Welded']}
          value={build.chassis.rollCage}
          onChange={(rollCage) =>
            onChangeBuild({ ...build, chassis: { ...build.chassis, rollCage } })
          }
        />

        <SliderControl
          label="Wheelbase (L)"
          value={build.chassis.wheelbaseM}
          min={2.2}
          max={2.95}
          step={0.05}
          unit="m"
          precision={2}
          hint="Short = nimble hairpins; Long = high-speed stability"
          onChange={(wheelbaseM) =>
            onChangeBuild({ ...build, chassis: { ...build.chassis, wheelbaseM } })
          }
        />

        <SliderControl
          label="Track Width (W)"
          value={build.chassis.trackWidthM}
          min={1.5}
          max={2.0}
          step={0.02}
          unit="m"
          precision={2}
          hint="Wider cuts lateral weight transfer but adds frontal drag"
          onChange={(trackWidthM) =>
            onChangeBuild({ ...build, chassis: { ...build.chassis, trackWidthM } })
          }
        />

        <SliderControl
          label="Ballast Mass"
          value={build.chassis.ballastMassKg}
          min={0}
          max={100}
          step={5}
          unit="kg"
          onChange={(ballastMassKg) =>
            onChangeBuild({ ...build, chassis: { ...build.chassis, ballastMassKg } })
          }
        />

        <SliderControl
          label="Ballast Position (X)"
          value={build.chassis.ballastPositionX}
          min={-1.0}
          max={1.0}
          step={0.05}
          precision={2}
          hint="-1.00 = Full Rear, +1.00 = Full Front"
          onChange={(ballastPositionX) =>
            onChangeBuild({ ...build, chassis: { ...build.chassis, ballastPositionX } })
          }
        />

        {/* Paint & Accent */}
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-300">
              <span>Primary Paint</span>
              <input
                type="color"
                value={build.paintHex}
                onChange={(e) => onChangeBuild({ ...build, paintHex: e.target.value })}
                className="h-5 w-7 cursor-pointer rounded border border-slate-700 bg-transparent"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onChangeBuild({ ...build, paintHex: hex })}
                  className={`h-4 w-4 rounded-full border ${
                    build.paintHex.toLowerCase() === hex.toLowerCase()
                      ? 'border-white scale-110'
                      : 'border-slate-700'
                  }`}
                  style={{ backgroundColor: hex }}
                  aria-label={`Paint ${hex}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-300">
              <span>Livery Accent</span>
              <input
                type="color"
                value={build.accentHex}
                onChange={(e) => onChangeBuild({ ...build, accentHex: e.target.value })}
                className="h-5 w-7 cursor-pointer rounded border border-slate-700 bg-transparent"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onChangeBuild({ ...build, accentHex: hex })}
                  className={`h-4 w-4 rounded-full border ${
                    build.accentHex.toLowerCase() === hex.toLowerCase()
                      ? 'border-white scale-110'
                      : 'border-slate-700'
                  }`}
                  style={{ backgroundColor: hex }}
                  aria-label={`Accent ${hex}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeModule === 'engine') {
    const isForced = build.engine.aspiration !== 'Naturally Aspirated';
    return (
      <div className="space-y-4">
        <DiscretePills<EngineLayout>
          label="Engine Layout"
          options={['I4', 'Flat-4', 'I6', 'V6', 'V8', 'Rotary']}
          value={build.engine.layout}
          onChange={(layout) =>
            onChangeBuild({ ...build, engine: { ...build.engine, layout } })
          }
        />

        <SliderControl
          label="Displacement"
          value={build.engine.displacementL}
          min={1.3}
          max={6.2}
          step={0.1}
          unit="L"
          precision={1}
          onChange={(displacementL) =>
            onChangeBuild({ ...build, engine: { ...build.engine, displacementL } })
          }
        />

        <PartSelector
          label="Engine Block Material"
          module="engine"
          subCategory="block"
          equippedPartId={build.equippedPartIds.engineBlockId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, engineBlockId: part.id },
              engine: { ...build.engine, blockMaterial: part.specKey as BlockMaterial },
            })
          }
        />

        <PartSelector
          label="Forced Induction / Aspiration"
          module="engine"
          subCategory="aspiration"
          equippedPartId={build.equippedPartIds.aspirationId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, aspirationId: part.id },
              engine: { ...build.engine, aspiration: part.specKey as AspirationType },
            })
          }
        />

        {isForced && (
          <SliderControl
            label="Boost Pressure"
            value={build.engine.turboBoostBar}
            min={0.3}
            max={2.5}
            step={0.1}
            unit="bar"
            precision={1}
            hint="Higher boost multiplies power & thermal load"
            onChange={(turboBoostBar) =>
              onChangeBuild({ ...build, engine: { ...build.engine, turboBoostBar } })
            }
          />
        )}

        <SliderControl
          label="Camshaft Profile"
          value={build.engine.camshaftProfile}
          min={0.0}
          max={1.0}
          step={0.1}
          precision={1}
          hint="0.0 Street low-end torque → 1.0 Race high-RPM power"
          onChange={(camshaftProfile) =>
            onChangeBuild({ ...build, engine: { ...build.engine, camshaftProfile } })
          }
        />

        <SliderControl
          label="Rev Limiter"
          value={build.engine.revLimiterRpm}
          min={5500}
          max={10000}
          step={250}
          unit="RPM"
          onChange={(revLimiterRpm) =>
            onChangeBuild({ ...build, engine: { ...build.engine, revLimiterRpm } })
          }
        />

        <PartSelector
          label="Exhaust System"
          module="engine"
          subCategory="exhaust"
          equippedPartId={build.equippedPartIds.exhaustId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, exhaustId: part.id },
              engine: { ...build.engine, exhaustMaterial: part.specKey as ExhaustMaterial },
            })
          }
        />

        <DiscretePills<EcuTuneMap>
          label="ECU Tune Map"
          options={['Eco / Endurance', 'Balanced', 'Qualifying Attack']}
          value={build.engine.ecuTune}
          onChange={(ecuTune) =>
            onChangeBuild({ ...build, engine: { ...build.engine, ecuTune } })
          }
        />
      </div>
    );
  }

  if (activeModule === 'drivetrain') {
    return (
      <div className="space-y-4">
        <PartSelector
          label="Gearbox Type"
          module="drivetrain"
          subCategory="gearbox"
          equippedPartId={build.equippedPartIds.gearboxId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) => {
            const gbxType = part.specKey as GearboxType;
            const count = gearCountForType(gbxType);
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, gearboxId: part.id },
              drivetrain: {
                ...build.drivetrain,
                gearboxType: gbxType,
                gearRatios: resizeGearRatios(build.drivetrain.gearRatios, count),
              },
            });
          }}
        />

        <SliderControl
          label="Final Drive Ratio"
          value={build.drivetrain.finalDriveRatio}
          min={2.8}
          max={5.2}
          step={0.05}
          precision={2}
          hint="Higher = quicker acceleration; Lower = higher top speed"
          onChange={(finalDriveRatio) =>
            onChangeBuild({ ...build, drivetrain: { ...build.drivetrain, finalDriveRatio } })
          }
        />

        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
            Individual Gear Ratios (G1–G{build.drivetrain.gearRatios.length})
          </div>
          {build.drivetrain.gearRatios.map((ratio, idx) => (
            <SliderControl
              key={idx}
              label={`Gear ${idx + 1}`}
              value={ratio}
              min={0.65}
              max={4.0}
              step={0.02}
              precision={2}
              onChange={(val) => {
                const nextRatios = [...build.drivetrain.gearRatios];
                nextRatios[idx] = val;
                onChangeBuild({
                  ...build,
                  drivetrain: { ...build.drivetrain, gearRatios: nextRatios },
                });
              }}
            />
          ))}
        </div>

        <SliderControl
          label="Flywheel Mass"
          value={build.drivetrain.flywheelMassKg}
          min={3.5}
          max={12.0}
          step={0.5}
          unit="kg"
          precision={1}
          onChange={(flywheelMassKg) =>
            onChangeBuild({ ...build, drivetrain: { ...build.drivetrain, flywheelMassKg } })
          }
        />

        <PartSelector
          label="Differential Spec"
          module="drivetrain"
          subCategory="differential"
          equippedPartId={build.equippedPartIds.differentialId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, differentialId: part.id },
              drivetrain: {
                ...build.drivetrain,
                differentialType: part.specKey as DifferentialType,
              },
            })
          }
        />

        <SliderControl
          label="Diff Accel Lock"
          value={build.drivetrain.diffAccelLockPct}
          min={10}
          max={100}
          step={5}
          unit="%"
          onChange={(diffAccelLockPct) =>
            onChangeBuild({ ...build, drivetrain: { ...build.drivetrain, diffAccelLockPct } })
          }
        />

        <SliderControl
          label="Diff Decel Lock"
          value={build.drivetrain.diffDecelLockPct}
          min={0}
          max={100}
          step={5}
          unit="%"
          onChange={(diffDecelLockPct) =>
            onChangeBuild({ ...build, drivetrain: { ...build.drivetrain, diffDecelLockPct } })
          }
        />
      </div>
    );
  }

  if (activeModule === 'suspension') {
    const s = build.suspension;
    const setSus = (patch: Partial<IVehicleBuildConfig['suspension']>) =>
      onChangeBuild({ ...build, suspension: { ...s, ...patch } });

    return (
      <div className="space-y-4">
        <PartSelector
          label="Suspension Geometry"
          module="suspension"
          subCategory="geometry"
          equippedPartId={build.equippedPartIds.suspensionId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, suspensionId: part.id },
              suspension: { ...s, layout: part.specKey as SuspensionLayout },
            })
          }
        />

        <div className="grid grid-cols-2 gap-3">
          <SliderControl
            label="Ride Height F"
            value={s.rideHeightFrontMm}
            min={45}
            max={140}
            step={5}
            unit="mm"
            onChange={(rideHeightFrontMm) => setSus({ rideHeightFrontMm })}
          />
          <SliderControl
            label="Ride Height R"
            value={s.rideHeightRearMm}
            min={45}
            max={140}
            step={5}
            unit="mm"
            onChange={(rideHeightRearMm) => setSus({ rideHeightRearMm })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SliderControl
            label="Spring Rate F"
            value={s.springRateFrontNmm}
            min={30}
            max={220}
            step={5}
            unit="N/mm"
            onChange={(springRateFrontNmm) => setSus({ springRateFrontNmm })}
          />
          <SliderControl
            label="Spring Rate R"
            value={s.springRateRearNmm}
            min={30}
            max={220}
            step={5}
            unit="N/mm"
            onChange={(springRateRearNmm) => setSus({ springRateRearNmm })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SliderControl
            label="Bump Damper F"
            value={s.damperBumpFront}
            min={1}
            max={20}
            step={1}
            onChange={(damperBumpFront) => setSus({ damperBumpFront })}
          />
          <SliderControl
            label="Bump Damper R"
            value={s.damperBumpRear}
            min={1}
            max={20}
            step={1}
            onChange={(damperBumpRear) => setSus({ damperBumpRear })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SliderControl
            label="Rebound F"
            value={s.damperReboundFront}
            min={1}
            max={20}
            step={1}
            onChange={(damperReboundFront) => setSus({ damperReboundFront })}
          />
          <SliderControl
            label="Rebound R"
            value={s.damperReboundRear}
            min={1}
            max={20}
            step={1}
            onChange={(damperReboundRear) => setSus({ damperReboundRear })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SliderControl
            label="Anti-Roll Bar F"
            value={s.arbFrontNmm}
            min={10}
            max={120}
            step={5}
            unit="N/mm"
            onChange={(arbFrontNmm) => setSus({ arbFrontNmm })}
          />
          <SliderControl
            label="Anti-Roll Bar R"
            value={s.arbRearNmm}
            min={10}
            max={120}
            step={5}
            unit="N/mm"
            onChange={(arbRearNmm) => setSus({ arbRearNmm })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SliderControl
            label="Camber F"
            value={s.camberFrontDeg}
            min={-5.0}
            max={0.0}
            step={0.2}
            unit="°"
            precision={1}
            onChange={(camberFrontDeg) => setSus({ camberFrontDeg })}
          />
          <SliderControl
            label="Camber R"
            value={s.camberRearDeg}
            min={-5.0}
            max={0.0}
            step={0.2}
            unit="°"
            precision={1}
            onChange={(camberRearDeg) => setSus({ camberRearDeg })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SliderControl
            label="Toe F"
            value={s.toeFrontDeg}
            min={-1.0}
            max={1.0}
            step={0.05}
            unit="°"
            precision={2}
            onChange={(toeFrontDeg) => setSus({ toeFrontDeg })}
          />
          <SliderControl
            label="Toe R"
            value={s.toeRearDeg}
            min={-1.0}
            max={1.0}
            step={0.05}
            unit="°"
            precision={2}
            onChange={(toeRearDeg) => setSus({ toeRearDeg })}
          />
        </div>

        <SliderControl
          label="Front Caster Angle"
          value={s.casterFrontDeg}
          min={2.0}
          max={9.0}
          step={0.5}
          unit="°"
          precision={1}
          onChange={(casterFrontDeg) => setSus({ casterFrontDeg })}
        />
      </div>
    );
  }

  if (activeModule === 'tires') {
    const wt = build.wheelsAndTires;
    const setWt = (patch: Partial<IVehicleBuildConfig['wheelsAndTires']>) =>
      onChangeBuild({ ...build, wheelsAndTires: { ...wt, ...patch } });

    return (
      <div className="space-y-4">
        <PartSelector
          label="Rim Material"
          module="tires"
          subCategory="rim"
          equippedPartId={build.equippedPartIds.rimId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, rimId: part.id },
              wheelsAndTires: { ...wt, rimMaterial: part.specKey as RimMaterial },
            })
          }
        />

        <SliderControl
          label="Rim Diameter"
          value={wt.rimDiameterIn}
          min={15}
          max={20}
          step={1}
          unit="in"
          onChange={(rimDiameterIn) => setWt({ rimDiameterIn })}
        />

        <div className="grid grid-cols-2 gap-3">
          <SliderControl
            label="Tire Width F"
            value={wt.tireWidthFrontMm}
            min={195}
            max={345}
            step={10}
            unit="mm"
            onChange={(tireWidthFrontMm) => setWt({ tireWidthFrontMm })}
          />
          <SliderControl
            label="Tire Width R"
            value={wt.tireWidthRearMm}
            min={195}
            max={345}
            step={10}
            unit="mm"
            onChange={(tireWidthRearMm) => setWt({ tireWidthRearMm })}
          />
        </div>

        <SliderControl
          label="Sidewall Profile"
          value={wt.sidewallProfilePct}
          min={30}
          max={60}
          step={5}
          unit="%"
          hint="Low = sharp turn-in; Tall = forgiving slip progression"
          onChange={(sidewallProfilePct) => setWt({ sidewallProfilePct })}
        />

        <PartSelector
          label="Tire Compound"
          module="tires"
          subCategory="compound"
          equippedPartId={build.equippedPartIds.tireCompoundId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, tireCompoundId: part.id },
              wheelsAndTires: { ...wt, tireCompound: part.specKey as TireCompound },
            })
          }
        />

        <SliderControl
          label="Cold Tire Pressure"
          value={wt.coldPressurePsi}
          min={20}
          max={38}
          step={0.5}
          unit="PSI"
          precision={1}
          onChange={(coldPressurePsi) => setWt({ coldPressurePsi })}
        />
      </div>
    );
  }

  if (activeModule === 'brakes') {
    const b = build.brakes;
    const setBrk = (patch: Partial<IVehicleBuildConfig['brakes']>) =>
      onChangeBuild({ ...build, brakes: { ...b, ...patch } });

    return (
      <div className="space-y-4">
        <SliderControl
          label="Rotor Diameter"
          value={b.rotorDiameterMm}
          min={280}
          max={400}
          step={20}
          unit="mm"
          hint="360mm+ rotors require 18-19in rims for barrel clearance"
          onChange={(rotorDiameterMm) => setBrk({ rotorDiameterMm })}
        />

        <PartSelector
          label="Rotor Material"
          module="brakes"
          subCategory="rotor"
          equippedPartId={build.equippedPartIds.rotorId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, rotorId: part.id },
              brakes: { ...b, rotorMaterial: part.specKey as RotorMaterial },
            })
          }
        />

        <PartSelector
          label="Caliper Spec"
          module="brakes"
          subCategory="caliper"
          equippedPartId={build.equippedPartIds.caliperId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, caliperId: part.id },
              brakes: { ...b, caliperPistons: part.specKey as CaliperPistons },
            })
          }
        />

        <SliderControl
          label="Front Brake Bias"
          value={b.brakeBiasFrontPct}
          min={50}
          max={75}
          step={1}
          unit="%"
          hint="Higher = front stability; Lower = sharper trail-brake rotation"
          onChange={(brakeBiasFrontPct) => setBrk({ brakeBiasFrontPct })}
        />

        <SliderControl
          label="Brake Duct Opening"
          value={b.brakeDuctOpeningPct}
          min={0}
          max={100}
          step={10}
          unit="%"
          hint="Cools rotors faster at the expense of slight aero drag"
          onChange={(brakeDuctOpeningPct) => setBrk({ brakeDuctOpeningPct })}
        />
      </div>
    );
  }

  if (activeModule === 'aero') {
    const a = build.aero;
    return (
      <div className="space-y-4">
        <PartSelector
          label="Body Panel Material"
          module="aero"
          subCategory="bodyPanels"
          equippedPartId={build.equippedPartIds.bodyPanelId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, bodyPanelId: part.id },
              aero: { ...a, bodyPanelMaterial: part.specKey as BodyPanelMaterial },
            })
          }
        />

        <PartSelector
          label="Front Splitter"
          module="aero"
          subCategory="splitter"
          equippedPartId={build.equippedPartIds.frontSplitterId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, frontSplitterId: part.id },
              aero: { ...a, frontSplitter: part.specKey as FrontSplitterSpec },
            })
          }
        />

        <PartSelector
          label="Rear Diffuser"
          module="aero"
          subCategory="diffuser"
          equippedPartId={build.equippedPartIds.rearDiffuserId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, rearDiffuserId: part.id },
              aero: { ...a, rearDiffuser: part.specKey as RearDiffuserSpec },
            })
          }
        />

        <PartSelector
          label="Rear Wing Type"
          module="aero"
          subCategory="wing"
          equippedPartId={build.equippedPartIds.rearWingId}
          priceMult={priceMult}
          isOwned={isOwned}
          onPurchase={onPurchase}
          onEquip={(part) =>
            onChangeBuild({
              ...build,
              equippedPartIds: { ...build.equippedPartIds, rearWingId: part.id },
              aero: { ...a, rearWing: part.specKey as RearWingSpec },
            })
          }
        />

        <SliderControl
          label="Wing Angle of Attack"
          value={a.wingAngleDeg}
          min={0}
          max={20}
          step={1}
          unit="°"
          hint="0° Low drag straights → 20° Maximum cornering downforce"
          onChange={(wingAngleDeg) =>
            onChangeBuild({ ...build, aero: { ...a, wingAngleDeg } })
          }
        />
      </div>
    );
  }

  // Module 8: Fuel & Radiator ('cooling')
  return (
    <div className="space-y-4">
      <SliderControl
        label="Fuel Load"
        value={build.fuelAndCooling.fuelLoadL}
        min={5}
        max={80}
        step={5}
        unit="L"
        hint={`Adds ${(build.fuelAndCooling.fuelLoadL * 0.75).toFixed(1)} kg — burns dynamically each lap`}
        onChange={(fuelLoadL) =>
          onChangeBuild({
            ...build,
            fuelAndCooling: { ...build.fuelAndCooling, fuelLoadL },
          })
        }
      />

      <PartSelector
        label="Radiator Core Size"
        module="cooling"
        subCategory="radiator"
        equippedPartId={build.equippedPartIds.radiatorId}
        priceMult={priceMult}
        isOwned={isOwned}
        onPurchase={onPurchase}
        onEquip={(part) =>
          onChangeBuild({
            ...build,
            equippedPartIds: { ...build.equippedPartIds, radiatorId: part.id },
            fuelAndCooling: {
              ...build.fuelAndCooling,
              radiatorSpec: part.specKey as RadiatorSpec,
            },
          })
        }
      />
    </div>
  );
}
