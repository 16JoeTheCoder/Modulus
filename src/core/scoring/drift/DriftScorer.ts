import type {
  ITrackCollisionHandle,
  IVehicleStateSnapshot,
} from '../../../contracts/simulation';
import { isProgressInSpan, type TrackSpline } from '../../math/spline';

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
  /** Drift sessions are always scored separately from Time Trial lap records. */
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

export interface IDriftStepResult {
  state: IDriftLiveState;
  events: DriftEvent[];
}

export interface IDriftSessionSummary {
  trackId: string;
  trackVersion: string;
  geometryHash: string;
  vehicleId: string;
  runs: IDriftRunSummary[];
  bestRunScore: number;
  totalSessionScore: number;
  bestGrade: DriftGrade;
  eligibleForLapRecords: false;
}

export interface IDriftScorerOptions {
  /** Minimum forward speed (m/s) to score an active slide (default 6.0 m/s ≈ 13.4 mph). */
  minSpeedMs?: number;
  /** Minimum chassis slip angle in radians to enter active drift (default 0.14 rad ≈ 8°). */
  minAngleRad?: number;
  /** Slip angle in radians above which the car is considered spinning out (default 1.28 rad ≈ 73°). */
  spinoutAngleRad?: number;
  /** Grace window (s) to link a left-right direction transition without dropping the combo (default 1.45 s). */
  transitionGraceS?: number;
  /** Base points per second at unit angle × speed × line factor (default 180). */
  basePointsPerSec?: number;
  /** Maximum combo multiplier (default 4.0). */
  maxMultiplier?: number;
}

interface InternalDriftVehicle {
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
  bestComboScore: number;
  maxChainCount: number;
  maxMultiplier: number;
  maxDriftAngleDeg: number;
  angleDegAccum: number;
  driftingTicks: number;
  zoneTicks: number;
  activeDriftDurationS: number;
  totalDriftDurationS: number;
  transitionGraceRemainingS: number;
  offTrackTicks: number;
  offTrackPenaltyApplied: boolean;
  lastImpactSeqSeen: number;
  cleanRun: boolean;
  penaltiesCount: number;
  completedRuns: IDriftRunSummary[];
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function scoreToGrade(score: number, cleanRun: boolean): DriftGrade {
  if (score >= 22000 && cleanRun) return 'S';
  if (score >= 15000) return 'A';
  if (score >= 9000) return 'B';
  if (score >= 4000) return 'C';
  return 'D';
}

const GRADE_RANK: Record<DriftGrade, number> = { D: 0, C: 1, B: 2, A: 3, S: 4 };

/**
 * Deterministic 120 Hz drift session scorer (zero Three.js / Rapier / wall-clock imports).
 *
 * Consumes existing `IVehicleStateSnapshot` fields (`tick`, `position`, `speedMs`,
 * `forwardSpeedMs`, `bodySlipAngleRad`, `splineProgress`, `lastImpact`, `wheels[*].grounded`)
 * against `ITrackCollisionHandle` drift zones and `TrackSpline` geometry.
 * Drift scores and run summaries are strictly isolated from Time Trial lap records.
 */
export class DriftScorer {
  public readonly collision: ITrackCollisionHandle;
  public readonly spline: TrackSpline;

  private readonly driftZones;
  private readonly minSpeedMs: number;
  private readonly minAngleRad: number;
  private readonly spinoutAngleRad: number;
  private readonly transitionGraceS: number;
  private readonly basePointsPerSec: number;
  private readonly maxMultiplier: number;
  private readonly vehicles = new Map<string, InternalDriftVehicle>();

  constructor(
    collision: ITrackCollisionHandle,
    spline: TrackSpline,
    options: IDriftScorerOptions = {}
  ) {
    this.collision = collision;
    this.spline = spline;
    this.driftZones = collision.zones.filter((z) => z.kind === 'drift');
    this.minSpeedMs = options.minSpeedMs ?? 6.0;
    this.minAngleRad = options.minAngleRad ?? 0.14;
    this.spinoutAngleRad = options.spinoutAngleRad ?? 1.28;
    this.transitionGraceS = options.transitionGraceS ?? 1.45;
    this.basePointsPerSec = options.basePointsPerSec ?? 180;
    this.maxMultiplier = options.maxMultiplier ?? 4.0;
  }

