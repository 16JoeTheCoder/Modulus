import {
  CURRENT_PHYSICS_VERSION,
  CURRENT_RULESET_VERSION,
  DEFAULT_TRACK_VERSION,
  normalizeTrackVersion,
  type SessionMode,
  type VerificationLevel,
} from '../../src/contracts/simulation';
import type { ITrackSplineSchema } from '../../src/core/types';

/**
 * Generous upper bound for plausible average lap speed across the entire closed track (m/s).
 * 130 m/s = 468 km/h (~291 mph) — catches impossible forged times while allowing even
 * top-tier prototype builds on high-speed ovals.
 */
export const MAX_PLAUSIBLE_AVG_SPEED_MS = 130;
export const MAX_PLAUSIBLE_PEAK_SPEED_KPH = 560;
export const MAX_SECTOR_SUM_DRIFT_MS = 250;
export const MIN_SECTOR_TIME_MS = 500;
export const MIN_ABSOLUTE_LAP_TIME_MS = 5_000;
export const MAX_TELEMETRY_SUMMARY_BYTES = 16_384;

export interface ILapSanityInput {
  trackId: string;
  trackVersion?: string;
  physicsVersion?: string;
  rulesetVersion?: string;
  balanceVersionId: string;
  weatherKey?: string;
  assistPreset?: string;
  transmissionMode?: string;
  sessionMode?: SessionMode;
  lapTimeMs: number;
  sectorTimesMs: number[];
  peakSpeedKph: number;
  pwrRatio: number;
  isAiAssisted: boolean;
  checkpointMask?: number;
  orderedCheckpointsHit?: number[];
  telemetrySummary?: Record<string, unknown>;
}

export interface ILapSanityResult {
  ok: boolean;
  code?:
    | 'MODE_NOT_ELIGIBLE'
    | 'UNKNOWN_TRACK'
    | 'IMPLAUSIBLE_LAP_TIME'
    | 'INVALID_SECTORS'
    | 'INVALID_CHECKPOINTS'
    | 'IMPLAUSIBLE_SPEED'
    | 'PAYLOAD_TOO_LARGE';
  error?: string;
  /**
   * Server-assigned verification level.
   * `'verified'` is strictly unreachable until a trusted deterministic replay verifier runs.
   */
  verificationLevel: Exclude<VerificationLevel, 'verified'>;
  normalized: {
    trackVersion: string;
    physicsVersion: string;
    rulesetVersion: string;
    weatherKey: string;
    assistPreset: string;
    transmissionMode: string;
    sessionMode: 'time_trial';
    checkpointMask: number;
    trackLengthEstimateM: number;
    minAllowedLapTimeMs: number;
    submissionFingerprint: string;
  } | null;
}

/**
 * Computes a conservative lower-bound loop length (meters) directly from track
 * control-point chords (zero Three.js / Rapier runtime dependency).
 */
export function estimateTrackLengthMeters(track: ITrackSplineSchema): number {
  const pts = track.controlPoints;
  if (!pts || pts.length < 2) return 500;
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  if (track.closed && pts.length > 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    total += Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z);
  }
  return Math.max(250, Math.round(total * 10) / 10);
}

export function getTrackSchemaVersion(track: ITrackSplineSchema): string {
  const maybeVersion = (track as ITrackSplineSchema & { trackVersion?: string }).trackVersion;
  return normalizeTrackVersion(maybeVersion);
}

/**
 * Builds a deterministic fingerprint for duplicate-submission detection per user.
 */
export function computeSubmissionFingerprint(params: {
  trackId: string;
  trackVersion: string;
  balanceVersionId: string;
  physicsVersion: string;
  rulesetVersion: string;
  lapTimeMs: number;
  sectorTimesMs: readonly number[];
  checkpointMask: number;
}): string {
  const roundedSectors = params.sectorTimesMs.map((s) => Math.round(s)).join(',');
  return [
    params.trackId,
    params.trackVersion,
    params.balanceVersionId,
    params.physicsVersion,
    params.rulesetVersion,
    Math.round(params.lapTimeMs),
    roundedSectors,
    params.checkpointMask >>> 0,
  ].join('|');
}

