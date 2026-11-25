import chassisData from './chassis/chassis.json';
import enginePartsData from './parts/engines.json';
import drivetrainPartsData from './parts/drivetrain.json';
import suspensionPartsData from './parts/suspension.json';
import tirePartsData from './parts/tires.json';
import brakePartsData from './parts/brakes.json';
import aeroPartsData from './parts/aero.json';
import coolingPartsData from './parts/cooling.json';

import switchyardSprintData from './tracks/switchyard_sprint.json';
import dockyardDriftParkData from './tracks/dockyard_drift_park.json';
import copperCreekCrossData from './tracks/copper_creek_cross.json';
import terasSwitchbackData from './tracks/teras_switchback.json';
import gpCircuitData from './tracks/gp_circuit.json';
import mountainPassData from './tracks/mountain_pass.json';
import ovalTestData from './tracks/oval_test.json';

import type { IChassisSchema, IPartSchema, ITrackSplineSchema, IVehicleBuildConfig } from '../core/types';

export const CHASSIS_CATALOG = chassisData as unknown as IChassisSchema[];

export const PARTS_CATALOG: IPartSchema[] = [
  ...(enginePartsData as unknown as IPartSchema[]),
  ...(drivetrainPartsData as unknown as IPartSchema[]),
  ...(suspensionPartsData as unknown as IPartSchema[]),
  ...(tirePartsData as unknown as IPartSchema[]),
  ...(brakePartsData as unknown as IPartSchema[]),
  ...(aeroPartsData as unknown as IPartSchema[]),
  ...(coolingPartsData as unknown as IPartSchema[]),
];

export const TRACKS_CATALOG: ITrackSplineSchema[] = [
  switchyardSprintData as unknown as ITrackSplineSchema,
  gpCircuitData as unknown as ITrackSplineSchema,
  mountainPassData as unknown as ITrackSplineSchema,
  ovalTestData as unknown as ITrackSplineSchema,
];

/**
 * Staged courses validated for geometry/clearance but not yet promoted to the playable catalog.
 */
export const STAGED_TRACKS: ITrackSplineSchema[] = [
  dockyardDriftParkData as unknown as ITrackSplineSchema,
  copperCreekCrossData as unknown as ITrackSplineSchema,
  terasSwitchbackData as unknown as ITrackSplineSchema,
];

export const PARTS_BY_ID = new Map<string, IPartSchema>(
  PARTS_CATALOG.map((part) => [part.id, part])
);

export const CHASSIS_BY_ID = new Map<string, IChassisSchema>(
  CHASSIS_CATALOG.map((chassis) => [chassis.id, chassis])
);

export const TRACKS_BY_ID = new Map<string, ITrackSplineSchema>(
  TRACKS_CATALOG.map((track) => [track.id, track])
);

export const STARTER_OWNED_PART_IDS: string[] = [
  ...CHASSIS_CATALOG.filter((c) => c.starterUnlocked).map((c) => c.id),
  ...PARTS_CATALOG.filter((p) => p.starterUnlocked).map((p) => p.id),
];

export function createStarterBuild(): IVehicleBuildConfig {
  return {
    id: 'build_starter_apex',
    name: 'Apex GT-86R Clubsport',
    chassisId: 'chassis_apex_fr',
    paintHex: '#00F0FF',
    accentHex: '#F59E0B',
    equippedPartIds: {
      engineBlockId: 'eng_block_alu',
      aspirationId: 'eng_asp_na',
      exhaustId: 'eng_exh_stainless',
      gearboxId: 'drv_gbx_6h',
      differentialId: 'drv_diff_torsen',
      suspensionId: 'sus_wishbone',
      rimId: 'rim_cast',
      tireCompoundId: 'tire_semislick',
      rotorId: 'brk_rotor_slotted',
      caliperId: 'brk_cal_4pot',
      bodyPanelId: 'aero_body_fiberglass',
      frontSplitterId: 'aero_split_street',
      rearDiffuserId: 'aero_diff_shallow',
      rearWingId: 'aero_wing_ducktail',
      radiatorId: 'cool_rad_standard',
    },
    chassis: {
      drivetrain: 'FR',
      frameMaterial: 'Chromoly',
      wheelbaseM: 2.55,
      trackWidthM: 1.70,
      rollCage: 'Half-Cage',
      ballastMassKg: 10,
      ballastPositionX: -0.25,
    },
    engine: {
      layout: 'Flat-4',
      displacementL: 2.4,
      blockMaterial: 'Aluminum Alloy',
      aspiration: 'Naturally Aspirated',
      turboBoostBar: 0.8,
      camshaftProfile: 0.4,
      revLimiterRpm: 7750,
      exhaustMaterial: 'Stainless',
      ecuTune: 'Balanced',
    },
    drivetrain: {
      gearboxType: '6-Spd H',
      finalDriveRatio: 4.10,
      gearRatios: [3.62, 2.26, 1.64, 1.28, 1.04, 0.86],
      flywheelMassKg: 6.5,
      differentialType: 'Torsen',
      diffAccelLockPct: 45,
      diffDecelLockPct: 20,
    },
    suspension: {
      layout: 'Double Wishbone',
      rideHeightFrontMm: 75,
      rideHeightRearMm: 80,
      springRateFrontNmm: 85,
      springRateRearNmm: 90,
      damperBumpFront: 8,
      damperBumpRear: 8,
      damperReboundFront: 10,
      damperReboundRear: 10,
      arbFrontNmm: 45,
      arbRearNmm: 40,
      camberFrontDeg: -2.4,
      camberRearDeg: -1.8,
      toeFrontDeg: -0.10,
      toeRearDeg: 0.15,
      casterFrontDeg: 6.5,
    },
    wheelsAndTires: {
      rimMaterial: 'Cast Alloy',
      rimDiameterIn: 17,
      tireWidthFrontMm: 235,
      tireWidthRearMm: 245,
      sidewallProfilePct: 40,
      tireCompound: 'Semi-Slick',
      coldPressurePsi: 28.5,
    },
    brakes: {
      rotorDiameterMm: 320,
      rotorMaterial: 'Slotted Steel',
      caliperPistons: '4-Pot',
      brakeBiasFrontPct: 60,
      brakeDuctOpeningPct: 40,
    },
    aero: {
      bodyPanelMaterial: 'Fiberglass',
      frontSplitter: 'Street Lip',
      rearDiffuser: 'Shallow Strakes',
      rearWing: 'Ducktail',
      wingAngleDeg: 6,
    },
    fuelAndCooling: {
      fuelLoadL: 35,
      radiatorSpec: 'Standard',
    },
  };
}