  public resetRun(
    vehicleId: string,
    opts?: { tick?: number; runNumber?: number; preserveSessionHistory?: boolean }
  ): IDriftPenaltyEvent | null {
    const existing = this.vehicles.get(vehicleId);
    let penaltyEvent: IDriftPenaltyEvent | null = null;
    if (existing && existing.activeComboPoints > 0) {
      penaltyEvent = {
        type: 'drift:penalty',
        vehicleId,
        tick: opts?.tick ?? 0,
        runNumber: existing.runNumber,
        reason: 'reset',
        pointsLost: Math.round(existing.activeComboPoints * existing.comboMultiplier),
        multiplierReset: true,
      };
    }

    const completedRuns =
      opts?.preserveSessionHistory !== false && existing ? existing.completedRuns.slice() : [];
    const runNumber = opts?.runNumber ?? (completedRuns.length + 1);

    this.vehicles.set(vehicleId, this.createFreshVehicle(vehicleId, runNumber, completedRuns));
    return penaltyEvent;
  }

  /**
   * Finalizes the current judged drift run (e.g. upon crossing S/F or completing the drift span),
   * banks any remaining live combo, records the `IDriftRunSummary`, and prepares the next run.
   */
  public finishRun(vehicleId: string, tick: number): IDriftStepResult {
    const v = this.getOrCreate(vehicleId);
    const events: DriftEvent[] = [];

    if (v.activeComboPoints > 0) {
      this.bankCombo(v, tick, events);
    }

    const avgAngleDeg = v.driftingTicks > 0 ? v.angleDegAccum / v.driftingTicks : 0;
    const zoneCoveragePct = v.zoneTicks > 0 ? clamp((v.driftingTicks / v.zoneTicks) * 100, 0, 100) : 0;
    const totalScore = Math.round(v.bankedScore);
    const summary: IDriftRunSummary = {
      runNumber: v.runNumber,
      trackId: this.collision.trackId,
      trackVersion: this.collision.trackVersion,
      geometryHash: this.collision.geometryHash,
      vehicleId: v.vehicleId,
      totalScore,
      bestComboScore: Math.round(v.bestComboScore),
      maxChainCount: v.maxChainCount,
      maxMultiplier: Number(v.maxMultiplier.toFixed(2)),
      maxDriftAngleDeg: Number(v.maxDriftAngleDeg.toFixed(1)),
      avgDriftAngleDeg: Number(avgAngleDeg.toFixed(1)),
      totalDriftDurationS: Number(v.totalDriftDurationS.toFixed(2)),
      zoneCoveragePct: Number(zoneCoveragePct.toFixed(1)),
      cleanRun: v.cleanRun,
      penaltiesCount: v.penaltiesCount,
      grade: scoreToGrade(totalScore, v.cleanRun),
      eligibleForLapRecords: false,
    };

    v.completedRuns.push(summary);
    events.push({ type: 'drift:run_finished', summary });

    const next = this.createFreshVehicle(vehicleId, v.runNumber + 1, v.completedRuns);
    next.lastImpactSeqSeen = v.lastImpactSeqSeen;
    this.vehicles.set(vehicleId, next);

    return { state: this.toLiveState(next), events };
  }

  public getSessionSummary(vehicleId: string): IDriftSessionSummary {
    const v = this.vehicles.get(vehicleId);
    const runs = v ? v.completedRuns.slice() : [];
    let bestRunScore = 0;
    let totalSessionScore = 0;
    let bestGrade: DriftGrade = 'D';
    for (const r of runs) {
      totalSessionScore += r.totalScore;
      if (r.totalScore > bestRunScore) bestRunScore = r.totalScore;
      if (GRADE_RANK[r.grade] > GRADE_RANK[bestGrade]) bestGrade = r.grade;
    }
    return {
      trackId: this.collision.trackId,
      trackVersion: this.collision.trackVersion,
      geometryHash: this.collision.geometryHash,
      vehicleId,
      runs,
      bestRunScore,
      totalSessionScore,
      bestGrade,
      eligibleForLapRecords: false,
    };
  }

  public getLiveState(vehicleId: string): IDriftLiveState | null {
    const v = this.vehicles.get(vehicleId);
    return v ? this.toLiveState(v) : null;
  }

