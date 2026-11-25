import { z } from 'zod';
import type {
  AspirationType,
  BlockMaterial,
  BodyPanelMaterial,
  CaliperPistons,
  DifferentialType,
  DrivetrainLayout,
  EcuTuneMap,
  EngineLayout,
  ExhaustMaterial,
  FrameMaterial,
  FrontSplitterSpec,
  GearboxType,
  IHardpointMap,
  Quat,
  RadiatorSpec,
  RearDiffuserSpec,
  RearWingSpec,
  RimMaterial,
  RollCageSpec,
  RotorMaterial,
  SuspensionLayout,
  TireCompound,
  Vec3,
} from './content';

import type {
  AssistPreset,
  DamageZoneTuple,
  IVehicleCollisionHull,
  IVehicleImpactPulse,
  ReverseState,
  SurfaceType as ContractSurfaceType,
  TransmissionMode,
} from '../../contracts/simulation';

export type WheelIndex = 0 | 1 | 2 | 3; // 0: FL, 1: FR, 2: RL, 3: RR
export type SurfaceType = ContractSurfaceType;

/**
 * Full 8-Module Vehicle Customization & Tuning Configuration
 * Matches CUSTOMIZATION_SPEC.md parameter-for-parameter.
 */
export interface IVehicleBuildConfig {
  id: string;
  name: string;
  chassisId: string;
  /** Optional version metadata: legacy saved builds without it default to schema v1. */
  buildSchemaVersion?: number;
  buildRevision?: number;
  paintHex: string;
  accentHex: string;

  // Equipped Part IDs from /src/content/parts/*
  equippedPartIds: {
    engineBlockId: string;
    aspirationId: string;
    exhaustId: string;
    gearboxId: string;
    differentialId: string;
    suspensionId: string;
    rimId: string;
    tireCompoundId: string;
    rotorId: string;
    caliperId: string;
    bodyPanelId: string;
    frontSplitterId: string;
    rearDiffuserId: string;
    rearWingId: string;
    radiatorId: string;
  };

  // Module 1: Chassis & Monocoque
  chassis: {
    drivetrain: DrivetrainLayout;
    frameMaterial: FrameMaterial;
    wheelbaseM: number; // 2.20 - 2.95, step 0.05
    trackWidthM: number; // 1.50 - 2.00, step 0.02
    rollCage: RollCageSpec;
    ballastMassKg: number; // 0 - 100, step 5
    ballastPositionX: number; // -1.0 (Rear) to +1.0 (Front), step 0.05
  };

  // Module 2: Engine & Powertrain
  engine: {
    layout: EngineLayout;
    displacementL: number; // 1.3 - 6.2, step 0.1
    blockMaterial: BlockMaterial;
    aspiration: AspirationType;
    turboBoostBar: number; // 0.3 - 2.5, step 0.1
    camshaftProfile: number; // 0.0 - 1.0, step 0.1
    revLimiterRpm: number; // 5500 - 10000, step 250
    exhaustMaterial: ExhaustMaterial;
    ecuTune: EcuTuneMap;
  };

  // Module 3: Drivetrain & Gearbox
  drivetrain: {
    gearboxType: GearboxType;
    finalDriveRatio: number; // 2.80 - 5.20, step 0.05
    gearRatios: number[]; // G1 - G7 (0.65 - 4.00, step 0.02)
    flywheelMassKg: number; // 3.5 - 12.0, step 0.5
    differentialType: DifferentialType;
    diffAccelLockPct: number; // 10 - 100, step 5
    diffDecelLockPct: number; // 0 - 100, step 5
  };

