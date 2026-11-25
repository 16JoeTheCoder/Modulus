import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Cloud,
  Copy,
  Flag,
  Save,
  Settings,
  Shield,
  Sliders,
  Trash2,
  Wrench,
} from 'lucide-react';
import { CHASSIS_BY_ID } from '../../content';
import { compileVehicleBuild } from '../../core/math/vehicleCompiler';
import type { ModulusEngine } from '../../core/Engine';
import type { StorageSync } from '../../core/StorageSync';
import type {
  IAuthUser,
  ICompiledVehicle,
  IGlobalBalanceConfig,
  IVehicleBuildConfig,
} from '../../core/types';
import {
  formatSpeedFromKph,
  speedUnitLabel,
  type PlayerSettings,
} from '../settingsStore';
import { NewCarPicker } from './NewCarPicker';

export interface IGarageHomeProps {
  engine: ModulusEngine;
  storage: StorageSync;
  compiled: ICompiledVehicle;
  savedBuilds: IVehicleBuildConfig[];
  balanceConfig: IGlobalBalanceConfig;
  credits: number;
  user: IAuthUser | null;
  settings: PlayerSettings;
  onSelectBuild: (build: IVehicleBuildConfig) => void;
  onBuildsChanged: () => void;
  onOpenLab: (mode: 'beginner' | 'advanced') => void;
  onOpenCircuitModal: () => void;
  onOpenSettings: () => void;
  onOpenAuth: () => void;
}

