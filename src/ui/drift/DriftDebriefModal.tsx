import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Flame,
  Play,
  RotateCcw,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { ITrackSplineSchema } from '../../core/types';
import type { IDriftRunSummary } from './driftSessionStore';

export interface IDriftDebriefReport {
  summary: IDriftRunSummary;
  track: ITrackSplineSchema;
  buildName: string;
  isNewBestScore: boolean;
  bestScore: number;
  deltaToBestScore: number | null;
  deltaToPrevScore: number | null;
}

export interface IDriftDebriefModalProps {
  report: IDriftDebriefReport | null;
  onRetryRun: () => void;
  onKeepDrifting: () => void;
  onAdjustCar: () => void;
  onBackToGarage: () => void;
}

function buildDriftCoaching(summary: IDriftRunSummary): string {
  if (!summary.cleanRun && summary.penaltiesCount > 0) {
    return `Lost combo points from ${summary.penaltiesCount} penalty event(s). Modulate throttle near outer walls and tap Space briefly to initiate without over-rotating past 70°.`;
  }
  if (summary.maxChainCount <= 1) {
    return 'Link left-to-right transitions within 1.4s to climb the chain multiplier up to ×4.0 — try the Playful Slide preset in Beginner Lab for easier transitions.';
  }
  if (summary.zoneCoveragePct < 55) {
    return `Held drift through ${summary.zoneCoveragePct.toFixed(0)}% of the judged zone. Commit earlier on entry and carry a steady outer line for the line bonus multiplier.`;
  }
  if (summary.grade === 'S' || summary.grade === 'A') {
    return `Strong ${summary.grade}-grade run (${summary.maxChainCount}× chain, ${summary.maxDriftAngleDeg.toFixed(0)}° peak angle)! Try shortening Final Drive in the Lab for harder exit wheelspin.`;
  }
  return 'Clean drift run! Link more transitions and hold wider outer arcs inside the drift zone to push for A and S grade.';
}

export function DriftDebriefModal({
  report,
  onRetryRun,
  onKeepDrifting,
  onAdjustCar,
  onBackToGarage,
}: IDriftDebriefModalProps) {
  if (!report) return null;
  const { summary, track, buildName, isNewBestScore, bestScore, deltaToPrevScore } = report;

  const gradeColor =
    summary.grade === 'S'
      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
      : summary.grade === 'A'
      ? 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-200'
      : summary.grade === 'B'
      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
      : 'border-slate-600 bg-slate-800/80 text-slate-200';

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm select-none">
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-fuchsia-500/50 bg-[#0B0F17]/96 shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-[#080B11] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            {summary.cleanRun ? (
              <CheckCircle2 className="h-5 w-5 text-fuchsia-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            )}
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white">
                <Flame className="h-3.5 w-3.5 text-fuchsia-400" />
                <span>Drift Run #{summary.runNumber} Complete</span>
                {isNewBestScore && summary.totalScore > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia-400/60 bg-fuchsia-500/20 px-2 py-0.5 font-mono text-[9px] text-fuchsia-200">
                    <Sparkles className="h-2.5 w-2.5" />
                    NEW DRIFT PB
                  </span>
                )}
              </div>
              <div className="font-mono text-[10px] text-slate-400">
                {track.name} ({summary.trackVersion}) · {buildName}
              </div>
            </div>
          </div>

          <span className="rounded bg-fuchsia-500/15 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-fuchsia-200 ring-1 ring-fuchsia-500/40">
            Drift Scoring · Separate from Lap Records
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Score & Grade Hero */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.35fr_1fr]">
            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Total Drift Score
                </div>
                <div className="mt-1 font-mono text-3xl font-black tracking-tight text-white">
                  {summary.totalScore.toLocaleString()}{' '}
                  <span className="text-sm font-semibold text-fuchsia-300">PTS</span>
                </div>
                {deltaToPrevScore !== null && (
                  <div className="mt-1 font-mono text-[11px] text-slate-400">
                    vs Previous Run:{' '}
                    <span
                      className={
                        deltaToPrevScore >= 0
                          ? 'font-bold text-emerald-400'
                          : 'font-bold text-rose-400'
                      }
                    >
                      {deltaToPrevScore >= 0 ? '+' : ''}
                      {deltaToPrevScore.toLocaleString()} pts
                    </span>
                  </div>
                )}
              </div>

              <div
                className={`flex h-16 w-16 flex-col items-center justify-center rounded-2xl border-2 font-mono ${gradeColor}`}
              >
                <span className="text-[9px] uppercase opacity-75">GRADE</span>
                <span className="text-2xl font-black leading-none">{summary.grade}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-[9px] text-slate-500">DRIFT BEST</div>
                <div className="mt-1 font-bold text-fuchsia-300">
                  {bestScore.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-[9px] text-slate-500">BEST COMBO</div>
                <div className="mt-1 font-bold text-amber-300">
                  {summary.bestComboScore.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-[9px] text-slate-500">MAX CHAIN / MULT</div>
                <div className="mt-1 font-bold text-white">
                  {summary.maxChainCount}× · ×{summary.maxMultiplier.toFixed(1)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-[9px] text-slate-500">CLEAN / PENALTIES</div>
                <div
                  className={`mt-1 font-bold ${
                    summary.cleanRun ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {summary.cleanRun ? 'CLEAN' : `${summary.penaltiesCount} PEN`}
                </div>
              </div>
            </div>
          </div>

          {/* Technique Metrics Strip */}
          <div className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
              <div className="text-[9px] text-slate-500">PEAK ANGLE</div>
              <div className="mt-0.5 text-sm font-black text-white">
                {summary.maxDriftAngleDeg.toFixed(1)}°
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
              <div className="text-[9px] text-slate-500">AVG ANGLE</div>
              <div className="mt-0.5 text-sm font-black text-cyan-300">
                {summary.avgDriftAngleDeg.toFixed(1)}°
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
              <div className="text-[9px] text-slate-500">SLIDE TIME</div>
              <div className="mt-0.5 text-sm font-black text-slate-200">
                {summary.totalDriftDurationS.toFixed(1)}s
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
              <div className="text-[9px] text-slate-500">ZONE COVERAGE</div>
              <div className="mt-0.5 text-sm font-black text-fuchsia-300">
                {summary.zoneCoveragePct.toFixed(0)}%
              </div>
            </div>
          </div>

          {/* Coaching & Setup Takeaway */}
          <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/8 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">
              Drift & Setup Takeaway
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-200">
              {buildDriftCoaching(summary)}
            </p>
          </div>
        </div>

        {/* Footer Actions */}
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
              onClick={onKeepDrifting}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-fuchsia-400"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Keep Drifting</span>
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
              onClick={onRetryRun}
              className="flex items-center gap-1.5 rounded-lg bg-fuchsia-400 px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-950 shadow-[0_0_20px_rgba(217,70,239,0.3)] transition hover:bg-fuchsia-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Retry Drift Run</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