  // Module 4: Suspension & Alignment Geometry
  suspension: {
    layout: SuspensionLayout;
    rideHeightFrontMm: number; // 45 - 140, step 5
    rideHeightRearMm: number; // 45 - 140, step 5
    springRateFrontNmm: number; // 30 - 220, step 5
    springRateRearNmm: number; // 30 - 220, step 5
    damperBumpFront: number; // 1 - 20, step 1
    damperBumpRear: number; // 1 - 20, step 1
    damperReboundFront: number; // 1 - 20, step 1
    damperReboundRear: number; // 1 - 20, step 1
    arbFrontNmm: number; // 10 - 120, step 5
    arbRearNmm: number; // 10 - 120, step 5
    camberFrontDeg: number; // -5.0 - 0.0, step 0.2
    camberRearDeg: number; // -5.0 - 0.0, step 0.2
    toeFrontDeg: number; // -1.0 - +1.0, step 0.05
    toeRearDeg: number; // -1.0 - +1.0, step 0.05
    casterFrontDeg: number; // 2.0 - 9.0, step 0.5
  };

  // Module 5: Wheels & Tires
  wheelsAndTires: {
    rimMaterial: RimMaterial;
    rimDiameterIn: number; // 15 - 20, step 1
    tireWidthFrontMm: number; // 195 - 345, step 10
    tireWidthRearMm: number; // 195 - 345, step 10
    sidewallProfilePct: number; // 30 - 60, step 5
    tireCompound: TireCompound;
    coldPressurePsi: number; // 20 - 38, step 0.5
  };

  // Module 6: Brakes & Thermal Cooling
  brakes: {
    rotorDiameterMm: number; // 280 - 400, step 20
    rotorMaterial: RotorMaterial;
    caliperPistons: CaliperPistons;
    brakeBiasFrontPct: number; // 50 - 75, step 1
    brakeDuctOpeningPct: number; // 0 - 100, step 10
  };

  // Module 7: Aerodynamics & Bodywork
  aero: {
    bodyPanelMaterial: BodyPanelMaterial;
    frontSplitter: FrontSplitterSpec;
    rearDiffuser: RearDiffuserSpec;
    rearWing: RearWingSpec;
    wingAngleDeg: number; // 0 - 20, step 1
  };

  // Module 8: Fuel & Radiator
  fuelAndCooling: {
    fuelLoadL: number; // 5 - 80, step 5
    radiatorSpec: RadiatorSpec;
  };
}

export interface IDynoPoint {
  rpm: number;
  torqueNm: number;
  powerHp: number;
  boostBar: number;
}

export interface ISpiderMetrics {
  acceleration: number; // 0 - 100
  topSpeed: number; // 0 - 100
  corneringG: number; // 0 - 100
  braking: number; // 0 - 100
  thermalStability: number; // 0 - 100
  aeroEfficiency: number; // 0 - 100
}

export interface IEngineeringWarning {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  module: string;
  title: string;
  message: string;
}

/**
 * Deterministic Compiled Vehicle Specification consumed by 120Hz Physics,
 * 3D Car Assembler, Lab Overlays, and Economy Validation.
 */
export interface ICompiledVehicle {
  build: IVehicleBuildConfig;
  chassisName: string;
  bodyStyle: 'coupe' | 'wedge' | 'hatch' | 'prototype';

  // Mass & Inertia
  dryMassKg: number;
  fuelMassKg: number;
  totalMassKg: number;
  unsprungMassPerCornerKg: [number, number, number, number];
  cgPositionLocal: Vec3; // x: lateral (0), y: cgHeightM, z: +front / -rear offset from center
  cgHeightM: number;
  frontWeightDistributionPct: number; // e.g., 48.5 means 48.5% Front / 51.5% Rear
  yawInertiaKgM2: number;
  pitchInertiaKgM2: number;
  rollInertiaKgM2: number;
  torsionalRigidityNmDeg: number;

  // Dimensions & Hardpoints
  wheelbaseM: number;
  trackWidthM: number;
  wheelRadiusFrontM: number;
  wheelRadiusRearM: number;
  wheelPositionsLocal: [Vec3, Vec3, Vec3, Vec3]; // FL, FR, RL, RR
  suspensionRestLengthM: [number, number, number, number];
  suspensionMaxTravelM: number;
  hardpoints: IHardpointMap;

  // Render-vs-Collision Anchors & Hull (per-chassis)
  cockpitEyeLocal: Vec3;
  steeringWheelLocal: Vec3;
  hoodCamLocal: Vec3;
  collisionHull: IVehicleCollisionHull;

