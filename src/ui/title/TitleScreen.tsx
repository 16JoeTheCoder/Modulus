import { Cloud, Play, Settings, Wrench } from 'lucide-react';
import type { IAuthUser, ICompiledVehicle, ITrackSplineSchema } from '../../core/types';
import {
  formatSpeedFromKph,
  speedUnitLabel,
  type PlayerSettings,
  type ResumableSession,
} from '../settingsStore';

export interface ITitleScreenProps {
  compiled: ICompiledVehicle;
  activeTrack: ITrackSplineSchema;
  settings: PlayerSettings;
  resumableSession: ResumableSession | null;
  user: IAuthUser | null;
  onEnterGarage: () => void;
  onContinueDriving: () => void;
  onOpenSettings: () => void;
  onOpenAuth: () => void;
}

function formatMs(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const mins = Math.floor(clamped / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

export function TitleScreen({
  compiled,
  activeTrack,
  settings,
  resumableSession,
  user,
  onEnterGarage,
  onContinueDriving,
  onOpenSettings,
  onOpenAuth,
}: ITitleScreenProps) {
  const topSpeed = formatSpeedFromKph(compiled.estimatedTopSpeedKph, settings.speedUnit);
  const unitLabel = speedUnitLabel(settings.speedUnit);

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex h-[100dvh] flex-col justify-between bg-gradient-to-b from-[#06080C]/80 via-transparent to-[#06080C]/92 select-none">
      {/* Top Bar */}
      <header
        className="pointer-events-auto flex items-center justify-between px-5 md:px-8"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-400/10 text-cyan-300">
            <Wrench className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-black tracking-[0.26em] text-white">MODULUS</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-slate-400">
              Motorsport Engineering Sim
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#0A0D14]/80 px-3 py-1.5 text-xs font-semibold text-slate-200 backdrop-blur-md transition hover:border-cyan-400 hover:text-white"
          >
            <Settings className="h-3.5 w-3.5 text-cyan-400" />
            <span>Settings</span>
          </button>

          <button
            type="button"
            onClick={onOpenAuth}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#0A0D14]/80 px-3 py-1.5 text-xs font-semibold text-slate-200 backdrop-blur-md transition hover:border-cyan-400 hover:text-white"
          >
            <Cloud className="h-3.5 w-3.5 text-cyan-400" />
            <span>{user ? user.email.split('@')[0] : 'Cloud Sync'}</span>
          </button>
        </div>
      </header>

      {/* Center stays open for the dim 3D garage bay hero car */}
      <div className="flex-1" />

      {/* Bottom Editorial Hero & Primary Actions */}
      <footer
        className="pointer-events-auto flex flex-col gap-5 px-5 md:flex-row md:items-end md:justify-between md:px-8"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 14px)' }}
      >
        <div className="max-w-lg space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-[#0A0D14]/80 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-cyan-300 backdrop-blur-md">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: compiled.build.paintHex }}
            />
            <span>{compiled.build.name}</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-300">{compiled.chassisName}</span>
          </div>

          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
            Build the machine.
            <span className="block text-cyan-400">Feel every corner.</span>
          </h1>

          <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-slate-300">
            <span>{Math.round(compiled.peakPowerHp)} HP</span>
            <span className="text-slate-600">/</span>
            <span>{Math.round(compiled.totalMassKg)} kg</span>
            <span className="text-slate-600">/</span>
            <span>
              {topSpeed} {unitLabel} est.
            </span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400">{activeTrack.name}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {resumableSession && (
            <button
              type="button"
              onClick={onContinueDriving}
              className="flex items-center gap-2.5 rounded-xl border border-cyan-400/50 bg-[#0B1220]/90 px-5 py-3 text-left transition hover:border-cyan-300 hover:bg-cyan-500/15"
            >
              <Play className="h-4 w-4 fill-cyan-400 text-cyan-400" />
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-cyan-200">
                  Continue Driving
                </div>
                <div className="font-mono text-[10px] text-slate-400">
                  {resumableSession.trackName}
                  {resumableSession.lastLapTimeMs !== null
                    ? ` · Last ${formatMs(resumableSession.lastLapTimeMs)}`
                    : ''}
                </div>
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={onEnterGarage}
            className="flex items-center gap-2.5 rounded-xl bg-cyan-400 px-6 py-3.5 text-sm font-black uppercase tracking-wider text-slate-950 shadow-[0_0_28px_rgba(0,240,255,0.32)] transition hover:bg-cyan-300"
          >
            <Wrench className="h-4 w-4" />
            <span>Enter Garage</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