  public stepVehicle(snapshot: IVehicleStateSnapshot, dt: number): IDriftStepResult {
    const v = this.getOrCreate(snapshot.vehicleId);
    const events: DriftEvent[] = [];

    const closest = this.spline.findClosestSample(snapshot.position, snapshot.splineProgress);
    const sample = closest.sample;
    const halfW = sample.widthM * 0.5;
    const absLat = Math.abs(closest.lateralOffsetM);

    // 1. Check whether vehicle is inside a judged drift zone (if track defines none, entire loop is scorable)
    let matchedZoneId: string | null = null;
    let matchedZoneName = 'Track Drift';
    if (this.driftZones.length === 0) {
      matchedZoneId = 'full_course';
      matchedZoneName = this.spline.schema.name;
    } else {
      for (let i = 0; i < this.driftZones.length; i++) {
        const dz = this.driftZones[i];
        if (isProgressInSpan(sample.t, dz.startT, dz.endT)) {
          matchedZoneId = dz.id;
          matchedZoneName = dz.name;
          break;
        }
      }
    }

    const inZone = matchedZoneId !== null;
    if (inZone && (!v.inDriftZone || v.activeZoneId !== matchedZoneId)) {
      events.push({
        type: 'drift:zone_entered',
        vehicleId: v.vehicleId,
        tick: snapshot.tick,
        runNumber: v.runNumber,
        zoneId: matchedZoneId!,
        zoneName: matchedZoneName,
      });
    } else if (!inZone && v.inDriftZone && v.activeComboPoints > 0) {
      // Clean exit out of judged zone banks the active combo immediately
      this.bankCombo(v, snapshot.tick, events);
    }

    v.inDriftZone = inZone;
    v.activeZoneId = matchedZoneId;
    if (inZone) {
      v.zoneTicks += 1;
    }

    // 2. Wall impact / brush penalty via monotonic `lastImpact.seq`
    if (snapshot.lastImpact && snapshot.lastImpact.seq > v.lastImpactSeqSeen) {
      v.lastImpactSeqSeen = snapshot.lastImpact.seq;
      const intensity = snapshot.lastImpact.intensity01;
      if (intensity >= 0.35) {
        const lost = Math.round(v.activeComboPoints * v.comboMultiplier);
        v.activeComboPoints = 0;
        v.comboMultiplier = 1.0;
        v.chainCount = 0;
        v.activeDriftDurationS = 0;
        v.transitionGraceRemainingS = 0;
        v.isDrifting = false;
        v.driftDirection = 0;
        v.cleanRun = false;
        v.penaltiesCount += 1;
        events.push({
          type: 'drift:penalty',
          vehicleId: v.vehicleId,
          tick: snapshot.tick,
          runNumber: v.runNumber,
          reason: 'wall_impact',
          pointsLost: lost,
          multiplierReset: true,
        });
      } else if (intensity >= 0.12 && v.activeComboPoints > 0) {
        const penaltyRaw = v.activeComboPoints * 0.25;
        v.activeComboPoints = Math.max(0, v.activeComboPoints - penaltyRaw);
        v.penaltiesCount += 1;
        events.push({
          type: 'drift:penalty',
          vehicleId: v.vehicleId,
          tick: snapshot.tick,
          runNumber: v.runNumber,
          reason: 'wall_brush',
          pointsLost: Math.round(penaltyRaw * v.comboMultiplier),
          multiplierReset: false,
        });
      }
    }

    // 3. Off-track penalty while inside drift zone
    if (inZone && absLat > halfW + 1.5) {
      v.offTrackTicks += 1;
      if (v.offTrackTicks === 24 && v.activeComboPoints > 0 && !v.offTrackPenaltyApplied) {
        v.offTrackPenaltyApplied = true;
        const lostRaw = v.activeComboPoints * 0.4;
        v.activeComboPoints = Math.max(0, v.activeComboPoints - lostRaw);
        v.cleanRun = false;
        v.penaltiesCount += 1;
        events.push({
          type: 'drift:penalty',
          vehicleId: v.vehicleId,
          tick: snapshot.tick,
          runNumber: v.runNumber,
          reason: 'off_track',
          pointsLost: Math.round(lostRaw * v.comboMultiplier),
          multiplierReset: false,
        });
      } else if (v.offTrackTicks >= 72 && v.activeComboPoints > 0) {
        const lost = Math.round(v.activeComboPoints * v.comboMultiplier);
        v.activeComboPoints = 0;
        v.comboMultiplier = 1.0;
        v.chainCount = 0;
        v.activeDriftDurationS = 0;
        v.transitionGraceRemainingS = 0;
        v.isDrifting = false;
        v.driftDirection = 0;
        v.cleanRun = false;
        v.penaltiesCount += 1;
        events.push({
          type: 'drift:penalty',
          vehicleId: v.vehicleId,
          tick: snapshot.tick,
          runNumber: v.runNumber,
          reason: 'off_track',
          pointsLost: lost,
          multiplierReset: true,
        });
      }
    } else {
      v.offTrackTicks = 0;
      v.offTrackPenaltyApplied = false;
    }

    // 4. Evaluate slip angle, speed, grounding & spinout
    const absSlip = Math.abs(snapshot.bodySlipAngleRad);
    const slipDeg = (absSlip * 180) / Math.PI;
    v.driftAngleDeg = slipDeg;

    let groundedCount = 0;
    for (let i = 0; i < 4; i++) {
      if (snapshot.wheels[i].grounded) groundedCount++;
    }

    const isSpinout =
      absSlip > this.spinoutAngleRad ||
      (v.activeComboPoints > 0 && snapshot.forwardSpeedMs < -1.0);

    if (isSpinout && v.activeComboPoints > 0) {
      const lost = Math.round(v.activeComboPoints * v.comboMultiplier);
      v.activeComboPoints = 0;
      v.comboMultiplier = 1.0;
      v.chainCount = 0;
      v.activeDriftDurationS = 0;
      v.transitionGraceRemainingS = 0;
      v.isDrifting = false;
      v.driftDirection = 0;
      v.cleanRun = false;
      v.penaltiesCount += 1;
      events.push({
        type: 'drift:penalty',
        vehicleId: v.vehicleId,
        tick: snapshot.tick,
        runNumber: v.runNumber,
        reason: 'spinout',
        pointsLost: lost,
        multiplierReset: true,
      });
      return { state: this.toLiveState(v), events };
    }

    const activeSlide =
      inZone &&
      !isSpinout &&
      groundedCount >= 2 &&
      snapshot.forwardSpeedMs >= this.minSpeedMs &&
      absSlip >= this.minAngleRad;

    if (activeSlide) {
      const dir: -1 | 1 = snapshot.bodySlipAngleRad >= 0 ? 1 : -1;

      // Detect linked direction transition within grace window
      if (v.driftDirection !== 0 && dir !== v.driftDirection && v.activeComboPoints >= 40) {
        v.chainCount += 1;
        v.comboMultiplier = clamp(1.0 + v.chainCount * 0.5, 1.0, this.maxMultiplier);
        if (v.chainCount > v.maxChainCount) v.maxChainCount = v.chainCount;
        if (v.comboMultiplier > v.maxMultiplier) v.maxMultiplier = v.comboMultiplier;
        events.push({
          type: 'drift:transition',
          vehicleId: v.vehicleId,
          tick: snapshot.tick,
          runNumber: v.runNumber,
          chainCount: v.chainCount,
          comboMultiplier: v.comboMultiplier,
          direction: dir,
          activeComboPoints: Math.round(v.activeComboPoints),
        });
      } else if (v.driftDirection === 0) {
        v.chainCount = Math.max(1, v.chainCount);
        if (v.chainCount > v.maxChainCount) v.maxChainCount = v.chainCount;
      }

      v.isDrifting = true;
      v.driftDirection = dir;
      v.transitionGraceRemainingS = this.transitionGraceS;

      // Angle factor: smooth bell rising from 8° to peak around 30°-50°, gently tapering before 72°
      const angleFactor =
        slipDeg <= 45
          ? clamp((slipDeg - 7) / 28, 0.2, 1.45)
          : clamp(1.45 - ((slipDeg - 45) / 30) * 0.65, 0.6, 1.45);

      // Speed factor: rewards carrying real pace through the slide
      const speedFactor = clamp((snapshot.speedMs - 4.0) / 18.0, 0.25, 2.2);

      // Line factor: rewards riding the judged outer clipping arc on curved sections while staying on road
      let lineFactor = 1.0;
      if (absLat > halfW) {
        lineFactor = 0.55;
      } else if (sample.curvature >= 0.008) {
        // Outer edge is opposite to turn sign (+signedCurvature = right turn -> outer edge is left = negative lateralOffsetM)
        const outerSign = sample.signedCurvature >= 0 ? -1 : 1;
        const outerProximity = clamp((closest.lateralOffsetM * outerSign) / Math.max(2, halfW), 0, 1);
        lineFactor = 1.0 + outerProximity * 0.35;
      }
      v.lineBonusMult = lineFactor;

      const deltaPoints = this.basePointsPerSec * angleFactor * speedFactor * lineFactor * dt;
      v.activeComboPoints += deltaPoints;
      v.activeDriftDurationS += dt;
      v.totalDriftDurationS += dt;
      v.driftingTicks += 1;
      v.angleDegAccum += slipDeg;
      if (slipDeg > v.maxDriftAngleDeg) v.maxDriftAngleDeg = slipDeg;
    } else {
      v.isDrifting = false;
      v.lineBonusMult = 1.0;
      if (v.activeComboPoints > 0) {
        v.transitionGraceRemainingS = Math.max(0, v.transitionGraceRemainingS - dt);
        if (v.transitionGraceRemainingS <= 0 || snapshot.forwardSpeedMs < this.minSpeedMs * 0.65) {
          this.bankCombo(v, snapshot.tick, events);
        }
      }
    }

    return { state: this.toLiveState(v), events };
  }

