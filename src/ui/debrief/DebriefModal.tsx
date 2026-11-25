import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Play,
  RotateCcw,
  Sparkles,
  Trophy,
  Wrench,
} from 'lucide-react';
import type { ILapFinishedEvent, LapInvalidationReason } from '../../contracts/simulation';
import type { ITrackSplineSchema } from '../../core/types';
import { formatSpeedValue, speedUnitLabel, type SpeedUnit } from '../settingsStore';

export interface IDebriefReport {
  event: ILapFinishedEvent;
  buildName: string;
  track: ITrackSplineSchema;
  rewardCr: number;
  isNewBestLap: boolean;
  bestLapTimeMs: number | null;
  deltaToBestLapMs: number | null;
  deltaToPrevLapMs: number | null;
  sectorDeltasMs: Array<number | null>;
  peakLockup: number;
  peakScrub: number;
}

export interface IDebriefModalProps {
  report: IDebriefReport | null;
  speedUnit: SpeedUnit;
  onRetryLap: () => void;
  onContinueRolling: () => void;
  onAdjustCar: () => void;
  onBackToGarage: () => void;
}

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

function reasonLabel(r: LapInvalidationReason): string {
  if (r === 'off_track') return 'Off-track excursion';
  if (r === 'wall_skip') return 'Wall / barrier skip';
  if (r === 'missed_checkpoint') return 'Missed sector gate';
  if (r === 'wrong_way') return 'Wrong direction';
  return 'Manual reset';
}

function buildCoachingTakeaway(report: IDebriefReport): string {
  const { event, sectorDeltasMs, peakLockup, peakScrub } = report;

  if (!event.lapValid) {
    return 'Run went off-track — focus on braking a touch earlier before turn-in so all four wheels stay on the tarmac for an eligible Personal Best.';
  }

  // Find slowest sector relative to personal best
  let worstSectorIdx = -1;
  let worstDelta = 120; // > 0.12s slower
  for (let i = 0; i < sectorDeltasMs.length; i++) {
    const d = sectorDeltasMs[i];
    if (d !== null && d > worstDelta) {
      worstDelta = d;
      worstSectorIdx = i;
    }
  }

  if (worstSectorIdx >= 0) {
    const name = event.sectorNames[worstSectorIdx] ?? `Sector ${worstSectorIdx + 1}`;
    const lockNote =
      peakLockup > 0.55
        ? ' Detected heavy brake lockup — ease off the brake pedal as you turn in or adjust Brake Bias in the Lab.'
        : peakScrub > 0.72
        ? ' High tire scrub mid-corner — try carrying slightly less entry speed for a cleaner exit.'
        : ' Try a smoother corner entry and earlier throttle roll-on.';
    return `Lost ${(worstDelta / 1000).toFixed(2)}s in ${name} vs your best sector.${lockNote}`;
  }

  if (report.isNewBestLap) {
    return 'Clean new Personal Best! Want quicker exits on short straights? Try the Short Final Drive or Sharp Turn-In preset in the Beginner Lab.';
  }

  if (peakLockup > 0.55) {
    return 'Clean lap, though front brakes locked under heavy stops. Try progressively releasing S into corners or shifting Brake Bias slightly rearward.';
  }

  return 'Consistent clean lap! Open the Engineering Lab to adjust gearing or handling balance, then hit Retry to compare sector splits.';
}

