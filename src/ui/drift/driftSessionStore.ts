/**
 * Local Drift Session Best Store (STRICTLY separate from Time Trial lap records).
 * Uses the exact `DriftScorer` contract types (`src/core/scoring/drift/DriftScorer.ts`).
 */

export type DriftPenaltyReason = 'off_track' | 'wall_brush' | 'wall_impact' | 'spinout' | 'reset';
export type DriftGrade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface IDriftZoneEnteredEvent {
  type: 'drift:zone_entered';
  vehicleId: string;
  tick: number;
  runNumber: number;
  zoneId: string;
  zoneName: string;
}

export interface IDriftTransitionEvent {
  type: 'drift:transition';
  vehicleId: string;
  tick: number;
  runNumber: number;
  chainCount: number;
  comboMultiplier: number;
  direction: -1 | 1;
  activeComboPoints: number;
}

export interface IDriftBankedEvent {
  type: 'drift:banked';
  vehicleId: string;
  tick: number;
  runNumber: number;
  rawPoints: number;
  multiplier: number;
  bankedDelta: number;
  totalScore: number;
  chainCount: number;
  durationS: number;
}

export interface IDriftPenaltyEvent {
  type: 'drift:penalty';
  vehicleId: string;
  tick: number;
  runNumber: number;
  reason: DriftPenaltyReason;
  pointsLost: number;
  multiplierReset: boolean;
}

export interface IDriftRunSummary {
  runNumber: number;
  trackId: string;
  trackVersion: string;
  geometryHash: string;
  vehicleId: string;
  totalScore: number;
  bestComboScore: number;
  maxChainCount: number;
  maxMultiplier: number;
  maxDriftAngleDeg: number;
  avgDriftAngleDeg: number;
  totalDriftDurationS: number;
  zoneCoveragePct: number;
  cleanRun: boolean;
  penaltiesCount: number;
  grade: DriftGrade;
  eligibleForLapRecords: false;
}

export interface IDriftRunFinishedEvent {
  type: 'drift:run_finished';
  summary: IDriftRunSummary;
}

export type DriftEvent =
  | IDriftZoneEnteredEvent
  | IDriftTransitionEvent
  | IDriftBankedEvent
  | IDriftPenaltyEvent
  | IDriftRunFinishedEvent;

export interface IDriftLiveState {
  vehicleId: string;
  runNumber: number;
  inDriftZone: boolean;
  activeZoneId: string | null;
  isDrifting: boolean;
  driftDirection: -1 | 0 | 1;
  driftAngleDeg: number;
  lineBonusMult: number;
  activeComboPoints: number;
  comboMultiplier: number;
  chainCount: number;
  bankedScore: number;
  projectedTotalScore: number;
  activeDriftDurationS: number;
  transitionGraceRemainingS: number;
  cleanRun: boolean;
}

export interface DriftFeedBadge {
  id: number;
  kind: 'zone' | 'transition' | 'banked' | 'penalty';
  label: string;
  detail?: string;
  createdAtMs: number;
}

export interface TrackDriftPersonalBest {
  partitionKey: string;
  bestScore: number;
  bestGrade: DriftGrade;
  bestComboScore: number;
  recentRuns: Array<{
    timestamp: string;
    buildName: string;
    totalScore: number;
    grade: DriftGrade;
    cleanRun: boolean;
    maxDriftAngleDeg: number;
    maxChainCount: number;
  }>;
}

const DRIFT_PBS_KEY = 'modulus_drift_bests_v1';
const GRADE_RANK: Record<DriftGrade, number> = { D: 0, C: 1, B: 2, A: 3, S: 4 };

export function makeDriftPartitionKey(
  trackId: string,
  trackVersion: string,
  balanceVersionId: string
): string {
  return `drift::${trackId}::${trackVersion}::${balanceVersionId}`;
}

function loadDriftPbs(): Record<string, TrackDriftPersonalBest> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DRIFT_PBS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, TrackDriftPersonalBest>) : {};
  } catch {
    return {};
  }
}

export function getTrackDriftBest(partitionKey: string): TrackDriftPersonalBest | null {
  const all = loadDriftPbs();
  return all[partitionKey] ?? null;
}

export function recordLocalDriftRun(
  summary: IDriftRunSummary,
  balanceVersionId: string,
  buildName: string
): {
  isNewBestScore: boolean;
  bestScore: number;
  deltaToBestScore: number | null;
  deltaToPrevScore: number | null;
} {
  const key = makeDriftPartitionKey(summary.trackId, summary.trackVersion, balanceVersionId);
  const all = loadDriftPbs();
  const prev = all[key];
  const prevBest = prev?.bestScore ?? null;
  const prevAttemptScore = prev?.recentRuns[0]?.totalScore ?? null;

  const isNewBestScore = prevBest === null || summary.totalScore > prevBest;
  const nextBestScore = prevBest === null ? summary.totalScore : Math.max(prevBest, summary.totalScore);
  const nextBestGrade =
    !prev || GRADE_RANK[summary.grade] > GRADE_RANK[prev.bestGrade]
      ? summary.grade
      : prev.bestGrade;
  const nextBestCombo = Math.max(prev?.bestComboScore ?? 0, summary.bestComboScore);

  const nextRecord: TrackDriftPersonalBest = {
    partitionKey: key,
    bestScore: nextBestScore,
    bestGrade: nextBestGrade,
    bestComboScore: nextBestCombo,
    recentRuns: [
      {
        timestamp: new Date().toISOString(),
        buildName,
        totalScore: summary.totalScore,
        grade: summary.grade,
        cleanRun: summary.cleanRun,
        maxDriftAngleDeg: summary.maxDriftAngleDeg,
        maxChainCount: summary.maxChainCount,
      },
      ...(prev?.recentRuns ?? []),
    ].slice(0, 12),
  };

  all[key] = nextRecord;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(DRIFT_PBS_KEY, JSON.stringify(all));
    } catch {
      // ignore storage errors
    }
  }

  return {
    isNewBestScore,
    bestScore: nextBestScore,
    deltaToBestScore: prevBest !== null ? summary.totalScore - prevBest : null,
    deltaToPrevScore: prevAttemptScore !== null ? summary.totalScore - prevAttemptScore : null,
  };
}

export function driftPenaltyLabel(reason: DriftPenaltyReason): string {
  if (reason === 'wall_brush') return 'WALL BRUSH (-25%)';
  if (reason === 'wall_impact') return 'WALL HIT — COMBO LOST';
  if (reason === 'off_track') return 'OFF-TRACK — COMBO LOST';
  if (reason === 'spinout') return 'SPINOUT — COMBO LOST';
  return 'RESET — COMBO LOST';
}
