import { AlertTriangle, CheckCircle2, Flag, Flame, Zap } from 'lucide-react';
import type { DriftFeedBadge, IDriftLiveState } from './driftSessionStore';

export interface IDriftHudProps {
  liveState: IDriftLiveState;
  activeZoneName: string | null;
  bestDriftScore: number | null;
  feedBadges: DriftFeedBadge[];
  onFinishRun: () => void;
}

function gradeForScore(score: number, clean: boolean): string {
  if (score >= 22000 && clean) return 'S';
  if (score >= 15000) return 'A';
  if (score >= 9000) return 'B';
  if (score >= 4000) return 'C';
  return 'D';
}

export function DriftHud({
  liveState,
  activeZoneName,
  bestDriftScore,
  feedBadges,
  onFinishRun,
}: IDriftHudProps) {
  const liveComboTotal = Math.round(liveState.activeComboPoints * liveState.comboMultiplier);
  const angleClamped = Math.min(75, Math.max(0, liveState.driftAngleDeg));
  const angleBarPct = Math.min(100, (angleClamped / 65) * 100);
  const gracePct = Math.max(0, Math.min(100, (liveState.transitionGraceRemainingS / 1.45) * 100));
  const currentGrade = gradeForScore(liveState.projectedTotalScore, liveState.cleanRun);

  const angleTone =
    angleClamped >= 58
      ? 'bg-rose-500 text-rose-300'
      : angleClamped >= 18
      ? 'bg-fuchsia-400 text-fuchsia-300'
      : 'bg-cyan-400 text-cyan-300';

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-20 flex flex-col items-center gap-2 px-3 select-none">
      {/* Main Top-Center Drift Scoreboard & Live Angle/Chain Cluster */}
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-fuchsia-500/40 bg-[#0A0C12]/88 px-4 py-2.5 shadow-[0_0_28px_rgba(217,70,239,0.18)] backdrop-blur-md">
        {/* Banked Score + Projected Grade */}
        <div className="flex items-center gap-2.5 border-r border-slate-800 pr-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-fuchsia-400/50 bg-fuchsia-500/15 font-mono text-lg font-black text-fuchsia-200">
            {currentGrade}
          </div>
          <div>
            <div className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-wider text-fuchsia-300">
              <Flame className="h-3 w-3" />
              <span>DRIFT RUN #{liveState.runNumber}</span>
              {!liveState.cleanRun && (
                <span className="rounded bg-rose-500/25 px-1 text-[8px] text-rose-300">
                  PENALTY
                </span>
              )}
            </div>
            <div className="font-mono text-xl font-black leading-none text-white">
              {Math.round(liveState.bankedScore).toLocaleString()}{' '}
              <span className="text-[10px] font-semibold text-slate-400">PTS</span>
            </div>
            {bestDriftScore !== null && (
              <div className="mt-0.5 font-mono text-[9px] text-slate-400">
                BEST: <span className="text-fuchsia-200">{bestDriftScore.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Live Combo + Chain Multiplier */}
        <div className="min-w-[140px]">
          <div className="flex items-baseline justify-between font-mono">
            <span className="text-[10px] font-bold uppercase text-slate-400">
              {liveState.isDrifting
                ? liveState.driftDirection > 0
                  ? 'LEFT SLIDE'
                  : 'RIGHT SLIDE'
                : liveState.transitionGraceRemainingS > 0
                ? 'LINK TRANSITION'
                : liveState.inDriftZone
                ? 'IN DRIFT ZONE'
                : 'APPROACHING ZONE'}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-black ${
                liveState.comboMultiplier > 1.01
                  ? 'bg-amber-500/25 text-amber-300'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              ×{liveState.comboMultiplier.toFixed(1)}
            </span>
          </div>

          <div className="mt-0.5 flex items-baseline justify-between font-mono">
            <span
              className={`text-base font-black ${
                liveComboTotal > 0 ? 'text-amber-300' : 'text-slate-500'
              }`}
            >
              +{liveComboTotal.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400">
              {liveState.chainCount > 0 ? `${liveState.chainCount}× CHAIN` : 'NO CHAIN'}
            </span>
          </div>

          {/* Transition Grace Timer Bar */}
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-[width] duration-75 ${
                liveState.isDrifting ? 'bg-fuchsia-400' : 'bg-amber-400'
              }`}
              style={{
                width: `${liveState.isDrifting ? 100 : gracePct}%`,
              }}
            />
          </div>
        </div>

        {/* Live Drift Angle Meter */}
        <div className="min-w-[104px] border-l border-slate-800 pl-3 font-mono">
          <div className="flex items-center justify-between text-[9px] text-slate-400">
            <span>ANGLE</span>
            <span className="text-slate-300">
              LINE ×{liveState.lineBonusMult.toFixed(2)}
            </span>
          </div>
          <div className={`mt-0.5 text-lg font-black leading-none ${angleTone.split(' ')[1]}`}>
            {angleClamped.toFixed(0)}°
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-[width] duration-75 ${angleTone.split(' ')[0]}`}
              style={{ width: `${angleBarPct}%` }}
            />
          </div>
        </div>

        {/* Finish Run CTA */}
        <button
          type="button"
          onClick={onFinishRun}
          className="flex items-center gap-1 rounded-lg border border-fuchsia-400/50 bg-fuchsia-500/15 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-fuchsia-200 transition hover:bg-fuchsia-500/30"
          title="Bank combo and open Drift Debrief"
        >
          <Flag className="h-3 w-3" />
          <span>Finish Run</span>
        </button>
      </div>

      {/* Active Zone Indicator + Event Feed (Transitions, Banked Combos, Penalties) */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {liveState.inDriftZone && activeZoneName && (
          <div className="flex items-center gap-1 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/15 px-2.5 py-0.5 font-mono text-[10px] font-bold text-fuchsia-200 backdrop-blur-md">
            <Zap className="h-3 w-3" />
            <span>ZONE: {activeZoneName}</span>
          </div>
        )}

        {feedBadges.map((b) => {
          const style =
            b.kind === 'penalty'
              ? 'border-rose-500/60 bg-rose-500/20 text-rose-200'
              : b.kind === 'banked'
              ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200'
              : b.kind === 'transition'
              ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
              : 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200';
          return (
            <div
              key={b.id}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-0.5 font-mono text-[10px] font-bold backdrop-blur-md ${style}`}
            >
              {b.kind === 'penalty' ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
              <span>{b.label}</span>
              {b.detail && <span className="opacity-85">{b.detail}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
