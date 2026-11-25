import { z } from 'zod';
import type { ITrackSchemaV2Extensions } from '../../contracts/simulation';

export type DrivetrainLayout = 'FF' | 'FR' | 'MR' | 'RR' | 'AWD';
export type FrameMaterial = 'Mild Steel' | 'Chromoly' | 'Aluminum' | 'Carbon Monocoque';
export type RollCageSpec = 'None' | 'Half-Cage' | 'Full FIA Welded';

export type EngineLayout = 'I4' | 'Flat-4' | 'I6' | 'V6' | 'V8' | 'Rotary';
export type BlockMaterial = 'Cast Iron' | 'Aluminum Alloy' | 'Billet Magnesium';
export type AspirationType = 'Naturally Aspirated' | 'Single Turbo' | 'Twin-Turbo' | 'Supercharger';
export type ExhaustMaterial = 'Steel' | 'Stainless' | 'Titanium' | 'Inconel';
export type EcuTuneMap = 'Eco / Endurance' | 'Balanced' | 'Qualifying Attack';

export type GearboxType = '5-Spd H' | '6-Spd H' | '6-Spd Sequential' | '7-Spd Dual-Clutch';
export type DifferentialType = 'Open' | '1-Way LSD' | '1.5-Way LSD' | '2-Way LSD' | 'Torsen';

export type SuspensionLayout = 'MacPherson Strut' | 'Double Wishbone' | 'Pushrod Inboard';

export type RimMaterial = 'Steel' | 'Cast Alloy' | 'Forged Alloy' | 'Magnesium' | 'Carbon';
export type TireCompound = 'Street' | 'Semi-Slick' | 'Hard Slick' | 'Med Slick' | 'Soft Slick' | 'Wet';

export type RotorMaterial = 'Cast Iron' | 'Slotted Steel' | 'Carbon-Ceramic';
export type CaliperPistons = '2-Pot' | '4-Pot' | '6-Pot' | '8-Pot Monoblock';

export type BodyPanelMaterial = 'Steel' | 'Fiberglass' | 'Kevlar' | 'Dry Carbon Fiber';
export type FrontSplitterSpec = 'None' | 'Street Lip' | 'Track Blade' | 'GT Pro';
export type RearDiffuserSpec = 'None' | 'Shallow Strakes' | 'Deep Venturi';
export type RearWingSpec = 'None' | 'Ducktail' | 'GT Wing' | 'Swan-Neck Dual Element';

export type RadiatorSpec = 'Compact' | 'Standard' | 'Dual-Pass Aluminum' | 'Endurance Spec';

export type PartModuleCategory =
  | 'chassis'
  | 'engine'
  | 'drivetrain'
  | 'suspension'
  | 'tires'
  | 'brakes'
  | 'aero'
  | 'cooling';

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

export interface IHardpointMap {
  engineBay: Vec3;
  gearbox: Vec3;
  fuelCell: Vec3;
  radiator: Vec3;
  frontSplitter: Vec3;
  rearDiffuser: Vec3;
  rearWing: Vec3;
  wheelFL: Vec3;
  wheelFR: Vec3;
  wheelRL: Vec3;
  wheelRR: Vec3;
}

export interface IChassisSchema {
  id: string;
  name: string;
  subtitle: string;
  price: number;
  starterUnlocked: boolean;
  defaultDrivetrain: DrivetrainLayout;
  supportedDrivetrains: DrivetrainLayout[];
  baseMassKg: number;
  baseCgHeightM: number;
  baseWheelbaseM: number;
  baseTrackWidthM: number;
  baseFrontalAreaM2: number;
  baseDragCd: number;
  baseTorsionalRigidityNmDeg: number;
  bodyStyle: 'coupe' | 'wedge' | 'hatch' | 'prototype';
  primaryColorHex: string;
  accentColorHex: string;
  hardpoints: IHardpointMap;
}

export interface IPartStatsModifier {
  massKg?: number;
  unsprungMassPerCornerKg?: number;
  rotationalInertiaKgM2?: number;
  cgOffsetY?: number;
  rigidityMultiplier?: number;
  powerMultiplier?: number;
  torqueMultiplier?: number;
  peakRpmBonus?: number;
  dragCdDelta?: number;
  downforceClFront?: number;
  downforceClRear?: number;
  diffuserOptimalRideHeightMm?: [number, number];
  coolingCapacityKw?: number;
  heatGenerationMultiplier?: number;
  shiftTimeMs?: number;
  drivetrainLossPct?: number;
  peakFrictionMu?: number;
  optimalTempWindowC?: [number, number];
  wearRateMultiplier?: number;
  wetGripMultiplier?: number;
  brakeTorqueNm?: number;
  maxSafeTempC?: number;
  coldBiteFactor?: number;
  minRimDiameterIn?: number;
}

export interface IPartSchema {
  id: string;
  module: PartModuleCategory;
  subCategory: string;
  name: string;
  description: string;
  price: number;
  starterUnlocked: boolean;
  specKey: string;
  modifiers: IPartStatsModifier;
}

export interface ITrackControlPoint {
  x: number;
  y: number;
  z: number;
  bankDeg: number;
  widthM?: number;
  kerbLeft?: boolean;
  kerbRight?: boolean;
}

export interface ITrackSplineSchema extends ITrackSchemaV2Extensions {
  id: string;
  name: string;
  country: string;
  description: string;
  difficulty: 'Beginner' | 'Technical' | 'Pro';
  baseLapRewardCredits: number;
  targetGoldTimeMs: number;
  targetSilverTimeMs: number;
  targetBronzeTimeMs: number;
  ambientTempC: number;
  trackTempC: number;
  defaultWidthM: number;
  skyZenithHex: string;
  skyHorizonHex: string;
  sunColorHex: string;
  groundColorHex: string;
  treeDensity: number;
  rockDensity: number;
  closed: boolean;
  sectorFractions: [number, number];
  controlPoints: ITrackControlPoint[];
}

export const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
