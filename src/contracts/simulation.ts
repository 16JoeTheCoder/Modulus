/**
 * MODULUS Shared Simulation Contracts (src/contracts/simulation.ts)
 *
 * Pure TypeScript contract layer with ZERO runtime imports from Three.js, Rapier3D, or React.
 * Shared across: physics, cockpit/UI/audio, courses/track-authoring, rivals/ghosts/AI/netcode, and Worker API.
 *
 * LOCKED CONVENTIONS:
 * - Right-handed vehicle local frame: +X = Left, +Y = Up, +Z = Forward (Local Right = -X).
 * - Steering sign: steer in [-1, +1], where +1 = Full Left, -1 = Full Right.
 * - Wheel index order: 0 = FL, 1 = FR, 2 = RL, 3 = RR.
 * - Fixed simulation rate: 120 Hz (FIXED_SIM_DT = 1 / 120 s) with monotonic integer tick.
 * - Input shaping runs deterministically inside the fixed step from raw bounded frames.
 * - Standing start: startGrid[0] nose-at-S/F, lapArmed = false on reset, arms on launch.
 */

export const FIXED_SIM_HZ = 120 as const;
export const FIXED_SIM_DT = 1 / FIXED_SIM_HZ;

export const CURRENT_BUILD_SCHEMA_VERSION = 2 as const;
export const LEGACY_BUILD_SCHEMA_VERSION = 1 as const;
export const CURRENT_PHYSICS_VERSION = 'phys-2.0.0' as const;
export const CURRENT_RULESET_VERSION = 'rules-2.0.0' as const;
export const DEFAULT_TRACK_VERSION = 'v1.0.0' as const;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type WheelIndex = 0 | 1 | 2 | 3; // 0: FL, 1: FR, 2: RL, 3: RR

export type SurfaceType = 'tarmac' | 'kerb' | 'grass' | 'gravel' | 'dirt';

export const SURFACE_CODE = {
  tarmac: 0,
  kerb: 1,
  grass: 2,
  gravel: 3,
  dirt: 4,
} as const;

export type SurfaceCode = (typeof SURFACE_CODE)[SurfaceType];

export function surfaceCodeToType(code: number): SurfaceType {
  if (code === SURFACE_CODE.kerb) return 'kerb';
  if (code === SURFACE_CODE.grass) return 'grass';
  if (code === SURFACE_CODE.gravel) return 'gravel';
  if (code === SURFACE_CODE.dirt) return 'dirt';
  return 'tarmac';
}

export type SessionMode =
  | 'practice'
  | 'time_trial'
  | 'drift'
  | 'ai_race'
  | 'friend_race'
  | 'royal_prix';

export type VehicleControllerKind = 'local' | 'ai' | 'remote' | 'replay';

export type VerificationLevel = 'unverified' | 'local' | 'sanity_checked' | 'verified';

export type TransmissionMode = 'auto' | 'manual';

export type AssistPreset = 'beginner' | 'sport' | 'pro';

export type ReverseState =
  | 'forward'
  | 'stopped_brake_held'
  | 'reverse_ready'
  | 'reverse';

export const DAMAGE_ZONE_ORDER = [
  'wheel_fl',
  'wheel_fr',
  'wheel_rl',
  'wheel_rr',
  'front',
  'rear',
  'left_side',
  'right_side',
  'cooling',
  'driveline',
] as const;

export type DamageZoneId = (typeof DAMAGE_ZONE_ORDER)[number];

export type DamageZoneTuple = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

// ============================================================================
// 1. VERSION IDENTIFIERS (Backwards-compatible with legacy saves & laps)
// ============================================================================

export interface ICarBuildVersionMeta {
  buildId: string;
  chassisId: string;
  /** Schema version; legacy saved builds without this field default to 1. */
  buildSchemaVersion: number;
  /** Monotonic build edit counter (defaults to 1). */
  buildRevision: number;
  /** Deterministic canonical hash of the build config for replay/leaderboard provenance. */
  buildContentHash?: string;
  balanceVersionId: string;
}

export interface ITrackVersionMeta {
  trackId: string;
  /** Track version string; legacy tracks without this field default to 'v1.0.0'. */
  trackVersion: string;
  /** Deterministic hash of collision/spline geometry for replay & record partitioning. */
  geometryHash: string;
}

