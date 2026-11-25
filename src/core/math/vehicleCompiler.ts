import { CHASSIS_BY_ID, CHASSIS_CATALOG, PARTS_BY_ID } from '../../content';
import type { IVehicleCollisionHull } from '../../contracts/simulation';
import type {
  ICompiledVehicle,
  IDynoPoint,
  IEngineeringWarning,
  IGlobalBalanceConfig,
  ISpiderMetrics,
  IVehicleBuildConfig,
  Vec3,
} from '../types';

const FRAME_MASS_MULT: Record<IVehicleBuildConfig['chassis']['frameMaterial'], number> = {
  'Mild Steel': 1.08,
  Chromoly: 0.98,
  Aluminum: 0.87,
  'Carbon Monocoque': 0.74,
};

const FRAME_RIGIDITY_MULT: Record<IVehicleBuildConfig['chassis']['frameMaterial'], number> = {
  'Mild Steel': 0.9,
  Chromoly: 1.08,
  Aluminum: 1.15,
  'Carbon Monocoque': 1.48,
};

const FRAME_COST: Record<IVehicleBuildConfig['chassis']['frameMaterial'], number> = {
  'Mild Steel': 0,
  Chromoly: 3200,
  Aluminum: 9500,
  'Carbon Monocoque': 28000,
};

const CAGE_MASS_KG: Record<IVehicleBuildConfig['chassis']['rollCage'], number> = {
  None: 0,
  'Half-Cage': 18,
  'Full FIA Welded': 42,
};

const CAGE_RIGIDITY_MULT: Record<IVehicleBuildConfig['chassis']['rollCage'], number> = {
  None: 1.0,
  'Half-Cage': 1.18,
  'Full FIA Welded': 1.4,
};

const ENGINE_LAYOUT_SPECS: Record<
  IVehicleBuildConfig['engine']['layout'],
  { massMult: number; cgDeltaY: number; torquePerLiterNm: number; baseRedline: number; fuelMult: number }
> = {
  I4: { massMult: 0.9, cgDeltaY: 0.0, torquePerLiterNm: 102, baseRedline: 7600, fuelMult: 0.92 },
  'Flat-4': { massMult: 0.95, cgDeltaY: -0.045, torquePerLiterNm: 93, baseRedline: 7200, fuelMult: 0.96 },
  I6: { massMult: 1.12, cgDeltaY: 0.015, torquePerLiterNm: 108, baseRedline: 7800, fuelMult: 1.02 },
  V6: { massMult: 1.06, cgDeltaY: 0.005, torquePerLiterNm: 112, baseRedline: 8200, fuelMult: 1.0 },
  V8: { massMult: 1.26, cgDeltaY: 0.02, torquePerLiterNm: 116, baseRedline: 7400, fuelMult: 1.16 },
  Rotary: { massMult: 0.72, cgDeltaY: -0.035, torquePerLiterNm: 124, baseRedline: 9500, fuelMult: 1.38 },
};

const CHASSIS_COCKPIT_ANCHORS: Record<
  string,
  { cockpitEyeLocal: Vec3; steeringWheelLocal: Vec3; hoodCamLocal: Vec3 }
> = {
  chassis_apex_fr: {
    cockpitEyeLocal: { x: 0.34, y: 1.06, z: -0.08 },
    steeringWheelLocal: { x: 0.34, y: 0.84, z: 0.38 },
    hoodCamLocal: { x: 0.0, y: 1.10, z: 0.72 },
  },
  chassis_stratos_mr: {
    cockpitEyeLocal: { x: 0.32, y: 0.96, z: 0.04 },
    steeringWheelLocal: { x: 0.32, y: 0.76, z: 0.46 },
    hoodCamLocal: { x: 0.0, y: 0.98, z: 0.78 },
  },
  chassis_valkyrie_proto: {
    cockpitEyeLocal: { x: 0.0, y: 0.90, z: 0.14 },
    steeringWheelLocal: { x: 0.0, y: 0.72, z: 0.56 },
    hoodCamLocal: { x: 0.0, y: 0.92, z: 0.92 },
  },
};

const DRIVETRAIN_LOSS: Record<IVehicleBuildConfig['chassis']['drivetrain'], { eff: number; extraMassKg: number }> = {
  FF: { eff: 0.95, extraMassKg: -14 },
  FR: { eff: 0.93, extraMassKg: 0 },
  MR: { eff: 0.94, extraMassKg: -8 },
  RR: { eff: 0.94, extraMassKg: -6 },
  AWD: { eff: 0.88, extraMassKg: 58 },
};