export function DebriefModal({
  report,
  speedUnit,
  onRetryLap,
  onContinueRolling,
  onAdjustCar,
  onBackToGarage,
}: IDebriefModalProps) {
  if (!report) return null;

  const { event, track, buildName, rewardCr, isNewBestLap, deltaToBestLapMs, deltaToPrevLapMs } =
    report;
  const peakSpd = formatSpeedValue(event.peakSpeedMs, speedUnit);
  const unitLabel = speedUnitLabel(speedUnit);

  const medal = !event.lapValid
    ? null
    : event.lapTimeMs <= track.targetGoldTimeMs
    ? { label: 'GOLD PACE', tone: 'border-amber-400/60 bg-amber-500/20 text-amber-200' }
    : event.lapTimeMs <= track.targetSilverTimeMs
    ? { label: 'SILVER PACE', tone: 'border-slate-400/60 bg-slate-500/20 text-slate-200' }
    : event.lapTimeMs <= track.targetBronzeTimeMs
    ? { label: 'BRONZE PACE', tone: 'border-orange-500/50 bg-orange-500/20 text-orange-200' }
    : null;

  const takeaway = buildCoachingTakeaway(report);

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm select-none">
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700/90 bg-[#0B0F17]/96 shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-[#080B11] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            {event.lapValid ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-rose-400" />
            )}
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white">
                <span>Lap {event.lapNumber} Complete</span>
                {isNewBestLap && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/60 bg-cyan-500/20 px-2 py-0.5 font-mono text-[9px] text-cyan-200">
                    <Sparkles className="h-2.5 w-2.5" />
                    NEW PB
                  </span>
                )}
                {medal && (
                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${medal.tone}`}>
                    {medal.label}
                  </span>
                )}
              </div>
              <div className="font-mono text-[10px] text-slate-400">
                {track.name} ({event.trackVersion}) · {buildName}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-[10px] uppercase text-slate-400 ring-1 ring-slate-700">
              {event.verificationLevel.replace('_', ' ')}
            </span>
            {rewardCr > 0 && (
              <span className="rounded bg-emerald-500/15 px-2.5 py-0.5 font-mono text-xs font-bold text-emerald-300 ring-1 ring-emerald-500/35">
                +{rewardCr.toLocaleString()} CR
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Primary Time + Deltas */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.3fr_1fr]">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Completed Lap Time
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="font-mono text-3xl font-black tracking-tight text-white">
                  {formatTime(event.lapTimeMs)}
                </span>
                {deltaToBestLapMs !== null && !isNewBestLap && (
                  <span
                    className={`font-mono text-sm font-bold ${
                      deltaToBestLapMs <= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {formatDelta(deltaToBestLapMs)} vs PB
                  </span>
                )}
              </div>
              {deltaToPrevLapMs !== null && (
                <div className="mt-1 font-mono text-[11px] text-slate-400">
                  vs Previous Attempt:{' '}
                  <span
                    className={
                      deltaToPrevLapMs <= 0 ? 'font-bold text-emerald-400' : 'font-bold text-amber-300'
                    }
                  >
                    {formatDelta(deltaToPrevLapMs)}
                  </span>
                </div>
              )}
              {!event.lapValid && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-rose-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Lap Uncounted:{' '}
                    {event.invalidReasons.map(reasonLabel).join(', ') || 'Off-track'}
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-[9px] text-slate-500">PERSONAL BEST</div>
                <div className="mt-1 font-bold text-cyan-300">
                  {report.bestLapTimeMs !== null ? formatTime(report.bestLapTimeMs) : '--:--.---'}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-[9px] text-slate-500">PEAK SPEED</div>
                <div className="mt-1 font-bold text-white">
                  {peakSpd} {unitLabel}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-[9px] text-slate-500">GOLD TARGET</div>
                <div className="mt-1 font-bold text-amber-300">
                  {formatTime(track.targetGoldTimeMs)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-[9px] text-slate-500">SESSION</div>
                <div className="mt-1 font-bold uppercase text-slate-200">
                  {event.isAiAssisted ? 'AI Test' : event.sessionMode.replace('_', ' ')}
                </div>
              </div>
            </div>
          </div>

          {/* Sector Breakdown */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-cyan-400" />
                Sector Splits
              </span>
              <span className="font-mono text-[10px] text-slate-500">Delta vs Best Sector</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {event.sectorTimesMs.map((sMs, idx) => {
                const name = event.sectorNames[idx] ?? `Sector ${idx + 1}`;
                const delta = report.sectorDeltasMs[idx] ?? null;
                const isBest = delta !== null && delta <= 0 && event.lapValid;
                return (
                  <div
                    key={idx}
                    className={`rounded-xl border p-3 font-mono ${
                      isBest
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-900/70'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>S{idx + 1}</span>
                      <span className="truncate pl-2 text-slate-300">{name}</span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="text-base font-black text-white">
                        {sMs > 0 ? `${(sMs / 1000).toFixed(3)}s` : '--.---'}
                      </span>
                      {delta !== null && (
                        <span
                          className={`text-[11px] font-bold ${
                            delta <= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatDelta(delta)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Plain-English Run Takeaway */}
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/8 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
              Engineering & Driving Takeaway
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-200">{takeaway}</p>
          </div>
        </div>

        {/* Footer Actions: Adjust → Retry Loop */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-[#080B11] px-5 py-3.5">
          <button
            type="button"
            onClick={onBackToGarage}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Garage</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onContinueRolling}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-400"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Keep Driving</span>
            </button>

            <button
              type="button"
              onClick={onAdjustCar}
              className="flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/15 px-3.5 py-2 text-xs font-bold text-amber-200 transition hover:bg-amber-500/25"
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>Adjust Car</span>
            </button>

            <button
              type="button"
              onClick={onRetryLap}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-950 shadow-[0_0_20px_rgba(0,240,255,0.28)] transition hover:bg-cyan-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Retry Lap</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