export interface IRulesetVersionKey {
  physicsVersion: string;
  rulesetVersion: string;
  balanceVersionId: string;
  weatherKey: string;
  assistPreset: AssistPreset;
  transmissionMode: TransmissionMode;
}

export function normalizeBuildSchemaVersion(version?: number): number {
  return typeof version === 'number' && Number.isInteger(version) && version >= 1
    ? version
    : LEGACY_BUILD_SCHEMA_VERSION;
}

export function normalizeTrackVersion(version?: string): string {
  return version && version.trim().length > 0 ? version.trim() : DEFAULT_TRACK_VERSION;
}

// ============================================================================
// 2. FIXED-STEP INPUT FRAME (120 Hz, deterministic & quantizable)
// ============================================================================

export const INPUT_FLAG = {
  NONE: 0,
  GEAR_UP: 1 << 0,
  GEAR_DOWN: 1 << 1,
  RESET_VEHICLE: 1 << 2,
  PIT_REQUEST: 1 << 3,
  /** Rising edge of brake/S press: at standstill, release + fresh press engages reverse. */
  BRAKE_FRESH_PRESS: 1 << 4,
  /** Explicit reverse request (e.g. AI recovery or dedicated reverse bind). */
  REVERSE_REQUEST: 1 << 5,
} as const;

export type InputSourceKind = 'keyboard' | 'touch' | 'gamepad' | 'ai' | 'remote' | 'replay';

/**
 * Deterministic fixed-step driver input frame consumed at tick `tick`.
 * Input shaping (keyboard ramp, speed taper, reverse-on-fresh-press, assist presets)
 * runs deterministically inside the fixed step from these bounded frames so live runs,
 * ghosts/replays, AI, and remote Friend Race peers produce identical vehicle responses.
 */
export interface IFixedStepInputFrame {
  /** Monotonic uint32 simulation tick at FIXED_SIM_HZ (120 Hz). */
  tick: number;
  /** Stable vehicle identifier within the simulation world (e.g. 'v0'..'v3'). */
  vehicleId: string;
  controllerKind: VehicleControllerKind;
  inputSource: InputSourceKind;
  /** Bounded [0..1] throttle intent. */
  throttle: number;
  /** Bounded [0..1] service brake intent. */
  brake: number;
  /** Bounded [-1..+1] steering intent (+1 = Left, -1 = Right). */
  steer: number;
  /** Bounded [0..1] handbrake intent. */
  handbrake: number;
  /** Bounded [0..1] clutch intent. */
  clutch: number;
  /** Bitmask of INPUT_FLAG values. */
  flags: number;
}

/** Compact quantized wire/replay representation of IFixedStepInputFrame. */
export interface IQuantizedInputFrame {
  tick: number;
  vehicleId: string;
  /** uint16 [0..65535] */
  throttleQ: number;
  /** uint16 [0..65535] */
  brakeQ: number;
  /** int16 [-32767..+32767] (+ = Left, - = Right) */
  steerQ: number;
  /** uint16 [0..65535] */
  handbrakeQ: number;
  /** uint16 [0..65535] */
  clutchQ: number;
  /** uint8 bitmask of INPUT_FLAG */
  flags: number;
}

// ============================================================================
// 3. VEHICLE STATE SNAPSHOT & MULTI-VEHICLE SIMULATION INTERFACE
// ============================================================================

export interface IWheelStateSnapshot {
  index: WheelIndex;
  grounded: boolean;
  surface: SurfaceType;
  suspensionLengthM: number;
  compressionM: number;
  compressionVelocityMs: number;
  steerAngleRad: number;
  camberAngleRad: number;
  rotationAngleRad: number;
  angularVelocityRadS: number;
  normalLoadN: number;
  slipRatio: number;
  slipAngleRad: number;
  /** 0..1 braking lockup intensity (HUD/audio cue). */
  lockupIntensity: number;
  /** 0..1 lateral/combined tire scrub intensity (audio/FX cue). */
  scrubIntensity: number;
  tireTempC: number;
  tireWear: number; // 0..1
  brakeTempC: number;
}

export interface IVehicleImpactPulse {
  /** Monotonic per-vehicle impact sequence counter so audio/HUD never double-triggers. */
  seq: number;
  tick: number;
  /** Normalized impact severity [0..1]. */
  intensity01: number;
  impulseNs: number;
  /** Impact direction in car-local space (+X left, +Y up, +Z forward). */
  localDirection: Vec3;
  zone: DamageZoneId;
  otherVehicleId?: string;
}

