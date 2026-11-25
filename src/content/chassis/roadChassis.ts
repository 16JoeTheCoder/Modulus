import type { IChassisSchema, Vec3 } from '../../core/types';

type RoadChassis = Omit<IChassisSchema, 'hardpoints' | 'price' | 'starterUnlocked'> & {
  roadGeometry: NonNullable<IChassisSchema['roadGeometry']>;
};

function roadChassis(spec: RoadChassis): IChassisSchema {
  const halfWheelbase = spec.baseWheelbaseM / 2;
  const halfTrack = spec.baseTrackWidthM / 2;
  const { frontOverhangM, rearOverhangM, collisionBottomM, hoodCam } = spec.roadGeometry;
  const front = halfWheelbase + frontOverhangM;
  const rear = -(halfWheelbase + rearOverhangM);
  const point = (y: number, z: number, x = 0): Vec3 => ({ x, y, z });
  return {
    ...spec,
    price: 0,
    starterUnlocked: true,
    hardpoints: {
      engineBay: point(collisionBottomM + 0.29, halfWheelbase * 0.52),
      gearbox: point(collisionBottomM + 0.13, spec.defaultDrivetrain === 'RR' ? -halfWheelbase * 0.62 : 0.16),
      fuelCell: point(collisionBottomM + 0.15, -halfWheelbase * 0.55),
      radiator: point(collisionBottomM + 0.25, front - 0.43),
      frontSplitter: point(collisionBottomM, front - 0.06),
      rearDiffuser: point(collisionBottomM, rear + 0.08),
      rearWing: point(hoodCam.y - 0.1, rear + 0.17),
      wheelFL: point(0.35, halfWheelbase, halfTrack),
      wheelFR: point(0.35, halfWheelbase, -halfTrack),
      wheelRL: point(0.35, -halfWheelbase, halfTrack),
      wheelRR: point(0.35, -halfWheelbase, -halfTrack),
    },
  };
}