  // Powertrain & Gearbox
  idleRpm: number;
  redlineRpm: number;
  revLimiterRpm: number;
  peakTorqueNm: number;
  peakTorqueRpm: number;
  peakPowerHp: number;
  peakPowerRpm: number;
  pwrRatioHpPerKg: number;
  engineRotationalInertiaKgM2: number;
  wheelRotationalInertiaKgM2: [number, number, number, number];
  drivetrainLossEfficiency: number; // e.g. 0.88 for AWD, 0.94 for FR
  shiftDurationSeconds: number;
  maxBoostBar: number;
  turboSpoolRate: number;
  fuelBurnRateLPerSecAtMaxPower: number;
  dynoCurve: IDynoPoint[];

  // Aerodynamics
  frontalAreaM2: number;
  dragCoefficientCd: number;
  liftCoefficientFrontCl: number; // Positive = downforce magnitude
  liftCoefficientRearCl: number; // Positive = downforce magnitude
  aeroBalanceFrontPct: number;
  diffuserOptimalRideHeightMm: [number, number];

  // Tires & Brakes
  peakTireMuFront: number;
  peakTireMuRear: number;
  tireOptimalTempWindowC: [number, number];
  tireWearRateMultiplier: number;
  pacejkaB: number;
  pacejkaC: number;
  pacejkaE: number;
  maxBrakeTorquePerAxleFrontNm: number;
  maxBrakeTorquePerAxleRearNm: number;
  brakeMaxSafeTempC: number;
  brakeColdBiteFactor: number;

  // Thermals
  radiatorCoolingKw: number;
  engineThermalCapacityJPerC: number;
  engineMaxSafeTempC: number;
  engineHeatMultiplier: number;
  brakeCoolingFactor: number;

  // Cost & Gamified Summary
  estimatedBuildValueCredits: number;
  estimatedTopSpeedKph: number;
  spider: ISpiderMetrics;
  warnings: IEngineeringWarning[];
}

export interface IInputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (right) .. +1 (left) or signed convention: +1 = left turn, -1 = right turn
  handbrake: number; // 0..1
  clutch: number; // 0..1
  gearUp: boolean;
  gearDown: boolean;
  resetVehicle: boolean;
  /** Rising edge of brake/S press for deterministic reverse-on-fresh-press at standstill. */
  brakeFreshPress?: boolean;
  reverseRequest?: boolean;
  inputSource: 'keyboard' | 'touch' | 'gamepad' | 'ai' | 'remote' | 'replay';
}

export interface IPointForceRequest {
  forceWorld: Vec3;
  pointWorld: Vec3;
}

export interface IWheelRuntimeState {
  index: WheelIndex;
  grounded: boolean;
  surface: SurfaceType;
  contactPointWorld: Vec3;
  contactNormalWorld: Vec3;
  worldPosition: Vec3;
  prevWorldPosition: Vec3;
  suspensionLengthM: number;
  compressionM: number;
  compressionVelocityMs: number;
  bottomedOut: boolean;
  steerAngleRad: number;
  camberAngleRad: number;
  angularVelocityRadS: number;
  rotationAngleRad: number;
  normalLoadN: number;
  slipRatio: number; // kappa
  slipAngleRad: number; // alpha
  longitudinalForceN: number;
  lateralForceN: number;
  driveTorqueNm: number;
  brakeTorqueNm: number;
  tireTempC: number;
  tireWear: number; // 0.0 (fresh) .. 1.0 (shredded)
  thermalGripMultiplier: number;
  brakeTempC: number;
  brakeFadeMultiplier: number;
  /** 0..1 braking lockup cue for HUD & audio. */
  lockupIntensity: number;
  /** 0..1 tire scrub/slide cue for audio & FX. */
  scrubIntensity: number;
}

export interface IVehicleRuntimeState {
  // Fixed-Step Simulation Clock & Identity
  simTick: number;
  simTimeMs: number;
  vehicleId: string;

