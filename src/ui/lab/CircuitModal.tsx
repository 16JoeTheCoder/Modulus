import { useEffect, useState } from 'react';
import { Bot, Flag, Flame, MapPin, Play, Trophy, X } from 'lucide-react';
import { TRACKS_CATALOG } from '../../content';
import type { ModulusEngine } from '../../core/Engine';
import type { StorageSync } from '../../core/StorageSync';
import type { ILapLeaderboardEntry, ITrackSplineSchema } from '../../core/types';
import { TrackPreviewSvg } from './TrackPreviewSvg';

interface CircuitModalProps {
  open: boolean;
  onClose: () => void;
  engine: ModulusEngine;
  storage: StorageSync;
  activeTrackId: string;
  balanceVersionId: string;
  onSelectTrack: (trackId: string) => void;
  onLaunchDrive: (aiEnabled: boolean, modeOverride?: 'practice' | 'time_trial' | 'drift') => void;
}

export function formatLapTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const mins = Math.floor(clamped / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

export function CircuitModal({
  open,
  onClose,
  storage,
  activeTrackId,
  balanceVersionId,
  onSelectTrack,
  onLaunchDrive,
}: CircuitModalProps) {
  const [leaderboard, setLeaderboard] = useState<ILapLeaderboardEntry[]>([]);
  const [loadingLb, setLoadingLb] = useState(false);

  const activeTrack: ITrackSplineSchema =
    TRACKS_CATALOG.find((t) => t.id === activeTrackId) ?? TRACKS_CATALOG[0];

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoadingLb(true);
    void storage.fetchLeaderboard(activeTrack.id, balanceVersionId).then((entries) => {
      if (!mounted) return;
      setLeaderboard(entries);
      setLoadingLb(false);
    });
    return () => {
      mounted = false;
    };
  }, [open, activeTrack.id, balanceVersionId, storage]);

  if (!open) return null;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-[#0B0F17] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Flag className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100">
              Circuit Selector & Partitioned Leaderboard
            </h2>
            <span className="rounded bg-cyan-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
              {balanceVersionId}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            aria-label="Close circuit selector"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 md:grid-cols-[1.05fr_1fr]">
          {/* Left: Track Cards */}
          <div className="space-y-2.5">
            {TRACKS_CATALOG.map((track) => {
              const selected = track.id === activeTrack.id;
              const diffColor =
                track.difficulty === 'Pro'
                  ? 'text-rose-400 bg-rose-500/15 border-rose-500/30'
                  : track.difficulty === 'Technical'
                  ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
                  : 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30';
              return (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => onSelectTrack(track.id)}
                  className={`w-full rounded-xl border p-3.5 text-left transition ${
                    selected
                      ? 'border-cyan-400 bg-cyan-500/10 shadow-[0_0_20px_rgba(0,240,255,0.12)]'
                      : 'border-slate-800 bg-[#101622] hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <TrackPreviewSvg
                      track={track}
                      compact
                      showElevation={false}
                      className="shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-bold text-white">
                              {track.name}
                            </span>
                            {track.courseTags?.map((tag) => (
                              <span
                                key={tag}
                                className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                                  tag === 'drift'
                                    ? 'bg-fuchsia-500/20 text-fuchsia-300 ring-1 ring-fuchsia-500/40'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {tag.replace('_', ' ')}
                              </span>
                            ))}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                            <MapPin className="h-3 w-3 shrink-0 text-slate-500" />
                            <span className="truncate">{track.country}</span>
                            <span>•</span>
                            <span>
                              {track.ambientTempC}°C / {track.trackTempC}°C
                            </span>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${diffColor}`}
                        >
                          {track.difficulty}
                        </span>
                      </div>

                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-400">
                        {track.description}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-1.5 font-mono text-[10px]">
                    <div className="rounded bg-slate-900/90 px-2 py-1">
                      <div className="text-[9px] text-amber-300">GOLD</div>
                      <div className="text-slate-100">{formatLapTime(track.targetGoldTimeMs)}</div>
                    </div>
                    <div className="rounded bg-slate-900/90 px-2 py-1">
                      <div className="text-[9px] text-slate-300">SILVER</div>
                      <div className="text-slate-200">{formatLapTime(track.targetSilverTimeMs)}</div>
                    </div>
                    <div className="rounded bg-slate-900/90 px-2 py-1">
                      <div className="text-[9px] text-orange-400">BRONZE</div>
                      <div className="text-slate-300">{formatLapTime(track.targetBronzeTimeMs)}</div>
                    </div>
                    <div className="rounded bg-slate-900/90 px-2 py-1">
                      <div className="text-[9px] text-emerald-400">REWARD</div>
                      <div className="text-emerald-300">{track.baseLapRewardCredits} CR</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: Live Route Preview + Elevation Profile + Partitioned Leaderboard */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-[#0E131E] p-3.5">
            <TrackPreviewSvg track={activeTrack} showElevation showLegend />

            <div className="flex items-center justify-between border-t border-slate-800/80 pt-2.5">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  {activeTrack.name} — Top Laps
                </span>
              </div>
              <span className="font-mono text-[10px] text-slate-400">
                Partition: {balanceVersionId}
              </span>
            </div>

            {loadingLb ? (
              <div className="flex flex-1 items-center justify-center py-10 text-xs text-slate-400">
                Loading edge leaderboard...
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                <Trophy className="mb-2 h-6 w-6 text-slate-600" />
                <div className="text-xs font-semibold text-slate-300">No laps recorded yet</div>
                <div className="mt-1 max-w-xs text-[11px] text-slate-500">
                  Set the benchmark on {activeTrack.name} under balance config {balanceVersionId}.
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="py-1.5 pr-2">#</th>
                      <th className="py-1.5 pr-2">Driver</th>
                      <th className="py-1.5 pr-2">Time</th>
                      <th className="py-1.5 pr-2">Top</th>
                      <th className="py-1.5">P/W</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {leaderboard.map((row, idx) => (
                      <tr key={row.id} className="text-slate-200">
                        <td className="py-2 pr-2 font-bold text-slate-400">{idx + 1}</td>
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate max-w-[110px]">{row.emailMasked}</span>
                            {row.isAiAssisted && (
                              <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">
                                AI
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-2 font-semibold text-cyan-300">
                          {formatLapTime(row.lapTimeMs)}
                        </td>
                        <td className="py-2 pr-2 text-slate-400">
                          {Math.round(row.peakSpeedKph)}
                        </td>
                        <td className="py-2 text-slate-400">{row.pwrRatio.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer Launch Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-[#090C12] px-5 py-3">
          <div className="text-xs text-slate-400">
            Selected: <span className="font-semibold text-white">{activeTrack.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onLaunchDrive(false, 'drift');
              }}
              className="flex items-center gap-1.5 rounded-lg border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-2 text-xs font-bold uppercase tracking-wider text-fuchsia-200 transition hover:bg-fuchsia-500/25"
            >
              <Flame className="h-3.5 w-3.5" />
              Drift Session
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onLaunchDrive(true);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-300 transition hover:bg-amber-500/25"
            >
              <Bot className="h-3.5 w-3.5" />
              AI Test Benchmark
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onLaunchDrive(false);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-950 shadow-[0_0_20px_rgba(0,240,255,0.3)] transition hover:bg-cyan-300"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Drive on Track
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
