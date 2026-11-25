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
import tanjungCoastData from './tracks/tanjung_coast.json';
import quarryTraverseData from './tracks/quarry_traverse.json';
import telagaRidgeLongData from './tracks/telaga_ridge_long.json';
import basaltHighlandsData from './tracks/basalt_highlands.json';
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
  dockyardDriftParkData as unknown as ITrackSplineSchema,
  copperCreekCrossData as unknown as ITrackSplineSchema,
  terasSwitchbackData as unknown as ITrackSplineSchema,
  gpCircuitData as unknown as ITrackSplineSchema,
  mountainPassData as unknown as ITrackSplineSchema,
  ovalTestData as unknown as ITrackSplineSchema,
];

/**
 * Staged rally endurance routes validated for <=2 m sampling, terrain clearance,
 * and Rapier trimesh performance — held out of TRACKS_CATALOG until full endurance playtests.
 */
export const STAGED_TRACKS: ITrackSplineSchema[] = [
  tanjungCoastData as unknown as ITrackSplineSchema,
  quarryTraverseData as unknown as ITrackSplineSchema,
  telagaRidgeLongData as unknown as ITrackSplineSchema,
  basaltHighlandsData as unknown as ITrackSplineSchema,
];

export function isDriftCourse(track: ITrackSplineSchema): boolean {
  return Boolean(
    track.courseTags?.includes('drift') && !track.courseTags?.includes('endurance')
  );
}

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
    name: 'Apex GT-86R Factory',
    chassisId: 'chassis_apex_fr',
    buildSchemaVersion: 2,
    buildRevision: 1,
    paintHex: '#00F0FF',
    accentHex: '#F59E0B',
    equippedPartIds: {
      engineBlockId: 'eng_block_alu',
      aspirationId: 'eng_asp_na',
      exhaustId: 'eng_exh_steel',
      gearboxId: 'drv_gbx_6h',
      differentialId: 'drv_diff_torsen',
      suspensionId: 'sus_wishbone',
      rimId: 'rim_cast',
      tireCompoundId: 'tire_street',
      rotorId: 'brk_rotor_iron',
      caliperId: 'brk_cal_2pot',
      bodyPanelId: 'aero_body_fiberglass',
      frontSplitterId: 'aero_split_none',
      rearDiffuserId: 'aero_diff_none',
      rearWingId: 'aero_wing_none',
      radiatorId: 'cool_rad_standard',
    },
    chassis: {
      drivetrain: 'FR',
      frameMaterial: 'Chromoly',
      wheelbaseM: 2.57,
      trackWidthM: 1.68,
      rollCage: 'None',
      ballastMassKg: 0,
      ballastPositionX: 0.0,
    },
    engine: {
      layout: 'Flat-4',
      displacementL: 2.0,
      blockMaterial: 'Aluminum Alloy',
      aspiration: 'Naturally Aspirated',
      turboBoostBar: 0.0,
      camshaftProfile: 0.45,
      revLimiterRpm: 7250,
      exhaustMaterial: 'Steel',
      ecuTune: 'Balanced',
    },
    drivetrain: {
      gearboxType: '6-Spd H',
      finalDriveRatio: 3.90,
      gearRatios: [3.10, 2.05, 1.48, 1.16, 0.96, 0.80],
      flywheelMassKg: 7.5,
      differentialType: 'Torsen',
      diffAccelLockPct: 35,
      diffDecelLockPct: 15,
    },
    suspension: {
      layout: 'Double Wishbone',
      rideHeightFrontMm: 90,
      rideHeightRearMm: 95,
      springRateFrontNmm: 65,
      springRateRearNmm: 60,
      damperBumpFront: 7,
      damperBumpRear: 7,
      damperReboundFront: 9,
      damperReboundRear: 9,
      arbFrontNmm: 32,
      arbRearNmm: 26,
      camberFrontDeg: -1.6,
      camberRearDeg: -1.2,
      toeFrontDeg: -0.05,
      toeRearDeg: 0.12,
      casterFrontDeg: 6.0,
    },
    wheelsAndTires: {
      rimMaterial: 'Cast Alloy',
      rimDiameterIn: 17,
      tireWidthFrontMm: 215,
      tireWidthRearMm: 215,
      sidewallProfilePct: 45,
      tireCompound: 'Street',
      coldPressurePsi: 30.0,
    },
    brakes: {
      rotorDiameterMm: 300,
      rotorMaterial: 'Cast Iron',
      caliperPistons: '2-Pot',
      brakeBiasFrontPct: 62,
      brakeDuctOpeningPct: 30,
    },
    aero: {
      bodyPanelMaterial: 'Fiberglass',
      frontSplitter: 'None',
      rearDiffuser: 'None',
      rearWing: 'None',
      wingAngleDeg: 0,
    },
    fuelAndCooling: {
      fuelLoadL: 30,
      radiatorSpec: 'Standard',
    },
  };
}