/**
 * Evaluates a lap submission for official Time Trial record eligibility and sanity.
 * - Rejects Friend Race, AI Race, Practice, Drift, Royal Prix, and any AI-assisted run.
 * - Checks track existence, min lap time vs track length, sector sum consistency,
 *   checkpoint mask & ordering, peak speed plausibility, and payload size.
 * - Assigns `'sanity_checked'` when full contract metadata + checkpoints pass, or
 *   `'unverified'` for backwards-compatible legacy callers without checkpoint proofs.
 * - NEVER assigns `'verified'` (reserved exclusively for trusted replay recomputation).
 */
export function evaluateLapSubmissionSanity(
  input: ILapSanityInput,
  track: ITrackSplineSchema | undefined,
  activeBalanceVersionId: string
): ILapSanityResult {
  const sessionMode: SessionMode = input.sessionMode ?? 'time_trial';
  if (sessionMode !== 'time_trial' || input.isAiAssisted) {
    return {
      ok: false,
      code: 'MODE_NOT_ELIGIBLE',
      error: 'Only clean manual Time Trial laps are eligible for official records.',
      verificationLevel: 'unverified',
      normalized: null,
    };
  }

  if (!track) {
    return {
      ok: false,
      code: 'UNKNOWN_TRACK',
      error: `Unknown trackId: ${input.trackId}`,
      verificationLevel: 'unverified',
      normalized: null,
    };
  }

  const telemetryStr = JSON.stringify(input.telemetrySummary ?? {});
  if (telemetryStr.length > MAX_TELEMETRY_SUMMARY_BYTES) {
    return {
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      error: `Telemetry summary exceeds ${MAX_TELEMETRY_SUMMARY_BYTES} byte limit.`,
      verificationLevel: 'unverified',
      normalized: null,
    };
  }

  const trackLengthEstimateM = estimateTrackLengthMeters(track);
  const minAllowedLapTimeMs = Math.max(
    MIN_ABSOLUTE_LAP_TIME_MS,
    Math.floor((trackLengthEstimateM / MAX_PLAUSIBLE_AVG_SPEED_MS) * 1000)
  );

  if (!Number.isFinite(input.lapTimeMs) || input.lapTimeMs < minAllowedLapTimeMs) {
    return {
      ok: false,
      code: 'IMPLAUSIBLE_LAP_TIME',
      error: `Lap time ${Math.round(input.lapTimeMs)}ms is below minimum plausible time (${minAllowedLapTimeMs}ms) for ${track.id} (~${Math.round(trackLengthEstimateM)}m).`,
      verificationLevel: 'unverified',
      normalized: null,
    };
  }

  // Sector consistency check
  const sectors = input.sectorTimesMs;
  if (!Array.isArray(sectors) || sectors.length < 1 || sectors.length > 16) {
    return {
      ok: false,
      code: 'INVALID_SECTORS',
      error: 'At least one valid sector split is required.',
      verificationLevel: 'unverified',
      normalized: null,
    };
  }
  let sectorSum = 0;
  for (let i = 0; i < sectors.length; i++) {
    const s = sectors[i];
    if (!Number.isFinite(s) || s < MIN_SECTOR_TIME_MS) {
      return {
        ok: false,
        code: 'INVALID_SECTORS',
        error: `Sector ${i + 1} split (${s}ms) is invalid or below ${MIN_SECTOR_TIME_MS}ms.`,
        verificationLevel: 'unverified',
        normalized: null,
      };
    }
    sectorSum += s;
  }
  if (Math.abs(sectorSum - input.lapTimeMs) > MAX_SECTOR_SUM_DRIFT_MS) {
    return {
      ok: false,
      code: 'INVALID_SECTORS',
      error: `Sector sum (${Math.round(sectorSum)}ms) disagrees with lapTimeMs (${Math.round(input.lapTimeMs)}ms) by more than ${MAX_SECTOR_SUM_DRIFT_MS}ms.`,
      verificationLevel: 'unverified',
      normalized: null,
    };
  }

  // Peak speed plausibility vs implied average lap speed
  const avgSpeedKph = (trackLengthEstimateM / (input.lapTimeMs / 1000)) * 3.6;
  if (
    !Number.isFinite(input.peakSpeedKph) ||
    input.peakSpeedKph > MAX_PLAUSIBLE_PEAK_SPEED_KPH ||
    (input.peakSpeedKph > 0 && input.peakSpeedKph < avgSpeedKph * 0.9)
  ) {
    return {
      ok: false,
      code: 'IMPLAUSIBLE_SPEED',
      error: `Reported peakSpeedKph (${input.peakSpeedKph}) is inconsistent with track length and lap time (avg ${avgSpeedKph.toFixed(1)} km/h).`,
      verificationLevel: 'unverified',
      normalized: null,
    };
  }

  // Checkpoint mask & ordered checkpoints validation
  const requiredMask = (1 << sectors.length) - 1;
  let hasCheckpointProof = false;
  let checkpointMask = 0;

  if (typeof input.checkpointMask === 'number') {
    if (!Number.isInteger(input.checkpointMask) || input.checkpointMask < 0) {
      return {
        ok: false,
        code: 'INVALID_CHECKPOINTS',
        error: 'checkpointMask must be a non-negative integer.',
        verificationLevel: 'unverified',
        normalized: null,
      };
    }
    if ((input.checkpointMask & requiredMask) !== requiredMask) {
      return {
        ok: false,
        code: 'INVALID_CHECKPOINTS',
        error: `Incomplete checkpointMask (${input.checkpointMask}); required bits ${requiredMask}.`,
        verificationLevel: 'unverified',
        normalized: null,
      };
    }
    checkpointMask = input.checkpointMask >>> 0;
    hasCheckpointProof = true;
  }

  if (input.orderedCheckpointsHit !== undefined) {
    const hits = input.orderedCheckpointsHit;
    if (hits.length < sectors.length) {
      return {
        ok: false,
        code: 'INVALID_CHECKPOINTS',
        error: `orderedCheckpointsHit length (${hits.length}) is shorter than sector count (${sectors.length}).`,
        verificationLevel: 'unverified',
        normalized: null,
      };
    }
    for (let i = 1; i < hits.length; i++) {
      if (!Number.isInteger(hits[i]) || hits[i] <= hits[i - 1]) {
        return {
          ok: false,
          code: 'INVALID_CHECKPOINTS',
          error: 'orderedCheckpointsHit must be strictly increasing.',
          verificationLevel: 'unverified',
          normalized: null,
        };
      }
    }
  }

  const trackVersion = normalizeTrackVersion(input.trackVersion ?? getTrackSchemaVersion(track) ?? DEFAULT_TRACK_VERSION);
  const physicsVersion = (input.physicsVersion?.trim() || CURRENT_PHYSICS_VERSION).slice(0, 40);
  const rulesetVersion = (input.rulesetVersion?.trim() || CURRENT_RULESET_VERSION).slice(0, 40);
  const weatherKey = (input.weatherKey?.trim() || 'clear_dry').slice(0, 40);
  const assistPreset = (input.assistPreset?.trim() || 'beginner').slice(0, 32);
  const transmissionMode = (input.transmissionMode?.trim() || 'auto').slice(0, 16);

  const submissionFingerprint = computeSubmissionFingerprint({
    trackId: input.trackId,
    trackVersion,
    balanceVersionId: activeBalanceVersionId,
    physicsVersion,
    rulesetVersion,
    lapTimeMs: input.lapTimeMs,
    sectorTimesMs: sectors,
    checkpointMask,
  });

  // Never returns 'verified' — reserved for future trusted deterministic replay verification.
  const verificationLevel: Exclude<VerificationLevel, 'verified'> = hasCheckpointProof
    ? 'sanity_checked'
    : 'unverified';

  return {
    ok: true,
    verificationLevel,
    normalized: {
      trackVersion,
      physicsVersion,
      rulesetVersion,
      weatherKey,
      assistPreset,
      transmissionMode,
      sessionMode: 'time_trial',
      checkpointMask,
      trackLengthEstimateM,
      minAllowedLapTimeMs,
      submissionFingerprint,
    },
  };
}