/**
 * Full read-only vehicle snapshot emitted/polled for Cockpit, HUD, Audio, Debrief, and Diagnostics.
 */
export interface IVehicleStateSnapshot {
  tick: number;
  simTimeMs: number;
  vehicleId: string;
  slotIndex: number;
  controllerKind: VehicleControllerKind;

  // Pose & Kinematics
  position: Vec3;
  rotation: Quat;
  linearVelocityWorld: Vec3;
  angularVelocityWorld: Vec3;
  /** Total 3D speed in m/s (HUD converts to MPH default / km/h option). */
  speedMs: number;
  /** Signed longitudinal speed along vehicle forward (+forward, -reverse) in m/s. */
  forwardSpeedMs: number;
  longitudinalG: number;
  lateralG: number;
  yawRateRadS: number;
  /** Vehicle chassis sideslip angle in radians. */
  bodySlipAngleRad: number;

  // Steering, Pedals & Controls State
  rawSteerInput: number;
  /** Post-shaped steering command [-1..+1] (+Left, -Right). */
  commandedSteer: number;
  /** Actual average front wheel steer angle in radians. */
  frontWheelAngleRad: number;
  throttle: number;
  brake: number;
  handbrake: number;
  brakeLightOn: boolean;
  reverseState: ReverseState;
  transmissionMode: TransmissionMode;
  assistPreset: AssistPreset;

  // Powertrain & Thermals
  gear: number; // -1 = R, 0 = N, 1..N = Forward
  isShifting: boolean;
  shiftDirection: -1 | 0 | 1;
  engineRpm: number;
  idleRpm: number;
  redlineRpm: number;
  revLimiterRpm: number;
  /** Normalized combustion load [0..1] for cockpit audio & telemetry. */
  engineLoad: number;
  turboBoostBar: number;
  maxBoostBar: number;
  fuelLiters: number;
  fuelCapacityL: number;
  engineTempC: number;
  engineMaxSafeTempC: number;
  engineLimpMode: boolean;
  engineBlown: boolean;

  // Aerodynamics
  downforceTotalN: number;
  diffuserStalled: boolean;

  // 4-Corner Wheels
  wheels: [IWheelStateSnapshot, IWheelStateSnapshot, IWheelStateSnapshot, IWheelStateSnapshot];

  // Progressive Damage (10 gameplay zones, 0 = intact .. 1 = severe) & Latest Impact
  damageZones: DamageZoneTuple;
  lastImpact: IVehicleImpactPulse | null;

  // Lap & Sector Timing State
  lapNumber: number;
  sectorIndex: number;
  sectorCount: number;
  splineProgress: number;
  /** False while parked on standing grid before launch/line-cross; prevents pre-launch clock tick. */
  lapArmed: boolean;
  currentLapTimeMs: number;
  lastLapTimeMs: number | null;
  bestLapTimeMs: number | null;
  lapDeltaMs: number;
  sectorTimesMs: number[];
  lapValid: boolean;
  checkpointMask: number;
}

/**
 * Compact 15-30 Hz snapshot for visual ghost playback and Friend Race WebRTC replication.
 */
export interface ICompactVehicleNetSnapshot {
  tick: number;
  vehicleId: string;
  position: Vec3;
  rotation: Quat;
  linearVelocityWorld: Vec3;
  angularVelocityWorld: Vec3;
  speedMs: number;
  engineRpm: number;
  gear: number;
  frontWheelAngleRad: number;
  wheelCompressionM: [number, number, number, number];
  wheelRotationRad: [number, number, number, number];
  brakeLightOn: boolean;
  /** Max tire scrub intensity across 4 wheels [0..1]. */
  skidIntensity: number;
  /** Quantized damage per 10 zones (0..255). */
  damageZonesQ: DamageZoneTuple;
  lapNumber: number;
  sectorIndex: number;
  splineProgress: number;
  lapValid: boolean;
}

/**
 * Deterministic starting/resume state for trusted replay verification and future host migration.
 */