  private bankCombo(v: InternalDriftVehicle, tick: number, events: DriftEvent[]): void {
    const raw = v.activeComboPoints;
    const mult = v.comboMultiplier;
    const delta = raw * mult;
    v.bankedScore += delta;
    if (delta > v.bestComboScore) v.bestComboScore = delta;

    events.push({
      type: 'drift:banked',
      vehicleId: v.vehicleId,
      tick,
      runNumber: v.runNumber,
      rawPoints: Math.round(raw),
      multiplier: Number(mult.toFixed(2)),
      bankedDelta: Math.round(delta),
      totalScore: Math.round(v.bankedScore),
      chainCount: v.chainCount,
      durationS: Number(v.activeDriftDurationS.toFixed(2)),
    });

    v.activeComboPoints = 0;
    v.comboMultiplier = 1.0;
    v.chainCount = 0;
    v.activeDriftDurationS = 0;
    v.transitionGraceRemainingS = 0;
    v.driftDirection = 0;
    v.isDrifting = false;
  }

  private getOrCreate(vehicleId: string): InternalDriftVehicle {
    let v = this.vehicles.get(vehicleId);
    if (!v) {
      v = this.createFreshVehicle(vehicleId, 1, []);
      this.vehicles.set(vehicleId, v);
    }
    return v;
  }

