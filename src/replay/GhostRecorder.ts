import {
  FIXED_SIM_DT,
  FIXED_SIM_HZ,
  type ICarBuildVersionMeta,
  type IFixedStepInputFrame,
  type ILapFinishedEvent,
  type ILapInvalidatedEvent,
  type IQuantizedInputFrame,
  type IRulesetVersionKey,
  type ISimulationCheckpoint,
  type ITrackVersionMeta,
  type IVehicleStateSnapshot,
  type SessionMode,
} from '../contracts/simulation';
import {
  packQuantizedInputs,
  quantizeInputFrame,
  vehicleSnapshotToGhostPose,
} from './quantize';
import {
  DEFAULT_GHOST_SAMPLE_STRIDE_TICKS,
  MAX_REPLAY_PAYLOAD_BYTES,
  REPLAY_FORMAT_VERSION,
  type IGhostPoseSample,
  type IReplayIntegrityResult,
  type ITimeTrialReplayBundle,
} from './types';

export interface IGhostRecorderStartConfig {
  sessionMode: SessionMode;
  driverDisplayName: string;
  track: ITrackVersionMeta;
  ruleset: IRulesetVersionKey;
  buildMeta: ICarBuildVersionMeta;
  startCheckpoint: ISimulationCheckpoint;
  poseSampleStrideTicks?: number;
}

/**
 * Deterministic Time Trial Ghost & Input Recorder.
 *
 * Rules enforced from MODULUS_REBUILD_PLAN.md:
 * - Only completed, clean, manual Time Trial runs produce shareable PB/ghost bundles.
 * - AI Race, Friend Race, Drift, and Practice runs are never recorded as official ghosts.
 * - A manual reset, track update, or lap invalidation strictly aborts the active buffer
 *   so two runs can never be spliced into a single replay.
 * - Records both 120 Hz quantized input frames (for trusted deterministic verification)
 *   and periodic 20 Hz pose samples (for smooth zero-collision visual ghost playback).
 */
export class GhostRecorder {
  private active = false;
  private contaminated = false;
  private config: IGhostRecorderStartConfig | null = null;
  private strideTicks: number = DEFAULT_GHOST_SAMPLE_STRIDE_TICKS;
  private startTick: number | null = null;
  private lastTick = -1;
  private inputBuffer: IQuantizedInputFrame[] = [];
  private poseBuffer: IGhostPoseSample[] = [];
  private lastSnapshot: IVehicleStateSnapshot | null = null;

  public isRecording(): boolean {
    return this.active && !this.contaminated;
  }

  public getRecordedTickCount(): number {
    return this.inputBuffer.length;
  }

  public getRecordedPoseCount(): number {
    return this.poseBuffer.length;
  }

  /**
   * Starts a fresh clean recording session for a Time Trial run.
   * Non-Time-Trial modes are cleanly ignored without throwing.
   */
  public beginRun(config: IGhostRecorderStartConfig): boolean {
    this.abortRun('new_run_started');
    if (config.sessionMode !== 'time_trial') {
      return false;
    }

    this.config = config;
    this.strideTicks = Math.max(1, Math.floor(config.poseSampleStrideTicks ?? DEFAULT_GHOST_SAMPLE_STRIDE_TICKS));
    this.active = true;
    this.contaminated = false;
    this.startTick = null;
    this.lastTick = -1;
    this.inputBuffer = [];
    this.poseBuffer = [];
    this.lastSnapshot = null;
    return true;
  }

  /**
   * Immediately discards the active recording (called on vehicle reset, track change,
   * mode switch, or build edit so two runs can never be spliced).
   */
  public abortRun(_reason?: string): void {
    this.active = false;
    this.contaminated = true;
    this.startTick = null;
    this.lastTick = -1;
    this.inputBuffer = [];
    this.poseBuffer = [];
    this.lastSnapshot = null;
  }

  public onLapInvalidated(event: ILapInvalidatedEvent): void {
    if (!this.active || !this.config) return;
    const primaryVehicle = this.config.startCheckpoint.vehicles[0]?.vehicleId;
    if (primaryVehicle && event.vehicleId !== primaryVehicle) return;
    this.contaminated = true;
  }