export interface ISimulationCheckpoint {
  tick: number;
  prngSeed: number;
  sessionMode: SessionMode;
  track: ITrackVersionMeta;
  ruleset: IRulesetVersionKey;
  vehicles: Array<{
    vehicleId: string;
    slotIndex: number;
    controllerKind: VehicleControllerKind;
    buildMeta: ICarBuildVersionMeta;
    position: Vec3;
    rotation: Quat;
    linearVelocityWorld: Vec3;
    angularVelocityWorld: Vec3;
    fuelLiters: number;
    engineTempC: number;
    tireTempsC: [number, number, number, number];
    tireWear: [number, number, number, number];
    brakeTempsC: [number, number, number, number];
    damageZones: DamageZoneTuple;
    lapNumber: number;
    sectorIndex: number;
    checkpointMask: number;
    lapValid: boolean;
  }>;
}

// ============================================================================
// 4. LAP, SECTOR & CHECKPOINT EVENTS
// ============================================================================

export type LapInvalidationReason =
  | 'off_track'
  | 'reset'
  | 'wall_skip'
  | 'missed_checkpoint'
  | 'wrong_way';

export type StartTimingMode = 'standing_on_launch' | 'crossing_start_line' | 'countdown_go';

export interface ISectorSplitEvent {
  vehicleId: string;
  tick: number;
  sessionMode: SessionMode;
  trackId: string;
  trackVersion: string;
  rulesetVersion: string;
  lapNumber: number;
  sectorIndex: number; // 0-based
  sectorCount: number;
  sectorName: string;
  splitTimeMs: number;
  cumulativeLapTimeMs: number;
  deltaToBestSectorMs: number | null;
  isBestSector: boolean;
  sectorValid: boolean;
  checkpointMask: number;
}

export interface ILapInvalidatedEvent {
  vehicleId: string;
  tick: number;
  lapNumber: number;
  sectorIndex: number;
  reason: LapInvalidationReason;
}

export interface ILapFinishedEvent {
  vehicleId: string;
  tick: number;
  sessionMode: SessionMode;
  trackId: string;
  trackVersion: string;
  geometryHash: string;
  physicsVersion: string;
  rulesetVersion: string;
  balanceVersionId: string;
  buildId: string;
  buildSchemaVersion: number;
  buildContentHash?: string;
  chassisId: string;
  pwrRatio: number;
  lapNumber: number;
  lapTimeMs: number;
  sectorTimesMs: number[];
  sectorNames: string[];
  deltaToBestLapMs: number | null;
  isPersonalBest: boolean;
  lapValid: boolean;
  invalidReasons: LapInvalidationReason[];
  checkpointMask: number;
  orderedCheckpointsHit: number[];
  peakSpeedMs: number;
  /** Redundant convenience field for legacy API / HUD compatibility. */
  peakSpeedKph: number;
  isAiAssisted: boolean;
  verificationLevel: VerificationLevel;
}

// ============================================================================
// 5. RENDER-VS-COLLISION GEOMETRY HANDLES (Track & Vehicle)
// ============================================================================

export type CourseTag = 'race' | 'drift' | 'rally' | 'endurance' | 'mixed_surface';

export interface ITrackGridSlot {
  slotIndex: number; // 0..3
  position: Vec3;
  rotation: Quat;
  splineProgress: number;
  lateralOffsetM: number;
}

export interface ITrackTimingGate {
  /** 0 = Start/Finish, 1..K = ordered sector & anti-cut checkpoint gates. */
  gateIndex: number;
  kind: 'start_finish' | 'sector' | 'checkpoint';
  /** 0-based sector completed upon crossing this gate (present for 'sector' and 'start_finish'). */
  sectorIndex?: number;
  sectorName?: string;
  t: number; // Spline parameter [0..1)
  center: Vec3;
  tangent: Vec3;
  right: Vec3;
  normal: Vec3;
  halfWidthM: number;
}

export interface ITrackSectorMeta {
  index: number;
  name: string;
  startT: number;
  endT: number;
  surface: SurfaceType;
}

/**
 * Track zone span in normalized spline parameter [0..1).
 * NOTE: `startT > endT` is permitted and indicates a zone wrapping across t = 0
 * (e.g., Switchyard Sprint Main Straight passing zone spans ~0.94 -> 0.08).
 */
export interface ITrackZoneMeta {
  id: string;
  name: string;
  kind: 'passing' | 'drift' | 'surface';
  startT: number;
  endT: number;
  surface?: SurfaceType;
}