export const ROAD_CHASSIS = [
  roadChassis({
    id: 'chassis_dovetail_fr', name: 'Dovetail 2.5',
    subtitle: 'RWD drift sedan · Progressive slides, slower transitions',
    defaultDrivetrain: 'FR', supportedDrivetrains: ['FR', 'AWD'],
    baseMassKg: 969, baseCgHeightM: 0.49, baseWheelbaseM: 2.78, baseTrackWidthM: 1.61,
    baseFrontalAreaM2: 2.1, baseDragCd: 0.32, baseTorsionalRigidityNmDeg: 22000,
    bodyStyle: 'sedan', primaryColorHex: '#693EA3', accentColorHex: '#E8B655',
    roadGeometry: {
      frontOverhangM: 0.83, rearOverhangM: 0.93, collisionBottomM: 0.17, collisionTopM: 0.88,
      eye: { x: 0.34, y: 1.23, z: -0.03 }, steeringWheel: { x: 0.34, y: 0.99, z: 0.40 },
      hoodCam: { x: 0, y: 1.05, z: 0.99 }, steeringLockDeg: 37, chassisCgZ: 0.03,
    },
  }),
  roadChassis({
    id: 'chassis_quarry_fr', name: 'Quarry 240',
    subtitle: 'Diesel work pickup · Early torque, light rear axle',
    defaultDrivetrain: 'FR', supportedDrivetrains: ['FR', 'AWD'],
    baseMassKg: 1340, baseCgHeightM: 0.69, baseWheelbaseM: 3.16, baseTrackWidthM: 1.73,
    baseFrontalAreaM2: 2.79, baseDragCd: 0.43, baseTorsionalRigidityNmDeg: 18200,
    bodyStyle: 'pickup', primaryColorHex: '#C57035', accentColorHex: '#F1D89C',
    roadGeometry: {
      frontOverhangM: 0.84, rearOverhangM: 1.03, collisionBottomM: 0.29, collisionTopM: 1.06,
      eye: { x: 0.36, y: 1.51, z: 0.31 }, steeringWheel: { x: 0.36, y: 1.23, z: 0.73 },
      hoodCam: { x: 0, y: 1.29, z: 1.26 }, steeringLockDeg: 32, chassisCgZ: 0.20,
    },
  }),
  roadChassis({
    id: 'chassis_lantern_ff', name: 'Lantern MPV',
    subtitle: 'Front-drive minivan · Clear sightlines, more body roll',
    defaultDrivetrain: 'FF', supportedDrivetrains: ['FF', 'AWD'],
    baseMassKg: 1164, baseCgHeightM: 0.65, baseWheelbaseM: 2.86, baseTrackWidthM: 1.64,
    baseFrontalAreaM2: 2.76, baseDragCd: 0.37, baseTorsionalRigidityNmDeg: 20200,
    bodyStyle: 'minivan', primaryColorHex: '#7B9BAB', accentColorHex: '#E8E1D7',
    roadGeometry: {
      frontOverhangM: 0.77, rearOverhangM: 0.92, collisionBottomM: 0.20, collisionTopM: 1.15,
      eye: { x: 0.35, y: 1.55, z: 0.57 }, steeringWheel: { x: 0.35, y: 1.28, z: 1.00 },
      hoodCam: { x: 0, y: 1.28, z: 1.54 }, steeringLockDeg: 34, chassisCgZ: 0.12,
    },
  }),
  roadChassis({
    id: 'chassis_pippin_rr', name: 'Pippin 660',
    subtitle: 'Rear-engine city car · Tiny footprint, quick lift-off rotation',
    defaultDrivetrain: 'RR', supportedDrivetrains: ['RR'],
    baseMassKg: 380, baseCgHeightM: 0.46, baseWheelbaseM: 2.08, baseTrackWidthM: 1.30,
    baseFrontalAreaM2: 1.62, baseDragCd: 0.36, baseTorsionalRigidityNmDeg: 14000,
    bodyStyle: 'microcar', primaryColorHex: '#E1B738', accentColorHex: '#F4EBD1',
    roadGeometry: {
      frontOverhangM: 0.41, rearOverhangM: 0.53, collisionBottomM: 0.18, collisionTopM: 0.86,
      eye: { x: 0.28, y: 1.20, z: 0.18 }, steeringWheel: { x: 0.28, y: 0.95, z: 0.57 },
      hoodCam: { x: 0, y: 0.99, z: 0.98 }, steeringLockDeg: 36, chassisCgZ: -0.07,
    },
  }),
  roadChassis({
    id: 'chassis_mica_ff', name: 'Mica S',
    subtitle: 'Front-drive hatchback · Easy wet balance, limited exit traction',
    defaultDrivetrain: 'FF', supportedDrivetrains: ['FF', 'AWD'],
    baseMassKg: 578, baseCgHeightM: 0.47, baseWheelbaseM: 2.39, baseTrackWidthM: 1.49,
    baseFrontalAreaM2: 1.86, baseDragCd: 0.33, baseTorsionalRigidityNmDeg: 17700,
    bodyStyle: 'hatch', primaryColorHex: '#B6464D', accentColorHex: '#F5DDC5',
    roadGeometry: {
      frontOverhangM: 0.69, rearOverhangM: 0.57, collisionBottomM: 0.16, collisionTopM: 0.87,
      eye: { x: 0.31, y: 1.15, z: 0.09 }, steeringWheel: { x: 0.31, y: 0.92, z: 0.52 },
      hoodCam: { x: 0, y: 0.99, z: 1.10 }, steeringLockDeg: 34, chassisCgZ: 0.15,
    },
  }),
  roadChassis({
    id: 'chassis_serrac_awd', name: 'Serrac Touring',
    subtitle: 'All-wheel-drive wagon · Secure exits, slower turn-in',
    defaultDrivetrain: 'AWD', supportedDrivetrains: ['AWD', 'FF'],
    baseMassKg: 1008, baseCgHeightM: 0.49, baseWheelbaseM: 2.72, baseTrackWidthM: 1.58,
    baseFrontalAreaM2: 2.18, baseDragCd: 0.32, baseTorsionalRigidityNmDeg: 24000,
    bodyStyle: 'wagon', primaryColorHex: '#3A7862', accentColorHex: '#E1A350',
    roadGeometry: {
      frontOverhangM: 0.85, rearOverhangM: 0.90, collisionBottomM: 0.19, collisionTopM: 0.88,
      eye: { x: 0.33, y: 1.24, z: 0.02 }, steeringWheel: { x: 0.33, y: 1.00, z: 0.45 },
      hoodCam: { x: 0, y: 1.06, z: 1.13 }, steeringLockDeg: 31, chassisCgZ: 0.07,
    },
  }),
  roadChassis({
    id: 'chassis_juniper_fr', name: 'Juniper Club',
    subtitle: 'Lightweight roadster · Carries speed, modest straight-line pull',
    defaultDrivetrain: 'FR', supportedDrivetrains: ['FR'],
    baseMassKg: 462, baseCgHeightM: 0.40, baseWheelbaseM: 2.27, baseTrackWidthM: 1.47,
    baseFrontalAreaM2: 1.55, baseDragCd: 0.36, baseTorsionalRigidityNmDeg: 14600,
    bodyStyle: 'roadster', primaryColorHex: '#19549C', accentColorHex: '#E9D9B1',
    roadGeometry: {
      frontOverhangM: 0.74, rearOverhangM: 0.61, collisionBottomM: 0.15, collisionTopM: 0.72,
      eye: { x: 0.30, y: 1.03, z: -0.20 }, steeringWheel: { x: 0.30, y: 0.81, z: 0.22 },
      hoodCam: { x: 0, y: 0.90, z: 0.83 }, steeringLockDeg: 34, chassisCgZ: -0.03,
    },
  }),
  roadChassis({
    id: 'chassis_broadside_fr', name: 'Broadside 440',
    subtitle: 'Long-wheelbase V8 coupe · Strong pull, needs early braking',
    defaultDrivetrain: 'FR', supportedDrivetrains: ['FR'],
    baseMassKg: 1247, baseCgHeightM: 0.55, baseWheelbaseM: 3.02, baseTrackWidthM: 1.69,
    baseFrontalAreaM2: 2.23, baseDragCd: 0.40, baseTorsionalRigidityNmDeg: 18500,
    bodyStyle: 'muscle', primaryColorHex: '#9D3E2C', accentColorHex: '#D6C7A6',
    roadGeometry: {
      frontOverhangM: 0.99, rearOverhangM: 1.06, collisionBottomM: 0.19, collisionTopM: 0.90,
      eye: { x: 0.33, y: 1.19, z: -0.22 }, steeringWheel: { x: 0.33, y: 0.96, z: 0.22 },
      hoodCam: { x: 0, y: 1.08, z: 1.15 }, steeringLockDeg: 33, chassisCgZ: 0.13,
    },
  }),
];