  /**
   * Captures a single fixed-step tick (120 Hz) of quantized input + periodic pose sample.
   */
  public recordFixedStep(frame: IFixedStepInputFrame, snapshot: IVehicleStateSnapshot): void {
    if (!this.active || this.contaminated || !this.config) return;

    // Reject AI or remote inputs from Time Trial ghost capture
    if (frame.controllerKind !== 'local' || frame.inputSource === 'ai' || frame.inputSource === 'remote') {
      this.contaminated = true;
      return;
    }

    if (!snapshot.lapValid) {
      this.contaminated = true;
      return;
    }

    // Do not start capturing until standing-start lap timer is armed
    if (!snapshot.lapArmed) {
      return;
    }

    // Enforce strictly monotonic fixed ticks (no spliced or duplicated ticks)
    if (this.lastTick >= 0 && frame.tick !== this.lastTick + 1) {
      this.contaminated = true;
      return;
    }

    if (this.startTick === null) {
      this.startTick = frame.tick;
    }
    this.lastTick = frame.tick;
    this.lastSnapshot = snapshot;

    this.inputBuffer.push(quantizeInputFrame(frame));

    const relativeTick = frame.tick - this.startTick;
    if (relativeTick === 0 || relativeTick % this.strideTicks === 0) {
      this.poseBuffer.push(vehicleSnapshotToGhostPose(snapshot));
    }
  }

  /**
   * Finalizes a clean manual Time Trial lap into an immutable replay bundle, then
   * resets buffers cleanly for the next lap (never splicing Lap N into Lap N+1).
   */
  public finalizeLap(
    event: ILapFinishedEvent,
    nextLapCheckpoint?: ISimulationCheckpoint
  ): ITimeTrialReplayBundle | null {
    const config = this.config;
    const wasClean =
      this.active &&
      !this.contaminated &&
      config !== null &&
      event.sessionMode === 'time_trial' &&
      event.lapValid &&
      !event.isAiAssisted &&
      event.trackId === config.track.trackId &&
      event.trackVersion === config.track.trackVersion &&
      this.startTick !== null &&
      this.inputBuffer.length > 0 &&
      this.poseBuffer.length > 0;

    let bundle: ITimeTrialReplayBundle | null = null;

    if (wasClean && config && this.startTick !== null) {
      // Ensure the exact finish pose sample is appended for clean end-of-lap interpolation
      if (this.lastSnapshot) {
        const finalPose = vehicleSnapshotToGhostPose(this.lastSnapshot);
        finalPose.simTimeMs = event.lapTimeMs;
        const prevPose = this.poseBuffer[this.poseBuffer.length - 1];
        if (!prevPose || prevPose.tick !== finalPose.tick) {
          this.poseBuffer.push(finalPose);
        } else {
          this.poseBuffer[this.poseBuffer.length - 1] = finalPose;
        }
      }

      const replayId = generateReplayId();
      bundle = {
        header: {
          formatVersion: REPLAY_FORMAT_VERSION,
          replayId,
          sessionMode: 'time_trial',
          track: { ...config.track },
          ruleset: { ...config.ruleset },
          buildMeta: { ...config.buildMeta },
          driverDisplayName: config.driverDisplayName,
          recordedAtIso: new Date().toISOString(),
          lapNumber: event.lapNumber,
          startTick: this.startTick,
          endTick: this.lastTick,
          lapTimeMs: event.lapTimeMs,
          sectorTimesMs: [...event.sectorTimesMs],
          sectorNames: [...event.sectorNames],
          checkpointMask: event.checkpointMask,
          orderedCheckpointsHit: [...event.orderedCheckpointsHit],
          peakSpeedMs: event.peakSpeedMs,
          verificationLevel: 'local',
          startCheckpoint: config.startCheckpoint,
        },
        packedInputs: packQuantizedInputs(this.inputBuffer),
        poseSamples: this.poseBuffer.map((p) => ({
          ...p,
          position: { ...p.position },
          rotation: { ...p.rotation },
          wheelCompressionM: [...p.wheelCompressionM] as [number, number, number, number],
          wheelRotationRad: [...p.wheelRotationRad] as [number, number, number, number],
        })),
      };
    }

    // Prepare cleanly for the next lap (if continuous rolling laps in Time Trial) or stop
    if (config && nextLapCheckpoint) {
      this.beginRun({
        ...config,
        startCheckpoint: nextLapCheckpoint,
      });
    } else {
      this.abortRun('lap_finalized');
    }

    return bundle;
  }
}

/**
 * Light client/server sanity checker for replay bundles.
 * Never awards 'verified' (reserved strictly for deterministic replay recomputation).
 */