/** Optional backwards-compatible v2 metadata fields on route JSON / ITrackSplineSchema. */
export interface ITrackSchemaV2Extensions {
  trackVersion?: string;
  courseTags?: CourseTag[];
  suggestedLaps?: number;
  sectors?: ITrackSectorMeta[];
  /** Zone spans may wrap across t = 0 when startT > endT. */
  passingZones?: Array<{ id: string; name: string; startT: number; endT: number }>;
  /** Zone spans may wrap across t = 0 when startT > endT. */
  driftZones?: Array<{ id: string; name: string; startT: number; endT: number }>;
  /** Zone spans may wrap across t = 0 when startT > endT. */
  surfaceZones?: Array<{ startT: number; endT: number; surface: SurfaceType }>;
}

/**
 * Pure math / typed-array track collision handle (ZERO Three.js imports).
 * Built from the exact same TrackSpline as previews and ITrackRenderHandle.
 */
export interface ITrackCollisionHandle {
  handleId: string;
  trackId: string;
  trackVersion: string;
  geometryHash: string;
  totalLengthM: number;
  roadVertices: Float32Array;
  roadIndices: Uint32Array;
  wallVertices?: Float32Array;
  wallIndices?: Uint32Array;
  /** Per-triangle surface codes matching SURFACE_CODE (0=tarmac, 1=kerb, 2=grass, 3=gravel, 4=dirt). */
  triangleSurfaces: Uint8Array;
  startGrid: ITrackGridSlot[];
  timingGates: ITrackTimingGate[];
  sectors: ITrackSectorMeta[];
  zones: ITrackZoneMeta[];
  bounds: { min: Vec3; max: Vec3 };
}

/**
 * Visual track handle paired 1:1 with ITrackCollisionHandle via handleId & geometryHash.
 */
export interface ITrackRenderHandle {
  handleId: string;
  trackId: string;
  trackVersion: string;
  geometryHash: string;
  /** Opaque render root (THREE.Group in browser runtime). */
  sceneObject: unknown;
  dispose(): void;
}

/**
 * Vehicle collision hull specification (car-local coordinates).
 */
export interface IVehicleCollisionHull {
  /** Cuboid half-extents: x = halfWidth, y = halfHeight, z = halfLength. */
  halfExtents: Vec3;
  /** Center offset in vehicle local frame (clears wheels/kerbs). */
  localOffset: Vec3;
  friction: number;
  restitution: number;
}

/**
 * Pure physics handle for a vehicle (ghosts set collisionEnabled: false and have no Rapier body).
 */
export interface IVehicleCollisionHandle {
  handleId: string;
  vehicleId: string;
  chassisId: string;
  buildSchemaVersion: number;
  collisionEnabled: boolean;
  hull: IVehicleCollisionHull;
  wheelAnchorsLocal: [Vec3, Vec3, Vec3, Vec3];
  wheelRadiusFrontM: number;
  wheelRadiusRearM: number;
  /** Opaque Rapier rigid-body handle when collisionEnabled is true. */
  bodyHandle?: number;
  /** Opaque Rapier collider handle when collisionEnabled is true. */
  colliderHandle?: number;
}

/**
 * Visual vehicle handle paired with IVehicleCollisionHandle, exposing per-chassis cockpit anchors.
 */
export interface IVehicleRenderHandle {
  handleId: string;
  vehicleId: string;
  chassisId: string;
  isGhost: boolean;
  /** Per-chassis driver eye point in vehicle local space (+X left, +Y up, +Z forward). */
  cockpitEyeLocal: Vec3;
  /** Per-chassis steering wheel pivot in vehicle local space. */
  steeringWheelLocal: Vec3;
  /** Per-chassis hood camera mount in vehicle local space. */
  hoodCamLocal: Vec3;
  /** Opaque render root (THREE.Group in browser runtime). */
  sceneObject: unknown;
  dispose(): void;
}

// ============================================================================
// 6. MULTI-VEHICLE SIMULATION STEP INTERFACE
// ============================================================================

export interface ISimulationWorldStepApi {
  readonly fixedHz: typeof FIXED_SIM_HZ;
  readonly fixedDt: typeof FIXED_SIM_DT;
  getCurrentTick(): number;
  step(tick: number, dt: number, inputsByVehicleId: ReadonlyMap<string, IFixedStepInputFrame>): void;
  getVehicleSnapshot(vehicleId: string): IVehicleStateSnapshot | null;
  listVehicleSnapshots(): IVehicleStateSnapshot[];
}
