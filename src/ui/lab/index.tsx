import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Box,
  ChevronDown,
  ChevronUp,
  Cloud,
  Cog,
  Cpu,
  Disc,
  Flame,
  Gauge,
  Layers,
  Play,
  Plus,
  Save,
  Settings,
  Shield,
  Sliders,
  Target,
  Trophy,
  Wind,
  Wrench,
} from 'lucide-react';
import { createStarterBuild } from '../../content';
import type { ModulusEngine } from '../../core/Engine';
import type { StorageSync } from '../../core/StorageSync';
import type {
  IAuthUser,
  ICompiledVehicle,
  IGlobalBalanceConfig,
  ILabOverlayOptions,
  ITrackSplineSchema,
  IVehicleBuildConfig,
  PartModuleCategory,
  VisualMode,
} from '../../core/types';
import {
  formatSpeedFromKph,
  speedUnitLabel,
  updatePlayerSettings,
  type LabExperienceMode,
  type PlayerSettings,
} from '../settingsStore';
import { BeginnerLabPanel } from './BeginnerLabPanel';
import { CircuitModal } from './CircuitModal';
import { DynoChart } from './DynoChart';
import { ModuleEditor } from './ModuleEditor';
import { SpiderChart } from './SpiderChart';

export interface ILabViewProps {
  engine: ModulusEngine;
  storage: StorageSync;
  visible: boolean;
  settings: PlayerSettings;
  onBackToGarage: () => void;
  onOpenSettings: () => void;
  onLaunchDrive: (aiEnabled: boolean, modeOverride?: 'practice' | 'time_trial' | 'drift') => void;
}

const MODULES: Array<{
  id: PartModuleCategory;
  label: string;
  short: string;
  icon: typeof Box;
}> = [
  { id: 'chassis', label: 'Chassis & Frame', short: 'Chassis', icon: Box },
  { id: 'engine', label: 'Engine & ECU', short: 'Engine', icon: Cpu },
  { id: 'drivetrain', label: 'Gearbox & Diff', short: 'Drive', icon: Cog },
  { id: 'suspension', label: 'Suspension', short: 'Susp', icon: Sliders },
  { id: 'tires', label: 'Wheels & Tires', short: 'Tires', icon: Disc },
  { id: 'brakes', label: 'Brakes', short: 'Brakes', icon: Gauge },
  { id: 'aero', label: 'Aero & Body', short: 'Aero', icon: Wind },
  { id: 'cooling', label: 'Fuel & Cooling', short: 'Cooling', icon: Flame },
];

