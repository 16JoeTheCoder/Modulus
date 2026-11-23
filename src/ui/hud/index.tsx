import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Camera,
  Cloud,
  Flame,
  Fuel,
  RotateCcw,
  Smartphone,
  Trophy,
  Wind,
} from 'lucide-react';
import type { ModulusEngine } from '../../core/Engine';
import type { StorageSync } from '../../core/StorageSync';
import type {
  CameraPreset,
  IAuthUser,
  IGlobalBalanceConfig,
  ILapFinishedPayload,
  ITrackSplineSchema,
  VisualMode,
} from '../../core/types';
import { TouchControlsHud } from './TouchControlsHud';
import { useTelemetry } from './useTelemetry';

export interface IDriveHudProps {
  engine: ModulusEngine;
  storage: StorageSync;
}

const CAMERA_ORDER: CameraPreset[] = ['chase', 'hood', 'orbit'];

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

export function DriveHud({ engine, storage }: IDriveHudProps) {
  const [visualMode, setVisualMode] = useState<VisualMode>(() => engine.getVisualMode());
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>(() => engine.getCameraPreset());
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

  const isTrackMode = visualMode === 'track';
  const telemetry = useTelemetry(engine, isTrackMode);

  useEffect(() => {
    const unsubs = [
      engine.events.on('mode:changed', ({ mode }) => setVisualMode(mode)),
      engine.events.on('camera:preset', ({ preset }) => setCameraPreset(preset)),
      engine.events.on('track:selected', ({ schema }) => setActiveTrack(schema)),
      engine.events.on('config:updated', ({ config }) => setBalanceConfig(config)),
      engine.events.on('auth:changed', ({ user: u }) => setUser(u)),
      engine.events.on('lap:finished', (payload: ILapFinishedPayload) => {
        const track = engine.getActiveTrack();
        const cfg = engine.getBalanceConfig();
        const aiScale = payload.isAiAssisted ? 0.35 : 1.0;
        const rewardCr = payload.lapValid
          ? Math.max(250, Math.round(track.baseLapRewardCredits * cfg.economy_bias.payout_mult * aiScale))
          : 0;
        setLapToast({
          lapNumber: payload.lapNumber,
          lapTimeMs: payload.lapTimeMs,
          rewardCr,
          lapValid: payload.lapValid,
        });
        setTimeout(() => setLapToast(null), 4200);
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [engine]);

  if (!isTrackMode) return null;

  const toggleTouchHud = () => {
    const next = !touchHudEnabled;
    setTouchHudEnabled(next);
    window.dispatchEvent(new CustomEvent('modulus:touch-mode', { detail: { enabled: next } }));
  };

  const cycleCamera = () => {
    const idx = CAMERA_ORDER.indexOf(cameraPreset);
    engine.setCameraPreset(CAMERA_ORDER[(idx + 1) % CAMERA_ORDER.length]);
  };

  // Tachometer arc calculation
  const rpmFrac = Math.max(0, Math.min(1, telemetry.engineRpm / Math.max(1000, telemetry.revLimiterRpm)));
  const shiftLightOn = telemetry.engineRpm >= telemetry.redlineRpm * 0.92;
  const arcRadius = 56;
  const arcCirc = 2 * Math.PI * arcRadius;
  const arcSweep = arcCirc * 0.72; // 260-degree sweep
  const arcFilled = arcSweep * rpmFrac;

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
            onClick={() => engine.setVisualMode('lab')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/90 bg-[#0A0C10]/80 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-md transition hover:border-cyan-400"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-cyan-400" />
            <span>Engineering Lab</span>
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
            onClick={toggleTouchHud}
            title="Toggle On-Screen Touch Controls"
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold backdrop-blur-md transition ${
              touchHudEnabled
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                : 'border-slate-700/90 bg-[#0A0C10]/75 text-slate-300 hover:border-cyan-400'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Touch</span>
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

      {/* LAP FINISH REWARD TOAST */}
      {lapToast && (
        <div className="pointer-events-none fixed top-20 left-1/2 z-30 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-xl border border-cyan-400/60 bg-[#0A0C10]/90 px-4 py-2.5 shadow-[0_0_24px_rgba(0,240,255,0.25)] backdrop-blur-md">
            <Trophy className="h-5 w-5 text-amber-400" />
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                Lap {lapToast.lapNumber} Complete {!lapToast.lapValid ? '(Off-Track)' : ''}
              </div>
              <div className="flex items-center gap-2.5 font-mono text-sm font-black text-white">
                <span>{formatTime(lapToast.lapTimeMs)}</span>
                {lapToast.rewardCr > 0 && (
                  <span className="text-emerald-400">+{lapToast.rewardCr.toLocaleString()} CR</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MIDDLE ROW: TIMING TOWER (LEFT) + ENGINE ALERT BANNER */}
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
                {telemetry.bestLapTimeMs !== null ? formatTime(telemetry.bestLapTimeMs) : '--:--.---'}
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

        {/* Limp Mode / Engine Blown / Diffuser Stall Alerts */}
        <div className="flex flex-col items-end gap-1.5">
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
        </div>
      </div>

      {/* BOTTOM TELEMETRY CLUSTER (Shifts slightly inward/upward if Touch HUD is active) */}
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
              <Flame className={`h-3.5 w-3.5 ${coolantOverheat ? 'text-rose-400' : 'text-amber-400'}`} />
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

        {/* Bottom-Right: G-Force Friction Circle + Speedo / Tach / Gear / Boost */}
        <div className="flex items-end gap-2.5">
          {/* G-Force Friction Circle + Aero Downforce */}
          <div className="hidden flex-col items-center rounded-xl border border-slate-800/90 bg-[#0A0C10]/80 p-2 backdrop-blur-md sm:flex">
            <svg viewBox="0 0 72 72" className="h-16 w-16">
              <circle cx="36" cy="36" r="28" fill="none" stroke="#1E293B" strokeWidth="1" />
              <circle cx="36" cy="36" r="14" fill="none" stroke="#1E293B" strokeWidth="0.8" />
              <line x1="8" y1="36" x2="64" y2="36" stroke="#1E293B" strokeWidth="0.8" />
              <line x1="36" y1="8" x2="36" y2="64" stroke="#1E293B" strokeWidth="0.8" />
              <circle cx={gDotX} cy={gDotY} r="4" fill="#00F0FF" />
            </svg>
            <div className="font-mono text-[9px] text-slate-300">
              {Math.hypot(telemetry.lateralG, telemetry.longitudinalG).toFixed(2)} G
            </div>
            <div className="font-mono text-[9px] text-cyan-400">
              {Math.round(telemetry.downforceTotalKgf)} kgf DF
            </div>
          </div>

          {/* Primary Speedo + Tachometer + Gear + Boost Cluster */}
          <div className="relative flex items-center gap-3 rounded-2xl border border-slate-800/90 bg-[#0A0C10]/85 px-3.5 py-2.5 backdrop-blur-md">
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
                  {Math.round(telemetry.speedKph)}
                </div>
                <div className="font-mono text-[9px] uppercase text-slate-400">KM/H</div>
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
                <div className="my-1 relative h-16 w-2.5 overflow-hidden rounded-full bg-slate-800">
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