export function GarageHome({
  engine,
  storage,
  compiled,
  savedBuilds,
  balanceConfig,
  credits,
  user,
  settings,
  onSelectBuild,
  onBuildsChanged,
  onOpenLab,
  onOpenCircuitModal,
  onOpenSettings,
  onOpenAuth,
}: IGarageHomeProps) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareBId, setCompareBId] = useState<string>(
    () => savedBuilds.find((b) => b.id !== compiled.build.id)?.id ?? compiled.build.id
  );
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<IVehicleBuildConfig | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const unitLabel = speedUnitLabel(settings.speedUnit);

  const compiledMap = useMemo(() => {
    const map = new Map<string, ICompiledVehicle>();
    for (const b of savedBuilds) {
      map.set(b.id, compileVehicleBuild(b, balanceConfig));
    }
    return map;
  }, [savedBuilds, balanceConfig]);

  const compareB =
    compiledMap.get(compareBId) ??
    compiledMap.get(savedBuilds.find((b) => b.id !== compiled.build.id)?.id ?? compiled.build.id) ??
    compiled;

  const handleDuplicate = (source: IVehicleBuildConfig) => {
    const id = `build_${Date.now().toString(36)}`;
    const copy: IVehicleBuildConfig = {
      ...JSON.parse(JSON.stringify(source)),
      id,
      name: `${source.name} Copy`,
    };
    engine.updateBuild(copy);
    onBuildsChanged();
    setCompareBId(source.id);
  };

  const handleNewBuild = (build: IVehicleBuildConfig) => {
    engine.updateBuild(build);
    onBuildsChanged();
  };

  const handleDeleteBuild = async () => {
    if (!deleteTarget || deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      const active = await storage.deleteSavedBuild(deleteTarget.id);
      if (compiled.build.id !== active.id) engine.updateBuild(active);
      if (compareBId === deleteTarget.id) setCompareBId(active.id);
      onBuildsChanged();
      deleteDialog.current?.close();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete this build.');
    } finally {
      setDeletePending(false);
    }
  };

  const handleSaveBuild = async () => {
    const ok = await storage.saveBuildToCloud(compiled.build);
    onBuildsChanged();
    setSaveToast(ok ? (user ? 'Synced to Cloud' : 'Saved Locally') : 'Sync Failed');
    setTimeout(() => setSaveToast(null), 2000);
  };

  const frontPct = Math.round(compiled.frontWeightDistributionPct);
  const rearPct = 100 - frontPct;

  const deltaBadge = (val: number, unit: string, invertGood = false) => {
    if (Math.abs(val) < 0.05) return <span className="text-slate-500">0{unit}</span>;
    const good = invertGood ? val < 0 : val > 0;
    const sign = val > 0 ? '+' : '';
    return (
      <span className={good ? 'text-emerald-400' : 'text-amber-300'}>
        {sign}
        {Math.abs(val) < 10 ? val.toFixed(1) : Math.round(val)}
        {unit}
      </span>
    );
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex h-[100dvh] flex-col justify-between overflow-hidden select-none">
      {/* TOP BAR */}
      <header
        className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-[#0A0C10]/86 px-3 pb-2.5 backdrop-blur-md md:px-5"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-400/15 text-cyan-400 ring-1 ring-cyan-400/40">
              <Wrench className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-black tracking-[0.2em] text-white">MODULUS</div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-cyan-400">
                Garage Bay
              </div>
            </div>
          </div>

          <div className="hidden h-5 w-px bg-slate-800 sm:block" />

          {/* Active Build Name Editor + Save */}
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={compiled.build.name}
              onChange={(e) => engine.updateBuild({ ...compiled.build, name: e.target.value })}
              aria-label="Active car name"
              className="w-40 rounded-md border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 text-xs font-semibold text-white focus:border-cyan-400 focus:outline-none sm:w-52"
            />
            <button
              type="button"
              onClick={() => void handleSaveBuild()}
              className="flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-500/25"
            >
              <Save className="h-3 w-3" />
              <span className="hidden sm:inline">{saveToast ?? 'Save'}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs font-bold text-emerald-300">
            {credits.toLocaleString()} CR
          </div>

          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 rounded-md border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-cyan-400"
          >
            <Settings className="h-3.5 w-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Settings</span>
          </button>

          {user?.role === 'admin' && (
            <button
              type="button"
              onClick={() => {
                window.history.pushState({}, '', '/admin');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="flex items-center gap-1 rounded-md border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-[11px] font-bold text-rose-300"
            >
              <Shield className="h-3 w-3" />
              <span className="hidden sm:inline">Admin</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenAuth}
            className="flex items-center gap-1.5 rounded-md border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-cyan-400"
          >
            <Cloud className="h-3.5 w-3.5 text-cyan-400" />
            <span className="max-w-[100px] truncate">
              {user ? user.email.split('@')[0] : 'Sync'}
            </span>
          </button>
        </div>
      </header>

      {/* MIDDLE AREA: Left Saved Cars Grid, Open 3D Center, Right Quick Spec & Compare */}
      <div className="pointer-events-none flex min-h-0 flex-1 items-stretch justify-between gap-3 p-3 md:p-4">
        {/* Left: Saved Cars Grid */}
        <aside className="pointer-events-auto flex max-h-full w-full max-w-[340px] flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-[#0A0D14]/88 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2.5">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
                Saved Cars ({savedBuilds.length})
              </div>
              <div className="text-[10px] text-slate-400">
                Select, duplicate, or open in Lab
              </div>
            </div>
            <NewCarPicker
              storage={storage}
              priceMultiplier={balanceConfig.economy_bias.part_price_mult}
              onCreate={handleNewBuild}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 transition hover:border-cyan-400"
            />
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {savedBuilds.map((b) => {
              const comp = compiledMap.get(b.id) ?? compiled;
              const isSelected = b.id === compiled.build.id;
              const chassisMeta = CHASSIS_BY_ID.get(b.chassisId);
              const topSpd = formatSpeedFromKph(comp.estimatedTopSpeedKph, settings.speedUnit);

              return (
                <div
                  key={b.id}
                  className={`rounded-xl border p-3 transition ${
                    isSelected
                      ? 'border-cyan-400 bg-cyan-500/12 shadow-[0_0_20px_rgba(0,240,255,0.12)]'
                      : 'border-slate-800 bg-[#0F141F]/90 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onSelectBuild(b)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/30"
                          style={{ backgroundColor: b.paintHex }}
                        />
                        <span className="truncate text-xs font-bold text-white">{b.name}</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {chassisMeta?.name ?? b.chassisId} · {b.chassis.drivetrain} ·{' '}
                        {b.wheelsAndTires.tireCompound}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDuplicate(b)}
                      title="Duplicate build"
                      className="rounded-md border border-slate-700/80 bg-slate-900 p-1.5 text-slate-400 transition hover:border-cyan-400 hover:text-cyan-300"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${b.name}`}
                      onClick={() => {
                        setDeleteTarget(b);
                        setDeleteError(null);
                        deleteDialog.current?.showModal();
                      }}
                      className="rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-400 hover:border-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-1.5 font-mono text-[10px]">
                    <div className="rounded bg-slate-950/75 px-2 py-1 text-cyan-300">
                      {Math.round(comp.peakPowerHp)} HP
                    </div>
                    <div className="rounded bg-slate-950/75 px-2 py-1 text-slate-200">
                      {Math.round(comp.totalMassKg)} kg
                    </div>
                    <div className="rounded bg-slate-950/75 px-2 py-1 text-amber-300">
                      {topSpd} {unitLabel}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-800 p-2.5">
            <button
              type="button"
              onClick={() => setCompareOpen((v) => !v)}
              className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                compareOpen
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                  : 'border-slate-700 bg-slate-900/90 text-slate-300 hover:border-cyan-400'
              }`}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              <span>{compareOpen ? 'Hide Build Compare' : 'Compare Two Builds'}</span>
            </button>
          </div>
        </aside>

        {/* Right: Active Car Summary OR 2-Slot Compare */}
        <aside className="pointer-events-auto hidden max-h-full w-[330px] flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-[#0A0D14]/88 shadow-2xl backdrop-blur-md lg:flex">
          <div className="border-b border-slate-800 px-3.5 py-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
              {compareOpen ? '2-Slot Build Comparison' : 'Active Machine Summary'}
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
            {compareOpen ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase text-slate-400">
                    Slot A (Active): <span className="text-cyan-300">{compiled.build.name}</span>
                  </div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-400">
                    Slot B (Compare Against)
                  </label>
                  <select
                    value={compareB.build.id}
                    onChange={(e) => setCompareBId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                  >
                    {savedBuilds.map((sb) => (
                      <option key={sb.id} value={sb.id}>
                        {sb.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5 font-mono text-[11px]">
                  {[
                    {
                      label: 'Power',
                      a: `${Math.round(compiled.peakPowerHp)} HP`,
                      delta: deltaBadge(compiled.peakPowerHp - compareB.peakPowerHp, ' HP'),
                    },
                    {
                      label: 'Mass',
                      a: `${Math.round(compiled.totalMassKg)} kg`,
                      delta: deltaBadge(compiled.totalMassKg - compareB.totalMassKg, ' kg', true),
                    },
                    {
                      label: 'Top Speed',
                      a: `${formatSpeedFromKph(compiled.estimatedTopSpeedKph, settings.speedUnit)} ${unitLabel}`,
                      delta: deltaBadge(
                        formatSpeedFromKph(compiled.estimatedTopSpeedKph, settings.speedUnit) -
                          formatSpeedFromKph(compareB.estimatedTopSpeedKph, settings.speedUnit),
                        ` ${unitLabel}`
                      ),
                    },
                    {
                      label: 'Final Drive',
                      a: compiled.build.drivetrain.finalDriveRatio.toFixed(2),
                      delta: deltaBadge(
                        compiled.build.drivetrain.finalDriveRatio -
                          compareB.build.drivetrain.finalDriveRatio,
                        ''
                      ),
                    },
                    {
                      label: 'Cornering Index',
                      a: `${Math.round(compiled.spider.corneringG)}`,
                      delta: deltaBadge(compiled.spider.corneringG - compareB.spider.corneringG, ''),
                    },
                    {
                      label: 'Braking Index',
                      a: `${Math.round(compiled.spider.braking)}`,
                      delta: deltaBadge(compiled.spider.braking - compareB.spider.braking, ''),
                    },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/75 px-2.5 py-1.5"
                    >
                      <span className="text-slate-400">{row.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{row.a}</span>
                        <span className="text-[10px]">{row.delta}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="text-[9px] text-slate-500">POWER / TORQUE</div>
                    <div className="mt-0.5 font-bold text-cyan-300">
                      {Math.round(compiled.peakPowerHp)} HP · {Math.round(compiled.peakTorqueNm)} Nm
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="text-[9px] text-slate-500">MASS / BALANCE</div>
                    <div className="mt-0.5 font-bold text-white">
                      {Math.round(compiled.totalMassKg)} kg · {frontPct}/{rearPct}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="text-[9px] text-slate-500">TIRES</div>
                    <div className="mt-0.5 font-bold text-slate-200">
                      {compiled.build.wheelsAndTires.tireCompound}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="text-[9px] text-slate-500">EST. TOP SPEED</div>
                    <div className="mt-0.5 font-bold text-amber-300">
                      {formatSpeedFromKph(compiled.estimatedTopSpeedKph, settings.speedUnit)}{' '}
                      {unitLabel}
                    </div>
                  </div>
                </div>

                {/* Quick Engineering Lab Entry Cards */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenLab('beginner')}
                    className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-2.5 text-left transition hover:border-cyan-400 hover:bg-cyan-500/15"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-200">
                      <Sliders className="h-3.5 w-3.5" />
                      Beginner Lab
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      OEM packages, tires & balance presets
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenLab('advanced')}
                    className="rounded-xl border border-slate-700/80 bg-slate-900/80 p-2.5 text-left transition hover:border-cyan-400"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                      <Wrench className="h-3.5 w-3.5 text-amber-400" />
                      Advanced Lab
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      Full 8-module internals, gears & geometry
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* BOTTOM COURSE, MODE & LAUNCH BAR */}
      <footer
        className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 bg-[#0A0C10]/90 px-3 pt-2.5 backdrop-blur-md md:px-5"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
          <button
            type="button"
            onClick={() => onOpenLab(settings.labMode)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/90 px-3.5 py-2 text-xs font-bold text-slate-100 transition hover:border-cyan-400"
          >
            <Wrench className="h-3.5 w-3.5 text-cyan-400" />
            <span>Engineering Lab</span>
          </button>

          <button
            type="button"
            onClick={onOpenCircuitModal}
            className="flex items-center gap-2 rounded-lg bg-cyan-400 px-5 py-2 text-xs font-black uppercase tracking-wider text-slate-950 shadow-[0_0_22px_rgba(0,240,255,0.32)] transition hover:bg-cyan-300"
          >
            <Flag className="h-3.5 w-3.5" />
            <span>Choose course</span>
          </button>
      </footer>
      <dialog
        ref={deleteDialog}
        aria-labelledby="delete-build-title"
        onCancel={(event) => { if (deletePending) event.preventDefault(); }}
        className="pointer-events-auto m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-slate-700 bg-[#0B0F17] p-5 text-slate-100 backdrop:bg-black/70"
      >
        <h2 id="delete-build-title" className="text-lg font-semibold">Delete {deleteTarget?.name}?</h2>
        <p className="mt-2 text-sm text-slate-300">
          This permanently removes the build. Owned parts and lap records stay in your account.
          {savedBuilds.length === 1 && ' A fresh factory Apex will be available to drive.'}
        </p>
        {deleteError && <p role="alert" className="mt-3 text-sm text-rose-300">{deleteError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={deletePending} onClick={() => deleteDialog.current?.close()}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm">Cancel</button>
          <button type="button" disabled={deletePending} onClick={() => void handleDeleteBuild()}
            className="rounded-lg bg-rose-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
            {deletePending ? 'Deleting…' : 'Delete car'}
          </button>
        </div>
      </dialog>
    </div>
  );
}
