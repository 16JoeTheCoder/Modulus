import {
  CURRENT_PHYSICS_VERSION,
  CURRENT_RULESET_VERSION,
  type ILapFinishedEvent,
  type ILapInvalidatedEvent,
  type IRulesetVersionKey,
  type ISectorSplitEvent,
  type ITrackCollisionHandle,
  type ITrackTimingGate,
  type ITrackVersionMeta,
  type LapInvalidationReason,
  type SessionMode,
  type StartTimingMode,
  type Vec3,
  type VerificationLevel,
} from '../../contracts/simulation';
import type { TrackSpline } from '../math/spline';

export interface ILapSectorTimerOptions {
  startTimingMode?: StartTimingMode;
  sessionMode?: SessionMode;
  ruleset?: Partial<IRulesetVersionKey>;
  offTrackMarginM?: number;
  offTrackGraceTicks?: number;
  wrongWayGraceTicks?: number;
  verificationLevel?: VerificationLevel;
}

export interface ITimingVehicleStepInput {
  tick: number;
  dt: number;
  vehicleId: string;
  position: Vec3;
  speedMs: number;
  forwardSpeedMs: number;
  throttle: number;
  buildId: string;
  buildSchemaVersion: number;
  buildContentHash?: string;
  chassisId: string;
  pwrRatio: number;
  isAiAssisted: boolean;
}

export interface IVehicleTimingState {
  vehicleId: string;
  lapNumber: number;
  sectorIndex: number;
  sectorCount: number;
  splineProgress: number;
  lapArmed: boolean;
  currentLapTimeMs: number;
  lastLapTimeMs: number | null;
  bestLapTimeMs: number | null;
  lapDeltaMs: number;
  sectorTimesMs: number[];
  bestSectorTimesMs: Array<number | null>;
  peakSpeedMs: number;
  peakSpeedKph: number;
  offTrackTicks: number;
  lapValid: boolean;
  invalidReasons: LapInvalidationReason[];
  checkpointMask: number;
  orderedCheckpointsHit: number[];
}

export interface ITimingStepResult {
  state: IVehicleTimingState;
  sectorSplits: ISectorSplitEvent[];
  lapFinished: ILapFinishedEvent | null;
  lapInvalidated: ILapInvalidatedEvent[];
}

interface InternalVehicleTiming extends IVehicleTimingState {
  prevPosition: Vec3 | null;
  sectorStartTimeMs: number;
  sectorValid: boolean;
  wrongWayTicks: number;
  crossedIntermediateSinceReset: boolean;
  invalidReasonSet: Set<LapInvalidationReason>;
  gatesCrossedThisLap: Set<number>;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Deterministic 120 Hz gate-crossing lap & sector timer.
 * Pure TypeScript (zero Three.js / Rapier / wall-clock dependencies).
 *
 * - Supports standing starts (`standing_on_launch` arms on first launch movement so
 *   the clock stays 0:00.000 while parked at `startGrid[0]`, and Lap 1 covers 100% of the loop).
 * - Uses 3D ordered gate-plane intersection (`timingGates`) with sub-tick linear interpolation
 *   for consistent sector splits, anti-cut checkpoint masks, and lap completion.
 * - Multi-vehicle ready (tracks independent state per `vehicleId`).
 */
export class LapSectorTimer {
  public readonly collision: ITrackCollisionHandle;
  public readonly spline: TrackSpline;
  public readonly trackMeta: ITrackVersionMeta;

  private startTimingMode: StartTimingMode;
  private sessionMode: SessionMode;
  private ruleset: IRulesetVersionKey;
  private offTrackMarginM: number;
  private offTrackGraceTicks: number;
  private wrongWayGraceTicks: number;
  private verificationLevel: VerificationLevel;
  private requiredGateMask: number;
  private vehicles = new Map<string, InternalVehicleTiming>();

