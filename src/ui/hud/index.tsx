import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Camera,
  Cloud,
  Flame,
  Fuel,
  RotateCcw,
  Settings,
  ShieldAlert,
  Smartphone,
  Trophy,
  Volume2,
  VolumeX,
  Wind,
  Wrench,
} from 'lucide-react';
import type { ModulusEngine } from '../../core/Engine';
import type { StorageSync } from '../../core/StorageSync';
import type {
  IAuthUser,
  IGlobalBalanceConfig,
  ILapFinishedPayload,
  ITrackSplineSchema,
  VisualMode,
} from '../../core/types';
import {
  getCameraPresetSafe,
  getTrackSectorNames,
  setCameraPresetSafe,
  subscribeLapInvalidated,
  subscribeSectorSplit,
} from '../engineBridge';
import {
  formatKeyCodeLabel,
  formatSpeedValue,
  speedUnitLabel,
  updatePlayerSettings,
  type ExtendedCameraPreset,
  type PlayerSettings,
} from '../settingsStore';
import { TouchControlsHud } from './TouchControlsHud';
import { useTelemetry } from './useTelemetry';

export interface IDriveHudProps {
  engine: ModulusEngine;
  storage: StorageSync;
  settings: PlayerSettings;
  debriefOpen: boolean;
  onBackToGarage: () => void;
  onOpenLab: () => void;
  onOpenSettings: () => void;
  onOpenLastDebrief?: () => void;
  onTelemetryPeaks?: (peaks: { peakLockup: number; peakScrub: number }) => void;
}

const CAMERA_ORDER: ExtendedCameraPreset[] = ['cockpit', 'hood', 'chase', 'orbit'];

function formatTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const mins = Math.floor(clamped / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function formatDelta(ms: number): string {
  const sign = ms >= 0 ? '+' : '-';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}s`;
}

function gearLabel(gear: number): string {
  if (gear === -1) return 'R';
  if (gear === 0) return 'N';
  return String(gear);
}

function detectCoarse(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function DriveHud({
  engine,
  storage,
  settings,
  debriefOpen,
  onBackToGarage,
  onOpenLab,
  onOpenSettings,
  onOpenLastDebrief,
  onTelemetryPeaks,
}: IDriveHudProps) {
  const [visualMode, setVisualMode] = useState<VisualMode>(() => engine.getVisualMode());
  const [cameraPreset, setCameraPreset] = useState<ExtendedCameraPreset>(() =>
    getCameraPresetSafe(engine)
  );
  const [activeTrack, setActiveTrack] = useState<ITrackSplineSchema>(() =>
    engine.getActiveTrack()
  );
  const [balanceConfig, setBalanceConfig] = useState<IGlobalBalanceConfig>(() =>
    engine.getBalanceConfig()
  );
  const [user, setUser] = useState<IAuthUser | null>(() => storage.getUser());
  const [touchHudEnabled, setTouchHudEnabled] = useState<boolean>(() => detectCoarse());
  const [lapToast, setLapToast] = useState<{
    lapNumber: number;
    lapTimeMs: number;
    rewardCr: number;
    lapValid: boolean;
  } | null>(null);
  const [sectorFlash, setSectorFlash] = useState<{
    sectorIndex: number;
    sectorName: string;
    splitTimeMs: number;
    deltaMs: number | null;
  } | null>(null);
  const [invalidFlash, setInvalidFlash] = useState<string | null>(null);

  const peaksRef = useRef({ peakLockup: 0, peakScrub: 0 });
  const isTrackMode = visualMode === 'track';
  const telemetry = useTelemetry(engine, isTrackMode);

  useEffect(() => {
    const unsubs = [
      engine.events.on('mode:changed', ({ mode }) => setVisualMode(mode)),
      engine.events.on('camera:preset', () => setCameraPreset(getCameraPresetSafe(engine))),
      engine.events.on('track:selected', ({ schema }) => setActiveTrack(schema)),
      engine.events.on('config:updated', ({ config }) => setBalanceConfig(config)),
      engine.events.on('auth:changed', ({ user: u }) => setUser(u)),
      engine.events.on('vehicle:reset', () => {
        peaksRef.current = { peakLockup: 0, peakScrub: 0 };
        setInvalidFlash(null);
      }),
      subscribeSectorSplit(engine, (ev) => {
        const names = getTrackSectorNames(engine.getActiveTrack());
        setSectorFlash({
          sectorIndex: ev.sectorIndex,
          sectorName: ev.sectorName ?? names[ev.sectorIndex] ?? `Sector ${ev.sectorIndex + 1}`,
          splitTimeMs: ev.splitTimeMs,
          deltaMs: typeof ev.deltaToBestSectorMs === 'number' ? ev.deltaToBestSectorMs : null,
        });
        setTimeout(() => setSectorFlash(null), 2600);
      }),
      subscribeLapInvalidated(engine, (ev) => {
        const label =
          ev.reason === 'off_track'
            ? 'OFF-TRACK — LAP UNCOUNTED'
            : ev.reason === 'wrong_way'
            ? 'WRONG WAY — TURN AROUND'
            : 'LAP UNCOUNTED';
        setInvalidFlash(label);
        setTimeout(() => setInvalidFlash(null), 3000);
      }),
      engine.events.on('lap:finished', (payload: ILapFinishedPayload) => {
        onTelemetryPeaks?.({ ...peaksRef.current });
        peaksRef.current = { peakLockup: 0, peakScrub: 0 };
        const track = engine.getActiveTrack();
        const cfg = engine.getBalanceConfig();
        const aiScale = payload.isAiAssisted ? 0.35 : 1.0;
        const rewardCr = payload.lapValid
          ? Math.max(
              250,
              Math.round(track.baseLapRewardCredits * cfg.economy_bias.payout_mult * aiScale)
            )
          : 0;
        setLapToast({
          lapNumber: payload.lapNumber,
          lapTimeMs: payload.lapTimeMs,
          rewardCr,
          lapValid: payload.lapValid,
        });
        setTimeout(() => setLapToast(null), 4600);
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [engine, onTelemetryPeaks]);

  // Track peak lockup & scrub during the current lap for Debrief coaching
  useEffect(() => {
    if (!isTrackMode) return;
    let maxLock = 0;
    let maxScrub = 0;
    for (let i = 0; i < 4; i++) {
      if (telemetry.wheels[i].lockupIntensity > maxLock)
        maxLock = telemetry.wheels[i].lockupIntensity;
      if (telemetry.wheels[i].scrubIntensity > maxScrub)
        maxScrub = telemetry.wheels[i].scrubIntensity;
    }
    if (maxLock > peaksRef.current.peakLockup) peaksRef.current.peakLockup = maxLock;
    if (maxScrub > peaksRef.current.peakScrub) peaksRef.current.peakScrub = maxScrub;
  }, [isTrackMode, telemetry.wheels]);

  if (!isTrackMode) return null;

  const toggleTouchHud = () => {
    const next = !touchHudEnabled;
    setTouchHudEnabled(next);
    window.dispatchEvent(new CustomEvent('modulus:touch-mode', { detail: { enabled: next } }));
  };

  const cycleCamera = () => {
    const idx = CAMERA_ORDER.indexOf(cameraPreset);
    setCameraPresetSafe(engine, CAMERA_ORDER[(idx + 1) % CAMERA_ORDER.length]);
  };

  // Speed in active unit (MPH default, KM/H option)
  const displayedSpeed = formatSpeedValue(telemetry.speedMs, settings.speedUnit);
  const unitText = speedUnitLabel(settings.speedUnit);

  // Tachometer arc calculation
  const rpmFrac = Math.max(
    0,
    Math.min(1, telemetry.engineRpm / Math.max(1000, telemetry.revLimiterRpm))
  );
  const shiftLightOn = telemetry.engineRpm >= telemetry.redlineRpm * 0.92;
  const arcRadius = 56;
  const arcCirc = 2 * Math.PI * arcRadius;
  const arcSweep = arcCirc * 0.72; // 260-degree sweep
  const arcFilled = arcSweep * rpmFrac;

  // Grip, Lockup & Steering Cues
  const frontLockup = Math.max(
    telemetry.wheels[0].lockupIntensity,
    telemetry.wheels[1].lockupIntensity
  );
  const rearLockup = Math.max(
    telemetry.wheels[2].lockupIntensity,
    telemetry.wheels[3].lockupIntensity
  );
  const maxScrub = Math.max(
    telemetry.wheels[0].scrubIntensity,
    telemetry.wheels[1].scrubIntensity,
    telemetry.wheels[2].scrubIntensity,
    telemetry.wheels[3].scrubIntensity
  );
  const maxDamage = Math.max(...telemetry.damageZones);
  // +1 Left -> 0% left edge, -1 Right -> 100% right edge
  const steerIndicatorPct = Math.max(6, Math.min(94, ((1 - telemetry.commandedSteer) * 0.5) * 100));

  // G-Force dot clamped to 2.2G radius
  const maxG = 2.2;
  const gDotX = 36 + Math.max(-1, Math.min(1, telemetry.lateralG / maxG)) * 28;
  const gDotY = 36 - Math.max(-1, Math.min(1, telemetry.longitudinalG / maxG)) * 28;

  const tireColorClass = (tempC: number) => {
    const [optMin, optMax] = telemetry.tireOptimalWindowC;
    if (tempC < optMin - 12) return 'border-sky-400/60 bg-sky-500/20 text-sky-200';
    if (tempC <= optMax + 6) return 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200';
    if (tempC <= optMax + 20) return 'border-amber-400/60 bg-amber-500/25 text-amber-200';
    return 'border-rose-500/70 bg-rose-500/30 text-rose-100';
  };

  const brakeColorClass = (tempC: number) => {
    if (tempC > 650) return 'text-rose-400';
    if (tempC > 380) return 'text-amber-300';
    return 'text-slate-400';
  };

  const fuelPct = Math.max(0, Math.min(100, (telemetry.fuelLiters / telemetry.fuelCapacityL) * 100));
  const coolantOverheat = telemetry.engineTempC > telemetry.engineMaxSafeTempC - 6;

  // Reverse / standstill coaching prompt
  let drivePrompt: string | null = null;
  if (!telemetry.lapArmed && telemetry.currentLapTimeMs === 0 && telemetry.speedMs < 0.5) {
    drivePrompt = `STANDING START — PRESS ${formatKeyCodeLabel(settings.keyBindings.throttle[0] ?? 'KeyW')} TO LAUNCH`;
  } else if (telemetry.reverseState === 'stopped_brake_held') {
    drivePrompt = `STOPPED — RELEASE & PRESS ${formatKeyCodeLabel(settings.keyBindings.brake[0] ?? 'KeyS')} FOR REVERSE`;
  } else if (telemetry.reverseState === 'reverse') {
    drivePrompt = 'REVERSE GEAR';
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex h-[100dvh] flex-col justify-between overflow-hidden select-none">
      {/* SAFE-AREA TOP BAR */}
      <div
        className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 px-3 md:px-4"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onBackToGarage}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/90 bg-[#0A0C10]/80 px-2.5 py-1.5 text-xs font-bold text-white backdrop-blur-md transition hover:border-cyan-400"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-cyan-400" />
            <span>Garage</span>
          </button>

          <button
            type="button"
            onClick={onOpenLab}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/90 bg-[#0A0C10]/80 px-2.5 py-1.5 text-xs font-bold text-slate-200 backdrop-blur-md transition hover:border-cyan-400"
          >
            <Wrench className="h-3.5 w-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Engineering Lab</span>
          </button>

          <button
            type="button"
            onClick={() => engine.setAiEnabled(!telemetry.aiEnabled)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold backdrop-blur-md transition ${
              telemetry.aiEnabled
                ? 'border-amber-400 bg-amber-500/25 text-amber-200 shadow-[0_0_16px_rgba(245,158,11,0.3)]'
                : 'border-slate-700/90 bg-[#0A0C10]/75 text-slate-300 hover:border-amber-400/60'
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            <span>AI Driver: {telemetry.aiEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={cycleCamera}
            title="Cycle Camera (C)"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/90 bg-[#0A0C10]/75 px-2.5 py-1.5 text-xs font-semibold uppercase text-slate-200 backdrop-blur-md transition hover:border-cyan-400"
          >
            <Camera className="h-3.5 w-3.5 text-cyan-400" />
            <span>{cameraPreset}</span>
          </button>

          <button
            type="button"
            onClick={() => engine.resetVehicleToStart()}
            title="Reset Vehicle (R)"
            className="flex items-center gap-1 rounded-lg border border-slate-700/90 bg-[#0A0C10]/75 px-2.5 py-1.5 text-xs font-semibold text-slate-200 backdrop-blur-md transition hover:border-cyan-400"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <button
            type="button"
            onClick={() => updatePlayerSettings({ muted: !settings.muted })}
            title={settings.muted ? 'Unmute Cockpit Audio' : 'Mute Cockpit Audio'}
            className="flex items-center gap-1 rounded-lg border border-slate-700/90 bg-[#0A0C10]/75 px-2 py-1.5 text-xs font-semibold text-slate-200 backdrop-blur-md transition hover:border-cyan-400"
          >
            {settings.muted ? (
              <VolumeX className="h-3.5 w-3.5 text-rose-400" />
            ) : (
              <Volume2 className="h-3.5 w-3.5 text-cyan-400" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            title="Settings"
            className="flex items-center gap-1 rounded-lg border border-slate-700/90 bg-[#0A0C10]/75 px-2.5 py-1.5 text-xs font-semibold text-slate-200 backdrop-blur-md transition hover:border-cyan-400"
          >
            <Settings className="h-3.5 w-3.5 text-cyan-400" />
            <span className="hidden md:inline">Settings</span>
          </button>

          <button
            type="button"
            onClick={toggleTouchHud}
            title="Toggle On-Screen Touch Controls"
            className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold backdrop-blur-md transition ${
              touchHudEnabled
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                : 'border-slate-700/90 bg-[#0A0C10]/75 text-slate-300 hover:border-cyan-400'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => engine.events.emit('auth:open-modal', undefined)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/90 bg-[#0A0C10]/75 px-2.5 py-1.5 text-xs font-semibold text-slate-200 backdrop-blur-md transition hover:border-cyan-400"
          >
            <Cloud className="h-3.5 w-3.5 text-cyan-400" />
            <span className="hidden sm:inline">
              {user ? user.email.split('@')[0] : 'Sync'}
            </span>
          </button>
        </div>
      </div>

      {/* CENTER-TOP FEEDBACK BANNERS (Lap Toast, Sector Split, Standstill/Reverse Cue) */}
      {!debriefOpen && (
        <div className="pointer-events-none fixed top-16 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1.5">
          {lapToast && (
            <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-cyan-400/60 bg-[#0A0C10]/90 px-4 py-2.5 shadow-[0_0_24px_rgba(0,240,255,0.25)] backdrop-blur-md">
              <Trophy className="h-5 w-5 text-amber-400" />
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                  Lap {lapToast.lapNumber} Complete {!lapToast.lapValid ? '(Off-Track)' : ''}
                </div>
                <div className="flex items-center gap-2.5 font-mono text-sm font-black text-white">
                  <span>{formatTime(lapToast.lapTimeMs)}</span>
                  {lapToast.rewardCr > 0 && (
                    <span className="text-emerald-400">
                      +{lapToast.rewardCr.toLocaleString()} CR
                    </span>
                  )}
                </div>
              </div>
              {onOpenLastDebrief && (
                <button
                  type="button"
                  onClick={onOpenLastDebrief}
                  className="rounded-lg border border-cyan-400/50 bg-cyan-500/20 px-2.5 py-1 text-[10px] font-bold uppercase text-cyan-200 hover:bg-cyan-500/30"
                >
                  Debrief
                </button>
              )}
            </div>
          )}

          {sectorFlash && !lapToast && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0A0C10]/85 px-3 py-1 font-mono text-[11px] backdrop-blur-md">
              <span className="font-bold text-cyan-300">
                S{sectorFlash.sectorIndex + 1} · {sectorFlash.sectorName}
              </span>
              <span className="font-bold text-white">
                {(sectorFlash.splitTimeMs / 1000).toFixed(2)}s
              </span>
              {sectorFlash.deltaMs !== null && (
                <span
                  className={
                    sectorFlash.deltaMs <= 0
                      ? 'font-bold text-emerald-400'
                      : 'font-bold text-rose-400'
                  }
                >
                  {formatDelta(sectorFlash.deltaMs)}
                </span>
              )}
            </div>
          )}

          {invalidFlash && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/70 bg-rose-500/20 px-3 py-1 font-mono text-[10px] font-bold text-rose-200 backdrop-blur-md">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{invalidFlash}</span>
            </div>
          )}

          {drivePrompt && !lapToast && (
            <div className="rounded-lg border border-cyan-400/40 bg-[#0A0C10]/82 px-3 py-1 font-mono text-[10px] font-bold tracking-wider text-cyan-200 backdrop-blur-md">
              {drivePrompt}
            </div>
          )}
        </div>
      )}

      {/* MIDDLE ROW: TIMING TOWER (LEFT) + ALERTS (RIGHT) */}
      <div className="flex flex-1 items-start justify-between px-3 pt-2 md:px-4">
        {/* Motorsport Timing Tower */}
        <div className="w-52 rounded-xl border border-slate-800/90 bg-[#0A0C10]/78 p-2.5 backdrop-blur-md">
          <div className="flex items-center justify-between gap-1 border-b border-slate-800 pb-1.5">
            <span className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-300">
              {activeTrack.name}
            </span>
            <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-cyan-300">
              {balanceConfig.version_id}
            </span>
          </div>

          <div className="mt-1.5 flex items-baseline justify-between">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-bold text-slate-400">
                LAP {telemetry.currentLap}
              </span>
              {!telemetry.lapValid && (
                <span className="rounded bg-rose-500/25 px-1 py-0.5 font-mono text-[9px] font-bold text-rose-300">
                  INV
                </span>
              )}
            </div>
            <span className="font-mono text-base font-black text-white">
              {formatTime(telemetry.currentLapTimeMs)}
            </span>
          </div>

          {/* Sector Splits */}
          <div className="mt-1.5 grid grid-cols-3 gap-1 font-mono text-[9px]">
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className={`rounded px-1.5 py-0.5 ${
                  telemetry.currentSector === idx
                    ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/40'
                    : 'bg-slate-900/80 text-slate-400'
                }`}
              >
                <div className="text-[8px] opacity-75">S{idx + 1}</div>
                <div>
                  {telemetry.sectorTimesMs[idx] > 0
                    ? (telemetry.sectorTimesMs[idx] / 1000).toFixed(2)
                    : '--.--'}
                </div>
              </div>
            ))}
          </div>

          {/* Best Lap & Delta */}
          <div className="mt-1.5 flex items-center justify-between border-t border-slate-800/80 pt-1.5 font-mono text-[10px]">
            <span className="text-slate-400">
              BEST:{' '}
              <span className="text-slate-100">
                {telemetry.bestLapTimeMs !== null
                  ? formatTime(telemetry.bestLapTimeMs)
                  : '--:--.---'}
              </span>
            </span>
            {telemetry.lastLapTimeMs !== null && (
              <span
                className={`font-bold ${
                  telemetry.lapDeltaMs <= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatDelta(telemetry.lapDeltaMs)}
              </span>
            )}
          </div>
        </div>

        {/* Right Alerts: Lockup, Scrub, Limp Mode, Diffuser Stall, Damage */}
        <div className="flex flex-col items-end gap-1.5">
          {frontLockup > 0.3 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/70 bg-rose-500/25 px-2.5 py-1 font-mono text-[10px] font-bold text-rose-100 backdrop-blur-md">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-300" />
              <span>FRONT LOCKUP — EASE BRAKE</span>
            </div>
          )}
          {rearLockup > 0.35 && frontLockup <= 0.3 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/70 bg-amber-500/25 px-2.5 py-1 font-mono text-[10px] font-bold text-amber-100 backdrop-blur-md">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
              <span>REAR SLIP — COUNTERSTEER</span>
            </div>
          )}
          {(telemetry.engineLimpMode || telemetry.engineBlown) && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/70 bg-rose-500/25 px-3 py-1.5 text-xs font-bold text-rose-100 backdrop-blur-md">
              <AlertTriangle className="h-4 w-4 animate-pulse text-rose-300" />
              <span>
                {telemetry.engineBlown
                  ? 'ENGINE BLOWN — RESET (R)'
                  : 'ENGINE LIMP MODE — OVERHEAT'}
              </span>
            </div>
          )}
          {telemetry.diffuserStalled && (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/60 bg-amber-500/20 px-2.5 py-1 font-mono text-[10px] font-bold text-amber-200 backdrop-blur-md">
              <Wind className="h-3.5 w-3.5" />
              <span>DIFFUSER STALL</span>
            </div>
          )}
          {maxDamage > 0.08 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/60 bg-[#0A0C10]/85 px-2.5 py-1 font-mono text-[10px] font-bold text-amber-300 backdrop-blur-md">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>CHASSIS WEAR {Math.round(maxDamage * 100)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM TELEMETRY CLUSTER */}
      <div
        className={`flex flex-wrap items-end justify-between gap-3 px-3 md:px-4 ${
          touchHudEnabled ? 'mb-36 sm:mb-28' : ''
        }`}
        style={{ paddingBottom: touchHudEnabled ? '0px' : 'var(--safe-bottom)' }}
      >
        {/* Bottom-Left: 4-Corner Tire/Brake Thermals + Coolant & Fuel */}
        <div className="flex items-end gap-2">
          <div className="rounded-xl border border-slate-800/90 bg-[#0A0C10]/80 p-2.5 backdrop-blur-md">
            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
              Tires & Brakes
            </div>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[9px]">
              {(['FL', 'FR', 'RL', 'RR'] as const).map((corner, i) => {
                const w = telemetry.wheels[i];
                const wearPct = Math.round((1 - Math.max(0, Math.min(1, w.tireWear))) * 100);
                return (
                  <div
                    key={corner}
                    className={`w-16 rounded-md border px-1.5 py-1 ${tireColorClass(w.tireTempC)}`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span>{corner}</span>
                      <span>{Math.round(w.tireTempC)}°</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[8px] opacity-90">
                      <span>{wearPct}%</span>
                      <span className={brakeColorClass(w.brakeTempC)}>
                        {Math.round(w.brakeTempC)}°B
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Coolant & Fuel */}
          <div className="hidden flex-col gap-1.5 rounded-xl border border-slate-800/90 bg-[#0A0C10]/80 p-2.5 font-mono text-[10px] backdrop-blur-md sm:flex">
            <div className="flex items-center gap-1.5">
              <Flame
                className={`h-3.5 w-3.5 ${coolantOverheat ? 'text-rose-400' : 'text-amber-400'}`}
              />
              <span className="text-slate-400">ENG</span>
              <span className={`font-bold ${coolantOverheat ? 'text-rose-300' : 'text-slate-100'}`}>
                {Math.round(telemetry.engineTempC)}°C
              </span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Fuel className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-slate-400">FUEL</span>
                <span className="font-bold text-slate-100">
                  {telemetry.fuelLiters.toFixed(1)} L
                </span>
              </div>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full ${fuelPct < 15 ? 'bg-rose-500' : 'bg-cyan-400'}`}
                  style={{ width: `${fuelPct}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom-Center: First-Use Key Hints Strip (Desktop, toggleable in Settings) */}
        {settings.showControlHints && !touchHudEnabled && !debriefOpen && (
          <div className="pointer-events-auto hidden items-center gap-2 rounded-xl border border-slate-800/80 bg-[#0A0C10]/72 px-3 py-1.5 font-mono text-[10px] text-slate-300 backdrop-blur-md xl:flex">
            <span>
              <b className="text-cyan-300">
                {formatKeyCodeLabel(settings.keyBindings.throttle[0] ?? 'KeyW')}
              </b>{' '}
              Gas
            </span>
            <span className="text-slate-600">·</span>
            <span>
              <b className="text-rose-300">
                {formatKeyCodeLabel(settings.keyBindings.brake[0] ?? 'KeyS')}
              </b>{' '}
              Brake (2× stop=Rev)
            </span>
            <span className="text-slate-600">·</span>
            <span>
              <b className="text-cyan-300">
                {formatKeyCodeLabel(settings.keyBindings.steerLeft[0] ?? 'KeyA')}/
                {formatKeyCodeLabel(settings.keyBindings.steerRight[0] ?? 'KeyD')}
              </b>{' '}
              Steer
            </span>
            <span className="text-slate-600">·</span>
            <span>
              <b className="text-amber-300">
                {formatKeyCodeLabel(settings.keyBindings.handbrake[0] ?? 'Space')}
              </b>{' '}
              Handbrake
            </span>
            <span className="text-slate-600">·</span>
            <span>
              <b className="text-slate-100">
                {formatKeyCodeLabel(settings.keyBindings.camera[0] ?? 'KeyC')}
              </b>{' '}
              Cam
            </span>
            <span className="text-slate-600">·</span>
            <span>
              <b className="text-slate-100">
                {formatKeyCodeLabel(settings.keyBindings.reset[0] ?? 'KeyR')}
              </b>{' '}
              Reset
            </span>
          </div>
        )}

        {/* Bottom-Right: G-Force Friction Circle + Speedo / Tach / Gear / Steering & Grip Cues */}
        <div className="flex items-end gap-2.5">
          {/* G-Force Friction Circle + Aero Downforce */}
          <div className="hidden flex-col items-center rounded-xl border border-slate-800/90 bg-[#0A0C10]/80 p-2 backdrop-blur-md sm:flex">
            <svg viewBox="0 0 72 72" className="h-16 w-16">
              <circle cx="36" cy="36" r="28" fill="none" stroke="#1E293B" strokeWidth="1" />
              <circle cx="36" cy="36" r="14" fill="none" stroke="#1E293B" strokeWidth="0.8" />
              <line x1="8" y1="36" x2="64" y2="36" stroke="#1E293B" strokeWidth="0.8" />
              <line x1="36" y1="8" x2="36" y2="64" stroke="#1E293B" strokeWidth="0.8" />
              <circle
                cx={gDotX}
                cy={gDotY}
                r="4"
                fill={frontLockup > 0.3 ? '#F43F5E' : maxScrub > 0.45 ? '#F59E0B' : '#00F0FF'}
              />
            </svg>
            <div className="font-mono text-[9px] text-slate-300">
              {Math.hypot(telemetry.lateralG, telemetry.longitudinalG).toFixed(2)} G
            </div>
            <div className="font-mono text-[9px] text-cyan-400">
              {Math.round(telemetry.downforceTotalKgf)} kgf DF
            </div>
          </div>

          {/* Primary Speedo + Tachometer + Gear + Steering/Grip Bar */}
          <div className="relative flex flex-col gap-1.5 rounded-2xl border border-slate-800/90 bg-[#0A0C10]/85 px-3.5 py-2.5 backdrop-blur-md">
            {/* Live Steering & Tire Grip Cue Bar */}
            <div className="flex items-center gap-2">
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                <div className="absolute inset-y-0 left-1/2 w-px bg-slate-500" />
                <div
                  className={`absolute top-0 bottom-0 w-3 -translate-x-1/2 rounded-full transition-[left] duration-75 ${
                    frontLockup > 0.3
                      ? 'bg-rose-500'
                      : maxScrub > 0.45
                      ? 'bg-amber-400'
                      : 'bg-cyan-400'
                  }`}
                  style={{ left: `${steerIndicatorPct}%` }}
                />
              </div>
              <span
                className={`font-mono text-[8px] font-bold uppercase ${
                  frontLockup > 0.3
                    ? 'text-rose-400'
                    : maxScrub > 0.45
                    ? 'text-amber-300'
                    : 'text-emerald-400'
                }`}
              >
                {frontLockup > 0.3 ? 'LOCK' : maxScrub > 0.45 ? 'SCRUB' : 'GRIP'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* Throttle / Brake Mini Bars */}
              <div className="flex h-24 items-end gap-1">
                <div className="relative h-full w-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="absolute inset-x-0 bottom-0 bg-rose-500"
                    style={{ height: `${Math.round(telemetry.brake * 100)}%` }}
                  />
                </div>
                <div className="relative h-full w-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="absolute inset-x-0 bottom-0 bg-emerald-400"
                    style={{ height: `${Math.round(telemetry.throttle * 100)}%` }}
                  />
                </div>
              </div>

              {/* SVG Tachometer Arc + Speedo + Gear */}
              <div className="relative flex h-28 w-32 items-center justify-center">
                <svg viewBox="0 0 132 132" className="h-28 w-28 -rotate-[220deg]">
                  <circle
                    cx="66"
                    cy="66"
                    r={arcRadius}
                    fill="none"
                    stroke="#1E293B"
                    strokeWidth="8"
                    strokeDasharray={`${arcSweep} ${arcCirc}`}
                    strokeLinecap="round"
                  />
                  <circle
                    cx="66"
                    cy="66"
                    r={arcRadius}
                    fill="none"
                    stroke={shiftLightOn ? '#F43F5E' : '#00F0FF'}
                    strokeWidth="8"
                    strokeDasharray={`${arcFilled} ${arcCirc}`}
                    strokeLinecap="round"
                  />
                </svg>

                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  {/* Shift Light */}
                  <div
                    className={`mb-0.5 h-1.5 w-8 rounded-full transition ${
                      shiftLightOn
                        ? 'animate-pulse bg-rose-500 shadow-[0_0_12px_#F43F5E]'
                        : 'bg-slate-800'
                    }`}
                  />
                  <div className="font-mono text-2xl font-black leading-none text-white">
                    {displayedSpeed}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updatePlayerSettings({
                        speedUnit: settings.speedUnit === 'mph' ? 'kph' : 'mph',
                      })
                    }
                    title="Toggle MPH / KM/H"
                    className="pointer-events-auto font-mono text-[9px] uppercase text-slate-400 hover:text-cyan-300"
                  >
                    {unitText}
                  </button>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-xs font-black ${
                        shiftLightOn
                          ? 'bg-rose-500 text-white'
                          : 'bg-cyan-500/20 text-cyan-300'
                      }`}
                    >
                      {gearLabel(telemetry.gear)}
                    </span>
                    <span className="font-mono text-[10px] text-slate-300">
                      {(telemetry.engineRpm / 1000).toFixed(1)}k
                    </span>
                  </div>
                </div>
              </div>

              {/* Turbo Boost Meter */}
              {telemetry.maxBoostBar > 0 && (
                <div className="flex flex-col items-center font-mono text-[9px]">
                  <span className="text-amber-400">BST</span>
                  <div className="relative my-1 h-16 w-2.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="absolute inset-x-0 bottom-0 bg-amber-400"
                      style={{
                        height: `${Math.max(
                          0,
                          Math.min(100, (telemetry.turboBoostBar / telemetry.maxBoostBar) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                  <span className="text-slate-200">{telemetry.turboBoostBar.toFixed(1)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* MOBILE TOUCH CONTROLS HUD */}
      <TouchControlsHud
        engine={engine}
        visible={touchHudEnabled}
        steer={telemetry.steer}
        throttle={telemetry.throttle}
        brake={telemetry.brake}
        handbrake={telemetry.handbrake}
      />
    </div>
  );
}