export function validateReplayIntegrity(
  bundle: ITimeTrialReplayBundle,
  options?: {
    expectedTrackId?: string;
    expectedTrackVersion?: string;
    expectedBalanceVersionId?: string;
    maxPlausibleSpeedMs?: number;
  }
): IReplayIntegrityResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const maxSpeedMs = options?.maxPlausibleSpeedMs ?? 170; // ~612 km/h absolute upper bound

  const serialized = JSON.stringify(bundle);
  const estimatedBytes = serialized.length;
  if (estimatedBytes > MAX_REPLAY_PAYLOAD_BYTES) {
    errors.push(`Payload size ${estimatedBytes} bytes exceeds ${MAX_REPLAY_PAYLOAD_BYTES} byte cap`);
  }

  const h = bundle.header;
  if (h.formatVersion !== REPLAY_FORMAT_VERSION) {
    errors.push(`Unsupported replay formatVersion: ${String(h.formatVersion)}`);
  }
  if (h.sessionMode !== 'time_trial') {
    errors.push(`Only time_trial replays are eligible for records/ghosts (got ${String(h.sessionMode)})`);
  }
  if (options?.expectedTrackId && h.track.trackId !== options.expectedTrackId) {
    errors.push(`Track mismatch: expected ${options.expectedTrackId}, got ${h.track.trackId}`);
  }
  if (options?.expectedTrackVersion && h.track.trackVersion !== options.expectedTrackVersion) {
    errors.push(`Track version mismatch: expected ${options.expectedTrackVersion}, got ${h.track.trackVersion}`);
  }
  if (options?.expectedBalanceVersionId && h.ruleset.balanceVersionId !== options.expectedBalanceVersionId) {
    errors.push(
      `Balance version mismatch: expected ${options.expectedBalanceVersionId}, got ${h.ruleset.balanceVersionId}`
    );
  }

  // Verify lap time and sector split consistency
  if (!Number.isFinite(h.lapTimeMs) || h.lapTimeMs < 3000 || h.lapTimeMs > 3_600_000) {
    errors.push(`Implausible lapTimeMs: ${h.lapTimeMs}`);
  }
  if (h.sectorTimesMs.length === 0 || h.sectorTimesMs.some((s) => !Number.isFinite(s) || s <= 0)) {
    errors.push('All sector times must be finite positive numbers');
  } else {
    const sectorSum = h.sectorTimesMs.reduce((acc, v) => acc + v, 0);
    if (Math.abs(sectorSum - h.lapTimeMs) > 150) {
      errors.push(`Sector sum (${sectorSum.toFixed(1)}ms) disagrees with lapTimeMs (${h.lapTimeMs.toFixed(1)}ms)`);
    }
  }

  // Verify ordered checkpoints
  for (let i = 1; i < h.orderedCheckpointsHit.length; i++) {
    if (h.orderedCheckpointsHit[i] <= h.orderedCheckpointsHit[i - 1]) {
      errors.push('Checkpoints are not strictly ordered');
      break;
    }
  }

  // Verify input ticks match lap duration
  let decodedInputTicks = 0;
  let expectedNextTick = h.startTick;
  for (const run of bundle.packedInputs) {
    if (run.repeatCount <= 0 || run.startTick !== expectedNextTick) {
      errors.push(`Discontinuous input tick sequence at tick ${run.startTick} (expected ${expectedNextTick})`);
      break;
    }
    decodedInputTicks += run.repeatCount;
    expectedNextTick += run.repeatCount;
  }

  const expectedTicksFromLap = Math.round((h.lapTimeMs / 1000) * FIXED_SIM_HZ);
  if (decodedInputTicks === 0) {
    errors.push('Replay contains zero input ticks');
  } else if (Math.abs(decodedInputTicks - expectedTicksFromLap) > FIXED_SIM_HZ) {
    warnings.push(
      `Decoded input ticks (${decodedInputTicks}) differ from lapTimeMs estimate (${expectedTicksFromLap}) by >1s`
    );
  }

  // Verify pose monotonicity and plausible movement (anti-teleport)
  if (bundle.poseSamples.length < 2) {
    errors.push('Replay must contain at least 2 pose samples');
  } else {
    for (let i = 1; i < bundle.poseSamples.length; i++) {
      const prev = bundle.poseSamples[i - 1];
      const curr = bundle.poseSamples[i];
      if (curr.tick <= prev.tick) {
        errors.push(`Non-monotonic pose tick at sample ${i}`);
        break;
      }
      const dtS = (curr.tick - prev.tick) * FIXED_SIM_DT;
      const distM = Math.hypot(
        curr.position.x - prev.position.x,
        curr.position.y - prev.position.y,
        curr.position.z - prev.position.z
      );
      const impliedSpeedMs = dtS > 0 ? distM / dtS : 0;
      if (impliedSpeedMs > maxSpeedMs * 1.25 || curr.speedMs > maxSpeedMs) {
        errors.push(`Implausible movement speed (${impliedSpeedMs.toFixed(1)} m/s) at pose sample ${i}`);
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    recommendedVerificationLevel: errors.length === 0 ? 'sanity_checked' : 'unverified',
    errors,
    warnings,
    estimatedBytes,
    decodedInputTicks,
  };
}

function generateReplayId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `rpl_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `rpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