  constructor(
    collision: ITrackCollisionHandle,
    spline: TrackSpline,
    options: ILapSectorTimerOptions = {}
  ) {
    this.collision = collision;
    this.spline = spline;
    this.trackMeta = {
      trackId: collision.trackId,
      trackVersion: collision.trackVersion,
      geometryHash: collision.geometryHash,
    };

    this.startTimingMode = options.startTimingMode ?? 'standing_on_launch';
    this.sessionMode = options.sessionMode ?? 'practice';
    this.ruleset = {
      physicsVersion: options.ruleset?.physicsVersion ?? CURRENT_PHYSICS_VERSION,
      rulesetVersion: options.ruleset?.rulesetVersion ?? CURRENT_RULESET_VERSION,
      balanceVersionId: options.ruleset?.balanceVersionId ?? 'v1.0.0',
      weatherKey: options.ruleset?.weatherKey ?? 'dry',
      assistPreset: options.ruleset?.assistPreset ?? 'beginner',
      transmissionMode: options.ruleset?.transmissionMode ?? 'auto',
    };
    this.offTrackMarginM = options.offTrackMarginM ?? 2.5;
    this.offTrackGraceTicks = options.offTrackGraceTicks ?? 120;
    this.wrongWayGraceTicks = options.wrongWayGraceTicks ?? 240;
    this.verificationLevel = options.verificationLevel ?? 'local';

    // All intermediate gates (1..K-1) must be hit in order for a valid lap
    let mask = 0;
    for (let i = 1; i < collision.timingGates.length; i++) {
      mask |= 1 << collision.timingGates[i].gateIndex;
    }
    this.requiredGateMask = mask;
  }

  public setSessionMode(mode: SessionMode): void {
    this.sessionMode = mode;
  }

  public setStartTimingMode(mode: StartTimingMode): void {
    this.startTimingMode = mode;
  }

  public setRuleset(partial: Partial<IRulesetVersionKey>): void {
    this.ruleset = { ...this.ruleset, ...partial };
  }

  /**
   * Arms all registered vehicles simultaneously (for `countdown_go` starts).
   */
  public armAll(): void {
    for (const v of this.vehicles.values()) {
      v.lapArmed = true;
    }
  }

  public getVehicleState(vehicleId: string): IVehicleTimingState | null {
    const v = this.vehicles.get(vehicleId);
    return v ? this.toPublicState(v) : null;
  }

  /**
   * Resets a vehicle's lap/sector state to its starting grid slot.
   * If the vehicle was mid-lap and `emitInvalidationIfArmed` is true, returns
   * an `ILapInvalidatedEvent` with reason `'reset'` so ghost recorders never splice runs.
   */
  public resetVehicle(
    vehicleId: string,
    opts?: {
      tick?: number;
      slotIndex?: number;
      position?: Vec3;
      splineProgress?: number;
      preserveBestLap?: boolean;
      emitInvalidationIfArmed?: boolean;
    }
  ): ILapInvalidatedEvent | null {
    const existing = this.vehicles.get(vehicleId);
    let invalidEvent: ILapInvalidatedEvent | null = null;
    if (
      existing &&
      opts?.emitInvalidationIfArmed !== false &&
      existing.lapArmed &&
      existing.currentLapTimeMs > 0
    ) {
      invalidEvent = {
        vehicleId,
        tick: opts?.tick ?? 0,
        lapNumber: existing.lapNumber,
        sectorIndex: existing.sectorIndex,
        reason: 'reset',
      };
    }

    const slotIdx = opts?.slotIndex ?? 0;
    const gridSlot = this.collision.startGrid[slotIdx] ?? this.collision.startGrid[0];
    const startPos = opts?.position ?? gridSlot?.position ?? { x: 0, y: 0, z: 0 };
    const startProgress = opts?.splineProgress ?? gridSlot?.splineProgress ?? 0;
    const sectorCount = Math.max(1, this.collision.sectors.length);
    const preserveBest = opts?.preserveBestLap !== false;

    const fresh: InternalVehicleTiming = {
      vehicleId,
      lapNumber: 1,
      sectorIndex: 0,
      sectorCount,
      splineProgress: startProgress,
      lapArmed: false,
      currentLapTimeMs: 0,
      lastLapTimeMs: preserveBest ? (existing?.lastLapTimeMs ?? null) : null,
      bestLapTimeMs: preserveBest ? (existing?.bestLapTimeMs ?? null) : null,
      lapDeltaMs: 0,
      sectorTimesMs: new Array<number>(sectorCount).fill(0),
      bestSectorTimesMs: preserveBest
        ? (existing?.bestSectorTimesMs.slice() ?? new Array<number | null>(sectorCount).fill(null))
        : new Array<number | null>(sectorCount).fill(null),
      peakSpeedMs: 0,
      peakSpeedKph: 0,
      offTrackTicks: 0,
      lapValid: true,
      invalidReasons: [],
      checkpointMask: 0,
      orderedCheckpointsHit: [],
      prevPosition: { ...startPos },
      sectorStartTimeMs: 0,
      sectorValid: true,
      wrongWayTicks: 0,
      crossedIntermediateSinceReset: false,
      invalidReasonSet: new Set<LapInvalidationReason>(),
      gatesCrossedThisLap: new Set<number>(),
    };

    this.vehicles.set(vehicleId, fresh);
    return invalidEvent;
  }