/**
 * Deterministic Vehicle Compiler
 * Converts any `IVehicleBuildConfig` + active `IGlobalBalanceConfig` into `ICompiledVehicle`.
 */
export function compileVehicleBuild(
  build: IVehicleBuildConfig,
  balanceConfig: IGlobalBalanceConfig
): ICompiledVehicle {
  const chassis = CHASSIS_BY_ID.get(build.chassisId) ?? CHASSIS_CATALOG[0];

  const getPart = (id: string) => PARTS_BY_ID.get(id);
  const blockPart = getPart(build.equippedPartIds.engineBlockId);
  const aspPart = getPart(build.equippedPartIds.aspirationId);
  const exhPart = getPart(build.equippedPartIds.exhaustId);
  const gbxPart = getPart(build.equippedPartIds.gearboxId);
  const diffPart = getPart(build.equippedPartIds.differentialId);
  const susPart = getPart(build.equippedPartIds.suspensionId);
  const rimPart = getPart(build.equippedPartIds.rimId);
  const tirePart = getPart(build.equippedPartIds.tireCompoundId);
  const rotorPart = getPart(build.equippedPartIds.rotorId);
  const calPart = getPart(build.equippedPartIds.caliperId);
  const bodyPart = getPart(build.equippedPartIds.bodyPanelId);
  const splitPart = getPart(build.equippedPartIds.frontSplitterId);
  const diffAeroPart = getPart(build.equippedPartIds.rearDiffuserId);
  const wingPart = getPart(build.equippedPartIds.rearWingId);
  const radPart = getPart(build.equippedPartIds.radiatorId);

  const layoutSpec = ENGINE_LAYOUT_SPECS[build.engine.layout];
  const drvSpec = DRIVETRAIN_LOSS[build.chassis.drivetrain];

  // 1. Mass, CG & Inertia
  const frameMass = chassis.baseMassKg * FRAME_MASS_MULT[build.chassis.frameMaterial];
  const cageMass = CAGE_MASS_KG[build.chassis.rollCage];
  const dispScale = 0.72 + (build.engine.displacementL / 2.5) * 0.34;
  const engineCoreMass = (blockPart?.modifiers.massKg ?? 130) * layoutSpec.massMult * dispScale;
  const aspirationMass = aspPart?.modifiers.massKg ?? 8;
  const exhaustMass = exhPart?.modifiers.massKg ?? 20;
  const gearboxMass = (gbxPart?.modifiers.massKg ?? 48) + build.drivetrain.flywheelMassKg;
  const diffMass = diffPart?.modifiers.massKg ?? 20;
  const bodyMass = bodyPart?.modifiers.massKg ?? 75;
  const aeroAddonsMass =
    (splitPart?.modifiers.massKg ?? 0) +
    (diffAeroPart?.modifiers.massKg ?? 0) +
    (wingPart?.modifiers.massKg ?? 0);
  const radiatorMass = radPart?.modifiers.massKg ?? 12;

  const rimRadiusM = (build.wheelsAndTires.rimDiameterIn * 0.0254) / 2;
  const sidewallFrontM = (build.wheelsAndTires.tireWidthFrontMm / 1000) * (build.wheelsAndTires.sidewallProfilePct / 100);
  const sidewallRearM = (build.wheelsAndTires.tireWidthRearMm / 1000) * (build.wheelsAndTires.sidewallProfilePct / 100);
  const wheelRadiusFrontM = Math.max(0.27, rimRadiusM + sidewallFrontM);
  const wheelRadiusRearM = Math.max(0.27, rimRadiusM + sidewallRearM);

  const rotorSizeScale = build.brakes.rotorDiameterMm / 320;
  const unsprungFront =
    (susPart?.modifiers.unsprungMassPerCornerKg ?? 12) +
    (rimPart?.modifiers.unsprungMassPerCornerKg ?? 9.5) * (build.wheelsAndTires.rimDiameterIn / 17) +
    (rotorPart?.modifiers.unsprungMassPerCornerKg ?? 7) * rotorSizeScale +
    (build.wheelsAndTires.tireWidthFrontMm / 235) * 9.5;
  const unsprungRear =
    (susPart?.modifiers.unsprungMassPerCornerKg ?? 12) +
    (rimPart?.modifiers.unsprungMassPerCornerKg ?? 9.5) * (build.wheelsAndTires.rimDiameterIn / 17) +
    (rotorPart?.modifiers.unsprungMassPerCornerKg ?? 7) * rotorSizeScale * 0.92 +
    (build.wheelsAndTires.tireWidthRearMm / 235) * 9.5;

  const totalUnsprungKg = unsprungFront * 2 + unsprungRear * 2;
  const dryMassKg =
    frameMass +
    cageMass +
    drvSpec.extraMassKg +
    build.chassis.ballastMassKg +
    engineCoreMass +
    aspirationMass +
    exhaustMass +
    gearboxMass +
    diffMass +
    bodyMass +
    aeroAddonsMass +
    radiatorMass +
    totalUnsprungKg;

  const fuelMassKg = build.fuelAndCooling.fuelLoadL * 0.75;
  const totalMassKg = Math.max(620, dryMassKg + fuelMassKg);

  // Longitudinal Engine Bay Z by Drivetrain Layout
  const wheelbaseM = build.chassis.wheelbaseM;
  const halfWb = wheelbaseM * 0.5;
  const trackWidthM = build.chassis.trackWidthM;
  const halfTrack = trackWidthM * 0.5;

  let engineZ = chassis.hardpoints.engineBay.z;
  if (build.chassis.drivetrain === 'FF') engineZ = halfWb * 0.78;
  else if (build.chassis.drivetrain === 'FR') engineZ = halfWb * 0.52;
  else if (build.chassis.drivetrain === 'MR') engineZ = -halfWb * 0.34;
  else if (build.chassis.drivetrain === 'RR') engineZ = -halfWb * 0.76;
  else if (build.chassis.drivetrain === 'AWD') {
    engineZ = chassis.defaultDrivetrain === 'MR' ? -halfWb * 0.28 : halfWb * 0.44;
  }

  const weightedZ =
    (frameMass + bodyMass) * 0.0 +
    (engineCoreMass + aspirationMass) * engineZ +
    radiatorMass * (halfWb * 0.92) +
    exhaustMass * (-halfWb * 0.75) +
    gearboxMass * (engineZ > 0 ? 0.08 : -halfWb * 0.62) +
    diffMass * (build.chassis.drivetrain === 'FF' ? halfWb * 0.72 : -halfWb * 0.85) +
    fuelMassKg * (-halfWb * 0.28) +
    build.chassis.ballastMassKg * (build.chassis.ballastPositionX * halfWb * 0.85) +
    unsprungFront * 2 * halfWb +
    unsprungRear * 2 * -halfWb;

  const cgZ = Math.max(-halfWb * 0.42, Math.min(halfWb * 0.42, weightedZ / totalMassKg));
  const frontWeightDistributionPct = Math.max(30, Math.min(70, 50 + (cgZ / wheelbaseM) * 100));

  const avgRideHeightM = (build.suspension.rideHeightFrontMm + build.suspension.rideHeightRearMm) / 2000;
  const cageCgDelta = build.chassis.rollCage === 'Full FIA Welded' ? 0.022 : build.chassis.rollCage === 'Half-Cage' ? 0.01 : 0;
  const cgHeightM = Math.max(
    0.31,
    chassis.baseCgHeightM +
      (avgRideHeightM - 0.08) * 0.85 +
      layoutSpec.cgDeltaY +
      cageCgDelta +
      (bodyPart?.modifiers.cgOffsetY ?? 0) +
      (susPart?.modifiers.cgOffsetY ?? 0)
  );

  const cgPositionLocal: Vec3 = { x: 0, y: cgHeightM, z: cgZ };

  const inertiaBias = balanceConfig.physics_bias.weight_inertia_mult;
  const baseYawInertia = totalMassKg * (wheelbaseM * wheelbaseM + trackWidthM * trackWidthM) * 0.145;
  const basePitchInertia = totalMassKg * (wheelbaseM * wheelbaseM + cgHeightM * cgHeightM) * 0.135;
  const baseRollInertia = totalMassKg * (trackWidthM * trackWidthM + cgHeightM * cgHeightM) * 0.11;

  const yawInertiaKgM2 = baseYawInertia * inertiaBias;
  const pitchInertiaKgM2 = basePitchInertia * inertiaBias;
  const rollInertiaKgM2 = baseRollInertia * inertiaBias;

  const torsionalRigidityNmDeg =
    chassis.baseTorsionalRigidityNmDeg *
    FRAME_RIGIDITY_MULT[build.chassis.frameMaterial] *
    CAGE_RIGIDITY_MULT[build.chassis.rollCage] *
    (susPart?.modifiers.rigidityMultiplier ?? 1.0);

  // 2. Dyno Curve & Powertrain
  const idleRpm = build.engine.layout === 'Rotary' ? 1150 : 900;
  const revLimiterRpm = build.engine.revLimiterRpm;
  const redlineRpm = Math.max(idleRpm + 2000, revLimiterRpm - 350);

  const isForced = build.engine.aspiration !== 'Naturally Aspirated';
  const maxBoostBar = isForced ? build.engine.turboBoostBar : 0;
  const ecuPowerMult =
    build.engine.ecuTune === 'Qualifying Attack' ? 1.055 : build.engine.ecuTune === 'Eco / Endurance' ? 0.93 : 1.0;
  const exhPowerMult = exhPart?.modifiers.powerMultiplier ?? 1.0;

  const cam = build.engine.camshaftProfile; // 0..1
  const optimalTorqueRpm = 3400 + cam * 3100 + (build.engine.layout === 'Rotary' ? 1200 : 0);

  const dynoCurve: IDynoPoint[] = [];
  let peakTorqueNm = 0;
  let peakTorqueRpm = idleRpm;
  let peakPowerHp = 0;
  let peakPowerRpm = idleRpm;

  for (let rpm = 1000; rpm <= revLimiterRpm; rpm += 250) {
    const rpmNorm = (rpm - optimalTorqueRpm) / 2900;
    const volumetricEff = Math.max(
      0.52,
      1.04 - 0.28 * rpmNorm * rpmNorm + cam * 0.08 * ((rpm - 4500) / 4000) - (1 - cam) * 0.06 * ((rpm - 5500) / 3500)
    );

    let boostAtRpm = 0;
    if (build.engine.aspiration === 'Single Turbo') {
      const spoolThreshold = 3400 + maxBoostBar * 450;
      const spoolFactor = 1 / (1 + Math.exp(-(rpm - spoolThreshold) / 520));
      boostAtRpm = maxBoostBar * spoolFactor;
    } else if (build.engine.aspiration === 'Twin-Turbo') {
      const spoolThreshold = 2550 + maxBoostBar * 320;
      const spoolFactor = 1 / (1 + Math.exp(-(rpm - spoolThreshold) / 440));
      boostAtRpm = maxBoostBar * spoolFactor;
    } else if (build.engine.aspiration === 'Supercharger') {
      boostAtRpm = maxBoostBar * (0.55 + 0.45 * (rpm / revLimiterRpm));
    }

    const boostPressureMult =
      build.engine.aspiration === 'Supercharger'
        ? 1 + boostAtRpm * 0.62 - 0.05 * Math.pow(rpm / revLimiterRpm, 2)
        : 1 + boostAtRpm * 0.72;

    const frictionDrop = rpm > optimalTorqueRpm + 1600 ? (rpm - (optimalTorqueRpm + 1600)) * 0.00008 : 0;
    const torqueNm = Math.max(
      45,
      build.engine.displacementL *
        layoutSpec.torquePerLiterNm *
        volumetricEff *
        boostPressureMult *
        ecuPowerMult *
        exhPowerMult *
        (1 - frictionDrop)
    );
    const powerHp = (torqueNm * rpm) / 7127;

    if (torqueNm > peakTorqueNm) {
      peakTorqueNm = torqueNm;
      peakTorqueRpm = rpm;
    }
    if (powerHp > peakPowerHp) {
      peakPowerHp = powerHp;
      peakPowerRpm = rpm;
    }

    dynoCurve.push({
      rpm,
      torqueNm: Math.round(torqueNm * 10) / 10,
      powerHp: Math.round(powerHp * 10) / 10,
      boostBar: Math.round(boostAtRpm * 100) / 100,
    });
  }

  const pwrRatioHpPerKg = peakPowerHp / totalMassKg;
  const shiftDurationSeconds = (gbxPart?.modifiers.shiftTimeMs ?? 175) / 1000;
  const baseTurboSpool =
    build.engine.aspiration === 'Twin-Turbo' ? 5.8 : build.engine.aspiration === 'Single Turbo' ? 3.8 : 14.0;
  const turboSpoolRate = baseTurboSpool / Math.max(0.25, balanceConfig.physics_bias.turbo_lag_mult);

  const ecuFuelMult =
    build.engine.ecuTune === 'Qualifying Attack' ? 1.25 : build.engine.ecuTune === 'Eco / Endurance' ? 0.82 : 1.0;
  const fuelBurnRateLPerSecAtMaxPower =
    (peakPowerHp * 0.000095 * layoutSpec.fuelMult * ecuFuelMult * (1 + maxBoostBar * 0.18));

  // 3. Aerodynamics
  const frontalAreaM2 = chassis.baseFrontalAreaM2 * (build.chassis.trackWidthM / chassis.baseTrackWidthM);
  const wingAngleFactor = build.aero.rearWing === 'None' ? 0 : 0.35 + (build.aero.wingAngleDeg / 20) * 0.95;
  const brakeDuctDrag = (build.brakes.brakeDuctOpeningPct / 100) * 0.018;

  const liftCoefficientFrontCl =
    (splitPart?.modifiers.downforceClFront ?? 0.05) + 0.06;
  const diffuserBaseRearCl = diffAeroPart?.modifiers.downforceClRear ?? 0.04;
  const wingRearCl = (wingPart?.modifiers.downforceClRear ?? 0) * wingAngleFactor;
  const liftCoefficientRearCl = diffuserBaseRearCl + wingRearCl;

  const dragCoefficientCd = Math.max(
    0.20,
    chassis.baseDragCd +
      (splitPart?.modifiers.dragCdDelta ?? 0) +
      (diffAeroPart?.modifiers.dragCdDelta ?? 0) +
      (wingPart?.modifiers.dragCdDelta ?? 0) * (0.45 + 0.75 * (build.aero.wingAngleDeg / 20)) +
      (radPart?.modifiers.dragCdDelta ?? 0) +
      brakeDuctDrag
  );

  const totalCl = liftCoefficientFrontCl + liftCoefficientRearCl;
  const aeroBalanceFrontPct = totalCl > 0.01 ? (liftCoefficientFrontCl / totalCl) * 100 : 50;
  const diffuserOptimalRideHeightMm: [number, number] =
    diffAeroPart?.modifiers.diffuserOptimalRideHeightMm ?? [40, 150];

  // 4. Wheels, Tires & Brakes
  const baseCompoundMu = tirePart?.modifiers.peakFrictionMu ?? 1.2;
  const pressureDelta = Math.abs(build.wheelsAndTires.coldPressurePsi - 28.5);
  const pressureFactor = Math.max(0.90, 1.0 - pressureDelta * 0.0075);
  const widthFactorFront = 0.92 + ((build.wheelsAndTires.tireWidthFrontMm - 195) / 150) * 0.16;
  const widthFactorRear = 0.92 + ((build.wheelsAndTires.tireWidthRearMm - 195) / 150) * 0.16;

  const peakTireMuFront = baseCompoundMu * widthFactorFront * pressureFactor;
  const peakTireMuRear = baseCompoundMu * widthFactorRear * pressureFactor;

  const sidewallNorm = (60 - build.wheelsAndTires.sidewallProfilePct) / 30; // 0 (tall) .. 1 (low profile)
  const pacejkaB = 8.8 + sidewallNorm * 4.2;
  const pacejkaC = 1.32 + sidewallNorm * 0.16;
  const pacejkaE = -0.55 + sidewallNorm * 0.35;

  const baseCaliperTorque = (calPart?.modifiers.brakeTorqueNm ?? 3000) * rotorSizeScale;
  const biasFront = build.brakes.brakeBiasFrontPct / 100;
  const maxBrakeTorquePerAxleFrontNm = baseCaliperTorque * 2 * biasFront;
  const maxBrakeTorquePerAxleRearNm = baseCaliperTorque * 2 * (1 - biasFront);

  const rimInertia = (rimPart?.modifiers.rotationalInertiaKgM2 ?? 0.9) * Math.pow(wheelRadiusFrontM / 0.32, 2);
  const wheelRotationalInertiaKgM2: [number, number, number, number] = [
    rimInertia,
    rimInertia,
    rimInertia * (wheelRadiusRearM / wheelRadiusFrontM),
    rimInertia * (wheelRadiusRearM / wheelRadiusFrontM),
  ];

  // 5. Hardpoints & Suspension Rest Length
  const restFrontM = 0.22 + build.suspension.rideHeightFrontMm / 1000;
  const restRearM = 0.22 + build.suspension.rideHeightRearMm / 1000;
  const suspensionRestLengthM: [number, number, number, number] = [
    restFrontM,
    restFrontM,
    restRearM,
    restRearM,
  ];

  const wheelPositionsLocal: [Vec3, Vec3, Vec3, Vec3] = [
    { x: halfTrack, y: wheelRadiusFrontM + 0.04, z: halfWb }, // FL (+X = Left, +Z = Forward)
    { x: -halfTrack, y: wheelRadiusFrontM + 0.04, z: halfWb }, // FR (-X = Right, +Z = Forward)
    { x: halfTrack, y: wheelRadiusRearM + 0.04, z: -halfWb }, // RL
    { x: -halfTrack, y: wheelRadiusRearM + 0.04, z: -halfWb }, // RR
  ];

  const scaledHardpoints = {
    ...chassis.hardpoints,
    engineBay: { x: 0, y: chassis.hardpoints.engineBay.y + layoutSpec.cgDeltaY, z: engineZ },
    wheelFL: wheelPositionsLocal[0],
    wheelFR: wheelPositionsLocal[1],
    wheelRL: wheelPositionsLocal[2],
    wheelRR: wheelPositionsLocal[3],
  };

  // 6. Thermals
  const radiatorCoolingKw = radPart?.modifiers.coolingCapacityKw ?? 64;
  const engineMaxSafeTempC = blockPart?.modifiers.maxSafeTempC ?? 116;
  const engineHeatMultiplier =
    (blockPart?.modifiers.heatGenerationMultiplier ?? 1.0) *
    (aspPart?.modifiers.heatGenerationMultiplier ?? 1.0) *
    (exhPart?.modifiers.heatGenerationMultiplier ?? 1.0) *
    (build.engine.ecuTune === 'Qualifying Attack' ? 1.22 : build.engine.ecuTune === 'Eco / Endurance' ? 0.85 : 1.0);
  const brakeCoolingFactor = 0.45 + (build.brakes.brakeDuctOpeningPct / 100) * 1.15;

  // 7. Top Speed, Spider Metrics & Engineering Warnings
  const topGearRatio = build.drivetrain.gearRatios[build.drivetrain.gearRatios.length - 1] ?? 0.86;
  const gearingMaxSpeedMs =
    ((revLimiterRpm / 60) * 2 * Math.PI * wheelRadiusRearM) /
    (topGearRatio * build.drivetrain.finalDriveRatio);
  const effDragCd = dragCoefficientCd * balanceConfig.physics_bias.aero_drag_mult;
  const aeroMaxSpeedMs = Math.cbrt(
    (peakPowerHp * 745.7 * drvSpec.eff) / Math.max(0.15, 0.5 * 1.225 * frontalAreaM2 * effDragCd)
  );
  const estimatedTopSpeedKph = Math.round(Math.min(gearingMaxSpeedMs, aeroMaxSpeedMs) * 3.6);

  const spider: ISpiderMetrics = {
    acceleration: clamp100((pwrRatioHpPerKg / 0.48) * 78 + (5.2 - shiftDurationSeconds * 10) * 4),
    topSpeed: clamp100(((estimatedTopSpeedKph - 160) / 195) * 100),
    corneringG: clamp100(
      (((peakTireMuFront + peakTireMuRear) * 0.5 * balanceConfig.physics_bias.pacejka_grip_mult - 0.85) / 0.95) * 68 +
        totalCl * balanceConfig.physics_bias.aero_downforce_mult * 22
    ),
    braking: clamp100(
      ((baseCaliperTorque / 5200) * 55 + ((peakTireMuFront - 0.9) / 0.8) * 45) * (1250 / totalMassKg)
    ),
    thermalStability: clamp100(
      (radiatorCoolingKw / Math.max(25, peakPowerHp * 0.22 * engineHeatMultiplier)) * 58 +
        brakeCoolingFactor * 22
    ),
    aeroEfficiency: clamp100(35 + (totalCl / Math.max(0.2, dragCoefficientCd)) * 18),
  };

  const warnings: IEngineeringWarning[] = [];

  if (aeroBalanceFrontPct > 58 && totalCl > 0.45) {
    warnings.push({
      id: 'warn_aero_oversteer',
      severity: 'critical',
      module: 'aero',
      title: 'High-Speed Snap Oversteer Risk',
      message: `Front aero balance is ${aeroBalanceFrontPct.toFixed(0)}%. Heavy front splitter downforce without matching rear wing/diffuser will destabilize fast sweepers.`,
    });
  } else if (aeroBalanceFrontPct < 24 && totalCl > 0.55) {
    warnings.push({
      id: 'warn_aero_understeer',
      severity: 'warning',
      module: 'aero',
      title: 'High-Speed Aero Push',
      message: `Rear aero dominates (${(100 - aeroBalanceFrontPct).toFixed(0)}% rear). Expect front-axle understeer in high-speed corners.`,
    });
  }

  const estThermalLoadKw = peakPowerHp * 0.24 * engineHeatMultiplier * balanceConfig.physics_bias.thermal_heat_soak_mult;
  if (estThermalLoadKw > radiatorCoolingKw * 1.15) {
    warnings.push({
      id: 'warn_thermal_overload',
      severity: 'critical',
      module: 'cooling',
      title: 'Thermal Overload: Radiator Undersized',
      message: `Estimated heat rejection (${estThermalLoadKw.toFixed(0)} kW) exceeds ${build.fuelAndCooling.radiatorSpec} capacity (${radiatorCoolingKw} kW). Engine will enter limp mode.`,
    });
  }

  if (
    build.aero.rearDiffuser !== 'None' &&
    (build.suspension.rideHeightRearMm < diffuserOptimalRideHeightMm[0] ||
      build.suspension.rideHeightRearMm > diffuserOptimalRideHeightMm[1])
  ) {
    warnings.push({
      id: 'warn_diffuser_stall',
      severity: 'warning',
      module: 'suspension',
      title: 'Venturi Diffuser Ride-Height Stall',
      message: `Rear ride height (${build.suspension.rideHeightRearMm} mm) sits outside the ${build.aero.rearDiffuser} window (${diffuserOptimalRideHeightMm[0]}–${diffuserOptimalRideHeightMm[1]} mm), stalling ground-effect suction.`,
    });
  }

  const minRimRequired = build.brakes.rotorDiameterMm >= 380 ? 19 : build.brakes.rotorDiameterMm >= 350 ? 18 : 15;
  if (build.wheelsAndTires.rimDiameterIn < minRimRequired) {
    warnings.push({
      id: 'warn_brake_clearance',
      severity: 'warning',
      module: 'brakes',
      title: 'Rotor-to-Barrel Clearance Tight',
      message: `${build.brakes.rotorDiameterMm} mm rotors normally require ${minRimRequired}"+ rims (currently ${build.wheelsAndTires.rimDiameterIn}") to prevent heat-trap and caliper rub.`,
    });
  }

  if (
    balanceConfig.economy_bias.max_pwr_ratio_cap > 0 &&
    pwrRatioHpPerKg > balanceConfig.economy_bias.max_pwr_ratio_cap
  ) {
    warnings.push({
      id: 'warn_pwr_cap',
      severity: 'critical',
      module: 'engine',
      title: 'Exceeds Regulation Power-to-Weight Cap',
      message: `Build P/W (${pwrRatioHpPerKg.toFixed(3)} HP/kg) exceeds active regulation cap (${balanceConfig.economy_bias.max_pwr_ratio_cap.toFixed(3)} HP/kg). Add ballast or detune boost.`,
    });
  }

  // Build Cost Sum
  const rawPartsSum =
    chassis.price +
    FRAME_COST[build.chassis.frameMaterial] +
    (blockPart?.price ?? 0) +
    (aspPart?.price ?? 0) +
    (exhPart?.price ?? 0) +
    (gbxPart?.price ?? 0) +
    (diffPart?.price ?? 0) +
    (susPart?.price ?? 0) +
    (rimPart?.price ?? 0) +
    (tirePart?.price ?? 0) +
    (rotorPart?.price ?? 0) +
    (calPart?.price ?? 0) +
    (bodyPart?.price ?? 0) +
    (splitPart?.price ?? 0) +
    (diffAeroPart?.price ?? 0) +
    (wingPart?.price ?? 0) +
    (radPart?.price ?? 0);

  const estimatedBuildValueCredits = Math.round(rawPartsSum * balanceConfig.economy_bias.part_price_mult);

  const anchors = CHASSIS_COCKPIT_ANCHORS[chassis.id] ?? {
    cockpitEyeLocal: { x: 0.34, y: 1.06, z: -0.08 },
    steeringWheelLocal: { x: 0.34, y: 0.84, z: 0.38 },
    hoodCamLocal: { x: 0.0, y: 1.10, z: 0.72 },
  };
  const collisionHull: IVehicleCollisionHull = {
    halfExtents: {
      x: trackWidthM * 0.44,
      y: 0.34,
      z: wheelbaseM * 0.76,
    },
    localOffset: { x: 0, y: 0.64, z: 0 },
    friction: 0.15,
    restitution: 0.12,
  };

  return {
    build,
    chassisName: chassis.name,
    bodyStyle: chassis.bodyStyle,
    dryMassKg: Math.round(dryMassKg * 10) / 10,
    fuelMassKg: Math.round(fuelMassKg * 10) / 10,
    totalMassKg: Math.round(totalMassKg * 10) / 10,
    unsprungMassPerCornerKg: [unsprungFront, unsprungFront, unsprungRear, unsprungRear],
    cgPositionLocal,
    cgHeightM: Math.round(cgHeightM * 1000) / 1000,
    frontWeightDistributionPct: Math.round(frontWeightDistributionPct * 10) / 10,
    yawInertiaKgM2,
    pitchInertiaKgM2,
    rollInertiaKgM2,
    torsionalRigidityNmDeg: Math.round(torsionalRigidityNmDeg),
    wheelbaseM,
    trackWidthM,
    wheelRadiusFrontM,
    wheelRadiusRearM,
    wheelPositionsLocal,
    suspensionRestLengthM,
    suspensionMaxTravelM: 0.14,
    hardpoints: scaledHardpoints,
    cockpitEyeLocal: anchors.cockpitEyeLocal,
    steeringWheelLocal: anchors.steeringWheelLocal,
    hoodCamLocal: anchors.hoodCamLocal,
    collisionHull,
    idleRpm,
    redlineRpm,
    revLimiterRpm,
    peakTorqueNm: Math.round(peakTorqueNm * 10) / 10,
    peakTorqueRpm,
    peakPowerHp: Math.round(peakPowerHp * 10) / 10,
    peakPowerRpm,
    pwrRatioHpPerKg: Math.round(pwrRatioHpPerKg * 1000) / 1000,
    engineRotationalInertiaKgM2: 0.14 + build.drivetrain.flywheelMassKg * 0.022,
    wheelRotationalInertiaKgM2,
    drivetrainLossEfficiency: drvSpec.eff,
    shiftDurationSeconds,
    maxBoostBar,
    turboSpoolRate,
    fuelBurnRateLPerSecAtMaxPower,
    dynoCurve,
    frontalAreaM2: Math.round(frontalAreaM2 * 100) / 100,
    dragCoefficientCd: Math.round(dragCoefficientCd * 1000) / 1000,
    liftCoefficientFrontCl: Math.round(liftCoefficientFrontCl * 1000) / 1000,
    liftCoefficientRearCl: Math.round(liftCoefficientRearCl * 1000) / 1000,
    aeroBalanceFrontPct: Math.round(aeroBalanceFrontPct * 10) / 10,
    diffuserOptimalRideHeightMm,
    peakTireMuFront: Math.round(peakTireMuFront * 1000) / 1000,
    peakTireMuRear: Math.round(peakTireMuRear * 1000) / 1000,
    tireOptimalTempWindowC: tirePart?.modifiers.optimalTempWindowC ?? [60, 95],
    tireWearRateMultiplier: tirePart?.modifiers.wearRateMultiplier ?? 1.0,
    pacejkaB,
    pacejkaC,
    pacejkaE,
    maxBrakeTorquePerAxleFrontNm,
    maxBrakeTorquePerAxleRearNm,
    brakeMaxSafeTempC: rotorPart?.modifiers.maxSafeTempC ?? 700,
    brakeColdBiteFactor: rotorPart?.modifiers.coldBiteFactor ?? 1.0,
    radiatorCoolingKw,
    engineThermalCapacityJPerC: 18500,
    engineMaxSafeTempC,
    engineHeatMultiplier,
    brakeCoolingFactor,
    estimatedBuildValueCredits,
    estimatedTopSpeedKph,
    spider,
    warnings,
  };
}

function clamp100(val: number): number {
  return Math.max(5, Math.min(100, Math.round(val)));
}