  private createFreshVehicle(
    vehicleId: string,
    runNumber: number,
    completedRuns: IDriftRunSummary[]
  ): InternalDriftVehicle {
    return {
      vehicleId,
      runNumber,
      inDriftZone: false,
      activeZoneId: null,
      isDrifting: false,
      driftDirection: 0,
      driftAngleDeg: 0,
      lineBonusMult: 1.0,
      activeComboPoints: 0,
      comboMultiplier: 1.0,
      chainCount: 0,
      bankedScore: 0,
      bestComboScore: 0,
      maxChainCount: 0,
      maxMultiplier: 1.0,
      maxDriftAngleDeg: 0,
      angleDegAccum: 0,
      driftingTicks: 0,
      zoneTicks: 0,
      activeDriftDurationS: 0,
      totalDriftDurationS: 0,
      transitionGraceRemainingS: 0,
      offTrackTicks: 0,
      offTrackPenaltyApplied: false,
      lastImpactSeqSeen: 0,
      cleanRun: true,
      penaltiesCount: 0,
      completedRuns,
    };
  }

  private toLiveState(v: InternalDriftVehicle): IDriftLiveState {
    return {
      vehicleId: v.vehicleId,
      runNumber: v.runNumber,
      inDriftZone: v.inDriftZone,
      activeZoneId: v.activeZoneId,
      isDrifting: v.isDrifting,
      driftDirection: v.driftDirection,
      driftAngleDeg: Number(v.driftAngleDeg.toFixed(1)),
      lineBonusMult: Number(v.lineBonusMult.toFixed(2)),
      activeComboPoints: Math.round(v.activeComboPoints),
      comboMultiplier: Number(v.comboMultiplier.toFixed(2)),
      chainCount: v.chainCount,
      bankedScore: Math.round(v.bankedScore),
      projectedTotalScore: Math.round(v.bankedScore + v.activeComboPoints * v.comboMultiplier),
      activeDriftDurationS: Number(v.activeDriftDurationS.toFixed(2)),
      transitionGraceRemainingS: Number(v.transitionGraceRemainingS.toFixed(2)),
      cleanRun: v.cleanRun,
    };
  }
}