  public stepVehicle(input: ITimingVehicleStepInput): ITimingStepResult {
    let v = this.vehicles.get(input.vehicleId);
    if (!v) {
      this.resetVehicle(input.vehicleId, {
        tick: input.tick,
        position: input.position,
        emitInvalidationIfArmed: false,
      });
      v = this.vehicles.get(input.vehicleId)!;
    }

    const sectorSplits: ISectorSplitEvent[] = [];
    const lapInvalidated: ILapInvalidatedEvent[] = [];
    let lapFinished: ILapFinishedEvent | null = null;

    const prevPos = v.prevPosition ?? input.position;
    const currPos = input.position;

    // 1. Closest spline sample for progress, off-track, and wrong-way checks
    const closest = this.spline.findClosestSample(currPos, v.splineProgress);
    v.splineProgress = closest.sample.t;

    // 2. Standing-start arming (clock stays 0:00.000 until launch or line cross)
    if (!v.lapArmed && this.startTimingMode === 'standing_on_launch') {
      if (input.forwardSpeedMs > 0.35 || input.speedMs > 0.5 || input.throttle > 0.05) {
        v.lapArmed = true;
      }
    }

    const prevLapTimeMs = v.currentLapTimeMs;
    const stepMs = input.dt * 1000;
    if (v.lapArmed) {
      v.currentLapTimeMs += stepMs;
    }

    if (input.speedMs > v.peakSpeedMs) {
      v.peakSpeedMs = input.speedMs;
      v.peakSpeedKph = input.speedMs * 3.6;
    }

    // 3. Off-track & wrong-way validation (only while armed)
    const addInvalidation = (reason: LapInvalidationReason) => {
      v!.lapValid = false;
      v!.sectorValid = false;
      if (!v!.invalidReasonSet.has(reason)) {
        v!.invalidReasonSet.add(reason);
        v!.invalidReasons.push(reason);
        lapInvalidated.push({
          vehicleId: input.vehicleId,
          tick: input.tick,
          lapNumber: v!.lapNumber,
          sectorIndex: v!.sectorIndex,
          reason,
        });
      }
    };

    if (v.lapArmed) {
      const halfWidth = closest.sample.widthM * 0.5;
      if (Math.abs(closest.lateralOffsetM) > halfWidth + this.offTrackMarginM) {
        v.offTrackTicks += 1;
        if (v.offTrackTicks > this.offTrackGraceTicks) {
          addInvalidation('off_track');
        }
      } else {
        v.offTrackTicks = 0;
      }

      const move = sub(currPos, prevPos);
      const forwardAlongSpline = dot(move, closest.sample.tangent);
      if (forwardAlongSpline < -0.025 && input.speedMs > 2.0) {
        v.wrongWayTicks += 1;
        if (v.wrongWayTicks > this.wrongWayGraceTicks) {
          addInvalidation('wrong_way');
        }
      } else {
        v.wrongWayTicks = 0;
      }
    }

    // 4. Deterministic 3D gate-plane crossing checks
    const gates = this.collision.timingGates;
    for (let i = 0; i < gates.length; i++) {
      const gate = gates[i];
      const crossFrac = this.testGateForwardCrossing(gate, prevPos, currPos);
      if (crossFrac === null) continue;

      const crossingLapTimeMs = v.lapArmed ? prevLapTimeMs + stepMs * crossFrac : 0;

      if (gate.kind === 'start_finish') {
        if (!v.lapArmed) {
          if (this.startTimingMode === 'crossing_start_line') {
            v.lapArmed = true;
            v.currentLapTimeMs = stepMs * (1 - crossFrac);
            v.sectorStartTimeMs = 0;
            v.checkpointMask = 1 << gate.gateIndex;
            v.orderedCheckpointsHit = [gate.gateIndex];
          }
          continue;
        }

        // Ignore the initial launch crossing right after leaving startGrid[0] (-2.5 m behind S/F)
        if (!v.crossedIntermediateSinceReset) {
          v.checkpointMask |= 1 << gate.gateIndex;
          if (!v.gatesCrossedThisLap.has(gate.gateIndex)) {
            v.gatesCrossedThisLap.add(gate.gateIndex);
            v.orderedCheckpointsHit.push(gate.gateIndex);
          }
          continue;
        }

        // Verify all required ordered intermediate checkpoints were hit
        if ((v.checkpointMask & this.requiredGateMask) !== this.requiredGateMask) {
          addInvalidation('missed_checkpoint');
        }

        const finishedLapTimeMs = Math.max(1, crossingLapTimeMs);
        const finalSecIdx = v.sectorCount - 1;
        const finalSecSplit = Math.max(0, finishedLapTimeMs - v.sectorStartTimeMs);
        v.sectorTimesMs[finalSecIdx] = finalSecSplit;

        const prevBestFinalSec = v.bestSectorTimesMs[finalSecIdx];
        const finalSecDelta = prevBestFinalSec !== null ? finalSecSplit - prevBestFinalSec : null;
        const isBestFinalSec =
          v.sectorValid && (prevBestFinalSec === null || finalSecSplit < prevBestFinalSec);
        if (isBestFinalSec) {
          v.bestSectorTimesMs[finalSecIdx] = finalSecSplit;
        }

        sectorSplits.push({
          vehicleId: input.vehicleId,
          tick: input.tick,
          sessionMode: this.sessionMode,
          trackId: this.trackMeta.trackId,
          trackVersion: this.trackMeta.trackVersion,
          rulesetVersion: this.ruleset.rulesetVersion,
          lapNumber: v.lapNumber,
          sectorIndex: finalSecIdx,
          sectorCount: v.sectorCount,
          sectorName:
            gate.sectorName ??
            this.collision.sectors[finalSecIdx]?.name ??
            `Sector ${finalSecIdx + 1}`,
          splitTimeMs: finalSecSplit,
          cumulativeLapTimeMs: finishedLapTimeMs,
          deltaToBestSectorMs: finalSecDelta,
          isBestSector: isBestFinalSec,
          sectorValid: v.sectorValid,
          checkpointMask: v.checkpointMask,
        });

        const prevBestLap = v.bestLapTimeMs;
        const deltaToBestLapMs = prevBestLap !== null ? finishedLapTimeMs - prevBestLap : null;
        const isPersonalBest =
          v.lapValid &&
          !input.isAiAssisted &&
          (prevBestLap === null || finishedLapTimeMs < prevBestLap);

        v.lastLapTimeMs = finishedLapTimeMs;
        v.lapDeltaMs = deltaToBestLapMs ?? 0;
        if (v.lapValid && (prevBestLap === null || finishedLapTimeMs < prevBestLap)) {
          v.bestLapTimeMs = finishedLapTimeMs;
        }

        lapFinished = {
          vehicleId: input.vehicleId,
          tick: input.tick,
          sessionMode: this.sessionMode,
          trackId: this.trackMeta.trackId,
          trackVersion: this.trackMeta.trackVersion,
          geometryHash: this.trackMeta.geometryHash,
          physicsVersion: this.ruleset.physicsVersion,
          rulesetVersion: this.ruleset.rulesetVersion,
          balanceVersionId: this.ruleset.balanceVersionId,
          buildId: input.buildId,
          buildSchemaVersion: input.buildSchemaVersion,
          buildContentHash: input.buildContentHash,
          chassisId: input.chassisId,
          pwrRatio: input.pwrRatio,
          lapNumber: v.lapNumber,
          lapTimeMs: finishedLapTimeMs,
          sectorTimesMs: v.sectorTimesMs.slice(),
          sectorNames: this.collision.sectors.map((s) => s.name),
          deltaToBestLapMs,
          isPersonalBest,
          lapValid: v.lapValid,
          invalidReasons: v.invalidReasons.slice(),
          checkpointMask: v.checkpointMask,
          orderedCheckpointsHit: v.orderedCheckpointsHit.slice(),
          peakSpeedMs: v.peakSpeedMs,
          peakSpeedKph: Math.round(v.peakSpeedKph * 10) / 10,
          isAiAssisted: input.isAiAssisted,
          verificationLevel: this.verificationLevel,
        };

        // Roll into next lap carrying exact sub-tick remainder past the line
        v.lapNumber += 1;
        v.sectorIndex = 0;
        v.currentLapTimeMs = Math.max(0, stepMs * (1 - crossFrac));
        v.sectorStartTimeMs = 0;
        v.sectorTimesMs = new Array<number>(v.sectorCount).fill(0);
        v.peakSpeedMs = input.speedMs;
        v.peakSpeedKph = input.speedMs * 3.6;
        v.lapValid = true;
        v.sectorValid = true;
        v.offTrackTicks = 0;
        v.wrongWayTicks = 0;
        v.invalidReasons = [];
        v.invalidReasonSet.clear();
        v.gatesCrossedThisLap.clear();
        v.gatesCrossedThisLap.add(gate.gateIndex);
        v.checkpointMask = 1 << gate.gateIndex;
        v.orderedCheckpointsHit = [gate.gateIndex];
        v.crossedIntermediateSinceReset = false;
      } else {
        if (!v.lapArmed) continue;
        if (v.gatesCrossedThisLap.has(gate.gateIndex)) continue;

        v.gatesCrossedThisLap.add(gate.gateIndex);
        v.checkpointMask |= 1 << gate.gateIndex;
        v.orderedCheckpointsHit.push(gate.gateIndex);
        v.crossedIntermediateSinceReset = true;

        if (gate.kind === 'sector' && gate.sectorIndex !== undefined) {
          const secIdx = gate.sectorIndex;
          const splitTimeMs = Math.max(0, crossingLapTimeMs - v.sectorStartTimeMs);
          v.sectorTimesMs[secIdx] = splitTimeMs;

          const prevBestSec = v.bestSectorTimesMs[secIdx];
          const deltaToBestSectorMs = prevBestSec !== null ? splitTimeMs - prevBestSec : null;
          const isBestSector =
            v.sectorValid && (prevBestSec === null || splitTimeMs < prevBestSec);
          if (isBestSector) {
            v.bestSectorTimesMs[secIdx] = splitTimeMs;
          }

          sectorSplits.push({
            vehicleId: input.vehicleId,
            tick: input.tick,
            sessionMode: this.sessionMode,
            trackId: this.trackMeta.trackId,
            trackVersion: this.trackMeta.trackVersion,
            rulesetVersion: this.ruleset.rulesetVersion,
            lapNumber: v.lapNumber,
            sectorIndex: secIdx,
            sectorCount: v.sectorCount,
            sectorName:
              gate.sectorName ?? this.collision.sectors[secIdx]?.name ?? `Sector ${secIdx + 1}`,
            splitTimeMs,
            cumulativeLapTimeMs: crossingLapTimeMs,
            deltaToBestSectorMs,
            isBestSector,
            sectorValid: v.sectorValid,
            checkpointMask: v.checkpointMask,
          });

          v.sectorIndex = Math.min(v.sectorCount - 1, secIdx + 1);
          v.sectorStartTimeMs = crossingLapTimeMs;
          v.sectorValid = true;
        }
      }
    }

    v.prevPosition = { ...currPos };

    return {
      state: this.toPublicState(v),
      sectorSplits,
      lapFinished,
      lapInvalidated,
    };
  }