  // Spatial & Rigid Body (Local +X = Left, +Y = Up, +Z = Forward; Local Right = -X)
  position: Vec3;
  prevPosition: Vec3;
  rotation: Quat;
  prevRotation: Quat;
  linearVelocityWorld: Vec3;
  angularVelocityWorld: Vec3;
  localVelocity: Vec3; // x: lateral (+right), y: vertical (+up), z: longitudinal (+forward)
  forwardWorld: Vec3;
  upWorld: Vec3;
  rightWorld: Vec3;

  // Speed & Accelerations
  speedMs: number;
  forwardSpeedMs: number; // signed longitudinal speed (+forward, -reverse)
  speedKph: number;
  longitudinalG: number;
  lateralG: number;
  yawRateRadS: number;
  bodySlipAngleRad: number;

  // Steering & Controls Telemetry
  rawSteerInput: number;
  commandedSteer: number;
  frontWheelAngleRad: number;
  reverseState: ReverseState;
  transmissionMode: TransmissionMode;
  assistPreset: AssistPreset;

  // Powertrain Runtime
  engineRpm: number;
  engineTorqueNm: number;
  enginePowerHp: number;
  engineLoad: number; // 0..1 normalized combustion load
  turboBoostBar: number;
  gear: number; // -1 = R, 0 = N, 1..7 = Forward gears
  shiftTimerS: number;
  isShifting: boolean;
  shiftDirection: -1 | 0 | 1;
  clutchEngagement: number; // 0..1
  fuelLiters: number;

  // Aerodynamics Runtime
  downforceFrontN: number;
  downforceRearN: number;
  downforceTotalN: number;
  dragForceN: number;
  diffuserStalled: boolean;

  // Thermals Runtime
  ambientTempC: number;
  trackTempC: number;
  engineTempC: number;
  engineLimpMode: boolean;
  engineBlown: boolean;

  // 4-Corner Wheel States (0: FL, 1: FR, 2: RL, 3: RR)
  wheels: [IWheelRuntimeState, IWheelRuntimeState, IWheelRuntimeState, IWheelRuntimeState];

  // Progressive Damage (10 zones: 0..1) & Latest Impact Pulse
  damageZones: DamageZoneTuple;
  lastImpact: IVehicleImpactPulse | null;

  // Per-Tick Force Accumulators consumed by physics-rapier
  forceAccumulatorWorld: Vec3;
  torqueAccumulatorWorld: Vec3;
  pointForces: IPointForceRequest[];

  // Lap, Sector & AI State
  aiEnabled: boolean;
  aiTargetPointWorld: Vec3;
  splineProgress: number; // 0..1 along track loop
  lapArmed: boolean;
  checkpointMask: number;
  currentLap: number;
  currentSector: number; // 0, 1, 2
  currentLapTimeMs: number;
  lastLapTimeMs: number | null;
  bestLapTimeMs: number | null;
  lapDeltaMs: number;
  sectorTimesMs: [number, number, number];
  peakLapSpeedKph: number;
  offTrackCount: number;
  lapValid: boolean;
}

