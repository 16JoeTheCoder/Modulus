import type {
  ICarBuildVersionMeta,
  IQuantizedInputFrame,
  IRulesetVersionKey,
  ISimulationCheckpoint,
  ITrackVersionMeta,
  Quat,
  Vec3,
  VerificationLevel,
} from '../contracts/simulation';

export const REPLAY_FORMAT_VERSION = 1 as const;
export const DEFAULT_GHOST_SAMPLE_STRIDE_TICKS = 6 as const; // 20 Hz at 120 Hz fixed physics
export const MAX_REPLAY_PAYLOAD_BYTES = 512 * 1024; // 512 KB sanity cap

export interface IGhostPoseSample {
  tick: number;
  simTimeMs: number;
  position: Vec3;
  rotation: Quat;
  speedMs: number;
  engineRpm: number;
  gear: number;
  frontWheelAngleRad: number;
  wheelCompressionM: [number, number, number, number];
  wheelRotationRad: [number, number, number, number];
  brakeLightOn: boolean;
  skidIntensity: number;
  splineProgress: number;
}

/** Run-length encoded quantized input entry (repeatCount consecutive ticks with identical inputs). */
export interface IPackedInputRun {
  startTick: number;
  repeatCount: number;
  throttleQ: number;
  brakeQ: number;
  steerQ: number;
  handbrakeQ: number;
  clutchQ: number;
  flags: number;
}

export interface IReplayHeader {
  formatVersion: typeof REPLAY_FORMAT_VERSION;
  replayId: string;
  /** Time Trial strictly owns shareable personal bests and ghosts. */
  sessionMode: 'time_trial';
  track: ITrackVersionMeta;
  ruleset: IRulesetVersionKey;
  buildMeta: ICarBuildVersionMeta;
  driverDisplayName: string;
  recordedAtIso: string;
  lapNumber: number;
  startTick: number;
  endTick: number;
  lapTimeMs: number;
  sectorTimesMs: number[];
  sectorNames: string[];
  checkpointMask: number;
  orderedCheckpointsHit: number[];
  peakSpeedMs: number;
  /** Never claims 'verified' until recomputed by a trusted deterministic replay. */
  verificationLevel: VerificationLevel;
  startCheckpoint: ISimulationCheckpoint;
}

export interface ITimeTrialReplayBundle {
  header: IReplayHeader;
  /** Compact RLE-packed 120 Hz quantized input frames for trusted replay verification. */
  packedInputs: IPackedInputRun[];
  /** Periodic 20 Hz pose samples for zero-collision visual ghost playback. */
  poseSamples: IGhostPoseSample[];
}

export interface IGhostPlaybackPose {
  /** Ghosts strictly have zero collision bodies. */
  readonly collisionEnabled: false;
  tick: number;
  simTimeMs: number;
  position: Vec3;
  rotation: Quat;
  speedMs: number;
  engineRpm: number;
  gear: number;
  frontWheelAngleRad: number;
  wheelCompressionM: [number, number, number, number];
  wheelRotationRad: [number, number, number, number];
  brakeLightOn: boolean;
  skidIntensity: number;
  splineProgress: number;
  finished: boolean;
}

export interface IReplayIntegrityResult {
  valid: boolean;
  recommendedVerificationLevel: VerificationLevel;
  errors: string[];
  warnings: string[];
  estimatedBytes: number;
  decodedInputTicks: number;
}

export interface IStoredPersonalBest {
  partitionKey: string;
  bundle: ITimeTrialReplayBundle;
  updatedAtIso: string;
}

export interface IUnpackedReplayInputs {
  vehicleId: string;
  frames: IQuantizedInputFrame[];
}