  /**
   * Tests whether the segment `prevPos -> currPos` crosses `gate` in the forward (+tangent) direction
   * within the gate's lateral width and vertical clearance. Returns crossing fraction [0..1] or null.
   */
  private testGateForwardCrossing(
    gate: ITrackTimingGate,
    prevPos: Vec3,
    currPos: Vec3
  ): number | null {
    const relPrev = sub(prevPos, gate.center);
    const relCurr = sub(currPos, gate.center);
    const dPrev = dot(relPrev, gate.tangent);
    const dCurr = dot(relCurr, gate.tangent);

    // Must cross from strictly behind (< 0) to on/ahead (>= 0), or <= 0 to > 0
    if (!(dPrev < 0 && dCurr >= 0) && !(dPrev <= 0 && dCurr > 0)) {
      return null;
    }

    const denom = dCurr - dPrev;
    const frac = denom > 1e-7 ? clamp(-dPrev / denom, 0, 1) : 1;
    const crossRel: Vec3 = {
      x: relPrev.x + (relCurr.x - relPrev.x) * frac,
      y: relPrev.y + (relCurr.y - relPrev.y) * frac,
      z: relPrev.z + (relCurr.z - relPrev.z) * frac,
    };

    const lateralOffset = Math.abs(dot(crossRel, gate.right));
    if (lateralOffset > gate.halfWidthM + 2.0) {
      return null;
    }

    const verticalOffset = Math.abs(dot(crossRel, gate.normal));
    if (verticalOffset > 6.5) {
      return null;
    }

    return frac;
  }

  private toPublicState(v: InternalVehicleTiming): IVehicleTimingState {
    return {
      vehicleId: v.vehicleId,
      lapNumber: v.lapNumber,
      sectorIndex: v.sectorIndex,
      sectorCount: v.sectorCount,
      splineProgress: v.splineProgress,
      lapArmed: v.lapArmed,
      currentLapTimeMs: v.currentLapTimeMs,
      lastLapTimeMs: v.lastLapTimeMs,
      bestLapTimeMs: v.bestLapTimeMs,
      lapDeltaMs: v.lapDeltaMs,
      sectorTimesMs: v.sectorTimesMs.slice(),
      bestSectorTimesMs: v.bestSectorTimesMs.slice(),
      peakSpeedMs: v.peakSpeedMs,
      peakSpeedKph: v.peakSpeedKph,
      offTrackTicks: v.offTrackTicks,
      lapValid: v.lapValid,
      invalidReasons: v.invalidReasons.slice(),
      checkpointMask: v.checkpointMask,
      orderedCheckpointsHit: v.orderedCheckpointsHit.slice(),
    };
  }
}