export const VehicleBuildConfigSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  chassisId: z.string().min(1).max(60),
  buildSchemaVersion: z.number().int().min(1).optional(),
  buildRevision: z.number().int().min(1).optional(),
  paintHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  accentHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  equippedPartIds: z.record(z.string(), z.string()),
  chassis: z.object({
    drivetrain: z.enum(['FF', 'FR', 'MR', 'RR', 'AWD']),
    frameMaterial: z.enum(['Mild Steel', 'Chromoly', 'Aluminum', 'Carbon Monocoque']),
    wheelbaseM: z.number().min(2.2).max(2.95),
    trackWidthM: z.number().min(1.5).max(2.0),
    rollCage: z.enum(['None', 'Half-Cage', 'Full FIA Welded']),
    ballastMassKg: z.number().min(0).max(100),
    ballastPositionX: z.number().min(-1).max(1),
  }),
  engine: z.object({
    layout: z.enum(['I4', 'Flat-4', 'I6', 'V6', 'V8', 'Rotary']),
    displacementL: z.number().min(1.3).max(6.2),
    blockMaterial: z.enum(['Cast Iron', 'Aluminum Alloy', 'Billet Magnesium']),
    aspiration: z.enum(['Naturally Aspirated', 'Single Turbo', 'Twin-Turbo', 'Supercharger']),
    turboBoostBar: z.number().min(0.0).max(2.5),
    camshaftProfile: z.number().min(0.0).max(1.0),
    revLimiterRpm: z.number().min(5500).max(10000),
    exhaustMaterial: z.enum(['Steel', 'Stainless', 'Titanium', 'Inconel']),
    ecuTune: z.enum(['Eco / Endurance', 'Balanced', 'Qualifying Attack']),
  }),
  drivetrain: z.object({
    gearboxType: z.enum(['5-Spd H', '6-Spd H', '6-Spd Sequential', '7-Spd Dual-Clutch']),
    finalDriveRatio: z.number().min(2.8).max(5.2),
    gearRatios: z.array(z.number().min(0.65).max(4.0)).min(5).max(7),
    flywheelMassKg: z.number().min(3.5).max(12.0),
    differentialType: z.enum(['Open', '1-Way LSD', '1.5-Way LSD', '2-Way LSD', 'Torsen']),
    diffAccelLockPct: z.number().min(0).max(100),
    diffDecelLockPct: z.number().min(0).max(100),
  }),
  suspension: z.object({
    layout: z.enum(['MacPherson Strut', 'Double Wishbone', 'Pushrod Inboard']),
    rideHeightFrontMm: z.number().min(45).max(140),
    rideHeightRearMm: z.number().min(45).max(140),
    springRateFrontNmm: z.number().min(30).max(220),
    springRateRearNmm: z.number().min(30).max(220),
    damperBumpFront: z.number().min(1).max(20),
    damperBumpRear: z.number().min(1).max(20),
    damperReboundFront: z.number().min(1).max(20),
    damperReboundRear: z.number().min(1).max(20),
    arbFrontNmm: z.number().min(10).max(120),
    arbRearNmm: z.number().min(10).max(120),
    camberFrontDeg: z.number().min(-5).max(0),
    camberRearDeg: z.number().min(-5).max(0),
    toeFrontDeg: z.number().min(-1).max(1),
    toeRearDeg: z.number().min(-1).max(1),
    casterFrontDeg: z.number().min(2).max(9),
  }),
  wheelsAndTires: z.object({
    rimMaterial: z.enum(['Steel', 'Cast Alloy', 'Forged Alloy', 'Magnesium', 'Carbon']),
    rimDiameterIn: z.number().min(15).max(20),
    tireWidthFrontMm: z.number().min(195).max(345),
    tireWidthRearMm: z.number().min(195).max(345),
    sidewallProfilePct: z.number().min(30).max(60),
    tireCompound: z.enum(['Street', 'Semi-Slick', 'Hard Slick', 'Med Slick', 'Soft Slick', 'Wet']),
    coldPressurePsi: z.number().min(20).max(38),
  }),
  brakes: z.object({
    rotorDiameterMm: z.number().min(280).max(400),
    rotorMaterial: z.enum(['Cast Iron', 'Slotted Steel', 'Carbon-Ceramic']),
    caliperPistons: z.enum(['2-Pot', '4-Pot', '6-Pot', '8-Pot Monoblock']),
    brakeBiasFrontPct: z.number().min(50).max(75),
    brakeDuctOpeningPct: z.number().min(0).max(100),
  }),
  aero: z.object({
    bodyPanelMaterial: z.enum(['Steel', 'Fiberglass', 'Kevlar', 'Dry Carbon Fiber']),
    frontSplitter: z.enum(['None', 'Street Lip', 'Track Blade', 'GT Pro']),
    rearDiffuser: z.enum(['None', 'Shallow Strakes', 'Deep Venturi']),
    rearWing: z.enum(['None', 'Ducktail', 'GT Wing', 'Swan-Neck Dual Element']),
    wingAngleDeg: z.number().min(0).max(20),
  }),
  fuelAndCooling: z.object({
    fuelLoadL: z.number().min(5).max(80),
    radiatorSpec: z.enum(['Compact', 'Standard', 'Dual-Pass Aluminum', 'Endurance Spec']),
  }),
});