export function EngineeringLab({
  engine,
  storage,
  visible,
  settings,
  onBackToGarage,
  onOpenSettings,
  onLaunchDrive,
}: ILabViewProps) {
  const [visualMode, setVisualMode] = useState<VisualMode>(() => engine.getVisualMode());
  const [compiled, setCompiled] = useState<ICompiledVehicle>(() => engine.getCompiledVehicle());
  const [balanceConfig, setBalanceConfig] = useState<IGlobalBalanceConfig>(() =>
    engine.getBalanceConfig()
  );
  const [activeTrack, setActiveTrack] = useState<ITrackSplineSchema>(() =>
    engine.getActiveTrack()
  );
  const [overlays, setOverlays] = useState<ILabOverlayOptions>(() =>
    engine.getLabOverlayOptions()
  );
  const [credits, setCredits] = useState<number>(() => storage.getCredits());
  const [ownedPartIds, setOwnedPartIds] = useState<string[]>(
    () => storage.getGarageState().ownedPartIds
  );
  const [savedBuilds, setSavedBuilds] = useState<IVehicleBuildConfig[]>(
    () => storage.getGarageState().savedBuilds
  );
  const [user, setUser] = useState<IAuthUser | null>(() => storage.getUser());
  const [syncing, setSyncing] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const [activeModule, setActiveModule] = useState<PartModuleCategory>('chassis');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [telemetryOpen, setTelemetryOpen] = useState(true);
  const [circuitModalOpen, setCircuitModalOpen] = useState(false);

  useEffect(() => {
    const unsubs = [
      engine.events.on('mode:changed', ({ mode }) => setVisualMode(mode)),
      engine.events.on('car:rebuilt', ({ compiled: c }) => {
        setCompiled(c);
        setSavedBuilds([...storage.getGarageState().savedBuilds]);
      }),
      engine.events.on('config:updated', ({ config }) => setBalanceConfig(config)),
      engine.events.on('track:selected', ({ schema }) => setActiveTrack(schema)),
      engine.events.on('lab:overlay-toggled', (ov) =>
        setOverlays((prev) => ({ ...prev, ...ov }))
      ),
      engine.events.on('economy:updated', ({ credits: cr, ownedPartIds: owned }) => {
        setCredits(cr);
        setOwnedPartIds([...owned]);
      }),
      engine.events.on('auth:changed', ({ user: u }) => {
        setUser(u);
        setSavedBuilds([...storage.getGarageState().savedBuilds]);
      }),
      engine.events.on('sync:status', ({ syncing: s }) => setSyncing(s)),
    ];
    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [engine, storage]);

  if (!visible || visualMode !== 'lab') return null;

  const build = compiled.build;
  const priceMult = balanceConfig.economy_bias.part_price_mult;
  const labMode: LabExperienceMode = settings.labMode;
  const frontWtPct = Math.round(compiled.frontWeightDistributionPct);
  const rearWtPct = 100 - frontWtPct;
  const topSpeedVal = formatSpeedFromKph(compiled.estimatedTopSpeedKph, settings.speedUnit);
  const topSpeedUnit = speedUnitLabel(settings.speedUnit);

  const handleUpdateBuild = (next: IVehicleBuildConfig) => {
    engine.updateBuild(next);
  };

  const handleSaveCloud = async () => {
    const ok = await storage.saveBuildToCloud(build);
    setSavedBuilds([...storage.getGarageState().savedBuilds]);
    setSaveToast(ok ? (user ? 'Saved to Cloud D1' : 'Saved Locally') : 'Sync Failed');
    setTimeout(() => setSaveToast(null), 2200);
  };

  const handleCreateNewBuild = () => {
    const base = createStarterBuild();
    const id = `build_${Date.now().toString(36)}`;
    const next: IVehicleBuildConfig = {
      ...base,
      id,
      name: `Custom Spec #${savedBuilds.length + 1}`,
    };
    engine.updateBuild(next);
    setSavedBuilds([...storage.getGarageState().savedBuilds]);
  };

  const handleSwitchBuild = (buildId: string) => {
    const found = savedBuilds.find((b) => b.id === buildId);
    if (found) {
      engine.updateBuild(found);
    }
  };

  const handleLaunch = (aiEnabled: boolean, modeOverride?: 'practice' | 'time_trial' | 'drift') => {
    onLaunchDrive(aiEnabled, modeOverride);
  };

  const selectModule = (mod: PartModuleCategory) => {
    setActiveModule(mod);
    setDrawerOpen(true);
    engine.setLabOverlayOptions({ highlightedModule: mod });
  };

  const isOwned = (id: string) => Boolean(user?.unlockAll) || ownedPartIds.includes(id);

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex h-[100dvh] flex-col justify-between overflow-hidden">
      {/* TOP HEADER BAR */}
      <header
        className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-[#0A0C10]/85 px-3 pb-2.5 backdrop-blur-md md:px-4"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBackToGarage}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1.5 text-xs font-bold text-slate-200 transition hover:border-cyan-400 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-cyan-400" />
            <span>Garage</span>
          </button>

          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-400/15 text-cyan-400 ring-1 ring-cyan-400/40">
              <Wrench className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-black tracking-[0.2em] text-white">MODULUS</div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-cyan-400">
                Engineering Lab
              </div>
            </div>
          </div>

          <div className="hidden h-5 w-px bg-slate-800 sm:block" />

          {/* Build Switcher & Rename */}
          <div className="flex items-center gap-1.5">
            <select
              value={build.id}
              onChange={(e) => handleSwitchBuild(e.target.value)}
              aria-label="Select saved build"
              className="max-w-[140px] truncate rounded-md border border-slate-700/80 bg-slate-900/90 px-2 py-1 text-xs font-semibold text-slate-100 focus:border-cyan-400 focus:outline-none sm:max-w-[180px]"
            >
              {savedBuilds.map((sb) => (
                <option key={sb.id} value={sb.id}>
                  {sb.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={build.name}
              onChange={(e) => handleUpdateBuild({ ...build, name: e.target.value })}
              aria-label="Build name"
              className="hidden w-36 rounded-md border border-slate-800 bg-slate-950/70 px-2 py-1 text-xs text-slate-200 focus:border-cyan-400 focus:outline-none lg:block"
            />

            <button
              type="button"
              onClick={handleCreateNewBuild}
              title="New Build"
              className="rounded-md border border-slate-700/80 bg-slate-900/80 p-1.5 text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => void handleSaveCloud()}
              className="flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-500/25"
            >
              <Save className="h-3 w-3" />
              <span className="hidden sm:inline">{saveToast ?? 'Save Build'}</span>
            </button>
          </div>
        </div>

        {/* Right Header Status & Actions */}
        <div className="flex items-center gap-2">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs font-bold text-emerald-300">
            {credits.toLocaleString()} CR
          </div>

          <span className="hidden rounded-md border border-slate-700/80 bg-slate-900/80 px-2 py-1 font-mono text-[10px] font-semibold text-cyan-300 sm:inline">
            {balanceConfig.version_id}
          </span>

          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-900/90 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-cyan-400"
            title="Settings"
          >
            <Settings className="h-3.5 w-3.5 text-cyan-400" />
            <span className="hidden md:inline">Settings</span>
          </button>

          {user?.role === 'admin' && (
            <button
              type="button"
              onClick={() => {
                window.history.pushState({}, '', '/admin');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="flex items-center gap-1 rounded-md border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-[11px] font-bold text-rose-300 transition hover:bg-rose-500/25"
            >
              <Shield className="h-3 w-3" />
              <span className="hidden sm:inline">Admin</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => engine.events.emit('auth:open-modal', undefined)}
            className="flex items-center gap-1.5 rounded-md border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-cyan-400"
          >
            <Cloud className={`h-3.5 w-3.5 ${syncing ? 'animate-pulse text-amber-400' : 'text-cyan-400'}`} />
            <span className="max-w-[110px] truncate">
              {user ? user.email.split('@')[0] : 'Cloud Sync'}
            </span>
          </button>
        </div>
      </header>

      {/* MIDDLE WORKSPACE (Leaves center 3D viewport open for free camera orbit!) */}
      <div className="pointer-events-none relative flex min-h-0 flex-1 items-stretch justify-between gap-3 p-3">
        {/* LEFT DOCK: Beginner & Advanced Lab Customizer */}
        <aside className="pointer-events-auto flex max-h-full w-full max-w-[360px] flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-[#0A0D14]/88 shadow-2xl backdrop-blur-md">
          {/* Drawer Toggle + Beginner / Advanced Switch */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
            <div className="flex rounded-lg border border-slate-800 bg-[#070A0F] p-0.5 text-[10px] font-bold uppercase">
              {(['beginner', 'advanced'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => updatePlayerSettings({ labMode: m })}
                  className={`rounded-md px-2.5 py-1 transition ${
                    labMode === m
                      ? 'bg-cyan-500/20 text-cyan-200'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              {drawerOpen ? (
                <>
                  <span>Orbit View</span>
                  <ChevronUp className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  <span>Expand</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>

          {/* 8 Module Tabs (Advanced Lab only) */}
          {labMode === 'advanced' && (
            <div className="grid grid-cols-4 gap-1 border-b border-slate-800/80 bg-[#080B10] p-1.5">
              {MODULES.map((m) => {
                const Icon = m.icon;
                const active = activeModule === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => selectModule(m.id)}
                    onMouseEnter={() => engine.setLabOverlayOptions({ highlightedModule: m.id })}
                    onMouseLeave={() =>
                      engine.setLabOverlayOptions({ highlightedModule: activeModule })
                    }
                    className={`flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-semibold transition ${
                      active
                        ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400/60'
                        : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="truncate">{m.short}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Scrollable Module Controls */}
          {drawerOpen && (
            <div className="flex-1 overflow-y-auto p-3">
              {labMode === 'beginner' ? (
                <BeginnerLabPanel
                  build={build}
                  compiled={compiled}
                  balanceConfig={balanceConfig}
                  speedUnit={settings.speedUnit}
                  isOwned={isOwned}
                  onChangeBuild={handleUpdateBuild}
                  onSwitchToAdvanced={() => updatePlayerSettings({ labMode: 'advanced' })}
                />
              ) : (
                <ModuleEditor
                  activeModule={activeModule}
                  build={build}
                  priceMult={priceMult}
                  isOwned={isOwned}
                  onPurchase={(id) => storage.purchaseItem(id)}
                  onChangeBuild={handleUpdateBuild}
                />
              )}
            </div>
          )}
        </aside>

        {/* RIGHT DOCK: Gamified Telemetry Widgets (Desktop / Tablet) */}
        <aside className="pointer-events-auto hidden max-h-full w-[340px] flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-[#0A0D14]/88 shadow-2xl backdrop-blur-md lg:flex">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
              Engineering Telemetry
            </span>
            <button
              type="button"
              onClick={() => setTelemetryOpen((v) => !v)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Toggle telemetry panel"
            >
              {telemetryOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {telemetryOpen && (
            <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
              {/* Compact Spec Strip */}
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                  <div className="text-[9px] text-slate-500">MASS</div>
                  <div className="text-xs font-bold text-white">
                    {compiled.totalMassKg.toFixed(0)} kg
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                  <div className="text-[9px] text-slate-500">POWER</div>
                  <div className="text-xs font-bold text-cyan-300">
                    {compiled.peakPowerHp.toFixed(0)} HP
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                  <div className="text-[9px] text-slate-500">TOP SPD</div>
                  <div className="text-xs font-bold text-amber-300">
                    {topSpeedVal} {topSpeedUnit.toLowerCase()}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                  <div className="text-[9px] text-slate-500">F / R WT</div>
                  <div className="text-xs font-bold text-slate-200">
                    {frontWtPct}/{rearWtPct}%
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                  <div className="text-[9px] text-slate-500">CG HEIGHT</div>
                  <div className="text-xs font-bold text-slate-200">
                    {(compiled.cgHeightM * 1000).toFixed(0)} mm
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                  <div className="text-[9px] text-slate-500">P/W RATIO</div>
                  <div className="text-xs font-bold text-emerald-300">
                    {compiled.pwrRatioHpPerKg.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Widget 1: Spider-Balance Diamond */}
              <SpiderChart spider={compiled.spider} />

              {/* Widget 2: Live Virtual Dyno */}
              <DynoChart compiled={compiled} />

              {/* Widget 4: Plain-English Warning Badges */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                  <span>Engineering Alerts</span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {compiled.warnings.length} active
                  </span>
                </div>
                {compiled.warnings.length === 0 ? (
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-300">
                    All mechanical, aero, and thermal subsystems balanced within safe limits.
                  </div>
                ) : (
                  compiled.warnings.map((w) => {
                    const tone =
                      w.severity === 'critical'
                        ? 'border-rose-500/45 bg-rose-500/12 text-rose-200'
                        : w.severity === 'warning'
                        ? 'border-amber-500/45 bg-amber-500/12 text-amber-200'
                        : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200';
                    return (
                      <div key={w.id} className={`rounded-lg border px-2.5 py-2 ${tone}`}>
                        <div className="flex items-center gap-1.5 text-[11px] font-bold">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>{w.title}</span>
                        </div>
                        <p className="mt-0.5 text-[10px] leading-relaxed opacity-90">
                          {w.message}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* BOTTOM STUDIO OVERLAY & LAUNCH BAR */}
      <footer
        className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 bg-[#0A0C10]/88 px-3 pt-2.5 backdrop-blur-md md:px-4"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        {/* Widget 3: 3D Studio Overlay Bar */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => engine.setLabOverlayOptions({ wireframe: !overlays.wireframe })}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
              overlays.wireframe
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                : 'border-slate-700/80 bg-slate-900/80 text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>X-Ray</span>
          </button>

          <button
            type="button"
            onClick={() => engine.setLabOverlayOptions({ cgSphere: !overlays.cgSphere })}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
              overlays.cgSphere
                ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                : 'border-slate-700/80 bg-slate-900/80 text-slate-400 hover:text-white'
            }`}
          >
            <Target className="h-3.5 w-3.5" />
            <span>
              CG {frontWtPct}/{rearWtPct} · {(compiled.cgHeightM * 1000).toFixed(0)}mm
            </span>
          </button>

          <button
            type="button"
            onClick={() => engine.setLabOverlayOptions({ aeroVectors: !overlays.aeroVectors })}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
              overlays.aeroVectors
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                : 'border-slate-700/80 bg-slate-900/80 text-slate-400 hover:text-white'
            }`}
          >
            <Wind className="h-3.5 w-3.5" />
            <span>
              Aero {compiled.aeroBalanceFrontPct.toFixed(0)}% F
            </span>
          </button>
        </div>

        {/* Circuit Picker + Launch CTAs */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCircuitModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-400"
          >
            <Trophy className="h-3.5 w-3.5 text-amber-400" />
            <span className="max-w-[140px] truncate">{activeTrack.name}</span>
          </button>

          <button
            type="button"
            onClick={() => handleLaunch(true)}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-300 transition hover:bg-amber-500/25"
          >
            <Bot className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">AI Benchmark</span>
          </button>

          <button
            type="button"
            onClick={() => handleLaunch(false)}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-400 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-slate-950 shadow-[0_0_20px_rgba(0,240,255,0.3)] transition hover:bg-cyan-300"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Drive on Track</span>
          </button>
        </div>
      </footer>

      <CircuitModal
        open={circuitModalOpen}
        onClose={() => setCircuitModalOpen(false)}
        engine={engine}
        storage={storage}
        activeTrackId={activeTrack.id}
        balanceVersionId={balanceConfig.version_id}
        onSelectTrack={(id) => engine.selectTrack(id)}
        onLaunchDrive={handleLaunch}
      />
    </div>
  );
}
