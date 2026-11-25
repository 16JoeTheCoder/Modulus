import {
  combineFrictionCircle,
  computeLoadSensitiveMu,
  evaluatePacejka,
} from '../../core/math/pacejka';
import {
  DEFAULT_BALANCE_CONFIG,
  type ICompiledVehicle,
  type IEngineContext,
  type IGlobalBalanceConfig,
  type IInputState,
  type IModulusPlugin,
  type IVehicleRuntimeState,
  type SurfaceType,
  type Vec3,
} from '../../core/types';

const DEG_TO_RAD = Math.PI / 180;
const WHEEL_SPIN_SUBSTEPS = 8;

const SURFACE_GRIP: Record<SurfaceType, number> = {
  tarmac: 1.0,
  kerb: 0.88,
  grass: 0.50,
  gravel: 0.66,
  dirt: 0.62,
};

/**
 * Loose surfaces (gravel/dirt/grass) have broader, lazier Pacejka slip curves so peak grip
 * sits around 12-16 deg slip angle instead of snapping like cold tarmac.
 */
const SURFACE_PACEJKA_B_MULT: Record<SurfaceType, number> = {
  tarmac: 1.0,
  kerb: 0.92,
  grass: 0.48,
  gravel: 0.58,
  dirt: 0.52,
};

const SURFACE_ROLLING_RESISTANCE: Record<SurfaceType, number> = {
  tarmac: 0.014,
  kerb: 0.022,
  grass: 0.068,
  gravel: 0.070,
  dirt: 0.078,
};

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-6) return { x: 0, y: 1, z: 0 };
  const inv = 1 / len;
  return { x: v.x * inv, y: v.y * inv, z: v.z * inv };
}

function localToWorld(state: IVehicleRuntimeState, local: Vec3): Vec3 {
  // MODULUS Right-Handed Basis: +X = Left (-rightWorld), +Y = Up (upWorld), +Z = Forward (forwardWorld)
  const lx = -state.rightWorld.x;
  const ly = -state.rightWorld.y;
  const lz = -state.rightWorld.z;
  return {
    x: state.position.x + lx * local.x + state.upWorld.x * local.y + state.forwardWorld.x * local.z,
    y: state.position.y + ly * local.x + state.upWorld.y * local.y + state.forwardWorld.y * local.z,
    z: state.position.z + lz * local.x + state.upWorld.z * local.y + state.forwardWorld.z * local.z,
  };
}

export class VehicleSolverPlugin implements IModulusPlugin {
  public readonly id = 'vehicle-solver';
  public readonly version = '2.0.0';
  public readonly priority = 60;

  private ctx: IEngineContext | null = null;
  private vehicle: ICompiledVehicle | null = null;
  private balanceConfig: IGlobalBalanceConfig = DEFAULT_BALANCE_CONFIG;

  public init(ctx: IEngineContext): void {
    this.ctx = ctx;
    this.vehicle = ctx.getCompiledVehicle();
    this.balanceConfig = ctx.getBalanceConfig();
  }

  public onBalanceConfigUpdated(config: IGlobalBalanceConfig): void {
    this.balanceConfig = config;
  }

  public onBuildCompiled(vehicle: ICompiledVehicle): void {
    this.vehicle = vehicle;
  }

  public onPhysicsStep(dt: number, state: IVehicleRuntimeState, input: IInputState): void {
    const vehicle = this.vehicle ?? this.ctx?.getCompiledVehicle();
    if (!vehicle) return;

    const { build } = vehicle;
    const sus = build.suspension;
    const gripBias = this.balanceConfig.physics_bias.pacejka_grip_mult;

    // Live vehicle mass including remaining fuel
    const currentMassKg = Math.max(550, vehicle.dryMassKg + state.fuelLiters * 0.75);
    const totalWeightN = currentMassKg * 9.81;
    const frontWeightFrac = vehicle.frontWeightDistributionPct / 100;
    const rearWeightFrac = 1 - frontWeightFrac;

    const staticCornerLoads: [number, number, number, number] = [
      totalWeightN * frontWeightFrac * 0.5,
      totalWeightN * frontWeightFrac * 0.5,
      totalWeightN * rearWeightFrac * 0.5,
      totalWeightN * rearWeightFrac * 0.5,
    ];

    const cornerSprungMass: [number, number, number, number] = [
      Math.max(80, currentMassKg * frontWeightFrac * 0.5 - vehicle.unsprungMassPerCornerKg[0]),
      Math.max(80, currentMassKg * frontWeightFrac * 0.5 - vehicle.unsprungMassPerCornerKg[1]),
      Math.max(80, currentMassKg * rearWeightFrac * 0.5 - vehicle.unsprungMassPerCornerKg[2]),
      Math.max(80, currentMassKg * rearWeightFrac * 0.5 - vehicle.unsprungMassPerCornerKg[3]),
    ];

    // 1. Ackermann Front Steering + Static Toe Alignment + Asymmetric Front Damage Pull
    const dmgFL = clamp(state.damageZones[0] ?? 0, 0, 1);
    const dmgFR = clamp(state.damageZones[1] ?? 0, 0, 1);
    const steerPullRad = (dmgFL - dmgFR) * 2.8 * DEG_TO_RAD;

    const steerInput = clamp(input.steer, -1, 1);
    state.commandedSteer = steerInput;
    const maxSteerAngleRad = vehicle.steeringLockDeg * DEG_TO_RAD;
    const centerSteerRad = clamp(
      steerInput * maxSteerAngleRad + steerPullRad,
      -maxSteerAngleRad,
      maxSteerAngleRad
    );
    let ackFL = 0;
    let ackFR = 0;

    if (Math.abs(centerSteerRad) > 1e-4) {
      const absSteer = Math.abs(centerSteerRad);
      const turnRadius = vehicle.wheelbaseM / Math.tan(absSteer);
      const halfTrack = vehicle.trackWidthM * 0.5;
      const innerAngle = Math.atan(vehicle.wheelbaseM / Math.max(0.6, turnRadius - halfTrack));
      const outerAngle = Math.atan(vehicle.wheelbaseM / (turnRadius + halfTrack));

      if (centerSteerRad > 0) {
        ackFL = innerAngle;
        ackFR = outerAngle;
      } else {
        ackFL = -outerAngle;
        ackFR = -innerAngle;
      }
    }

    const toeFrontRad = sus.toeFrontDeg * DEG_TO_RAD;
    const toeRearRad = sus.toeRearDeg * DEG_TO_RAD;
    state.wheels[0].steerAngleRad = ackFL - toeFrontRad;
    state.wheels[1].steerAngleRad = ackFR + toeFrontRad;
    state.wheels[2].steerAngleRad = -toeRearRad;
    state.wheels[3].steerAngleRad = toeRearRad;
    state.frontWheelAngleRad = 0.5 * (state.wheels[0].steerAngleRad + state.wheels[1].steerAngleRad);

    // 2. Suspension Deflections, Coilover Springs, Asymmetric Dampers & Anti-Roll Bars
    const springRatesNm: [number, number, number, number] = [
      sus.springRateFrontNmm * 1000,
      sus.springRateFrontNmm * 1000,
      sus.springRateRearNmm * 1000,
      sus.springRateRearNmm * 1000,
    ];

    const deflectionsM: [number, number, number, number] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const w = state.wheels[i];
      deflectionsM[i] = w.grounded ? vehicle.suspensionRestLengthM[i] - w.suspensionLengthM : -0.06;
    }

    const rigidityFactor = clamp(vehicle.torsionalRigidityNmDeg / 26000, 0.82, 1.18);
    const arbFrontForce = (deflectionsM[0] - deflectionsM[1]) * sus.arbFrontNmm * 1000 * rigidityFactor;
    const arbRearForce = (deflectionsM[2] - deflectionsM[3]) * sus.arbRearNmm * 1000 * rigidityFactor;
    const arbForces: [number, number, number, number] = [
      arbFrontForce,
      -arbFrontForce,
      arbRearForce,
      -arbRearForce,
    ];

    const rollCenterHeightM =
      sus.layout === 'Pushrod Inboard'
        ? Math.min(0.22, vehicle.cgHeightM * 0.44)
        : sus.layout === 'Double Wishbone'
          ? Math.min(0.18, vehicle.cgHeightM * 0.38)
          : Math.min(0.14, vehicle.cgHeightM * 0.32);

    const geomLatTransferN =
      ((currentMassKg * state.lateralG * 9.81 * rollCenterHeightM) / Math.max(1.2, vehicle.trackWidthM)) * 0.5;
    const geomLongTransferN =
      ((currentMassKg * state.longitudinalG * 9.81 * rollCenterHeightM) / Math.max(1.8, vehicle.wheelbaseM)) * 0.5;

    const worldCom = localToWorld(state, vehicle.cgPositionLocal);

    const camberGainRadPerM =
      sus.layout === 'Pushrod Inboard'
        ? -26 * DEG_TO_RAD
        : sus.layout === 'Double Wishbone'
          ? -22 * DEG_TO_RAD
          : -7 * DEG_TO_RAD;
    const casterRad = sus.casterFrontDeg * DEG_TO_RAD;

    const pressureRrFactor = clamp(1 + (28.5 - build.wheelsAndTires.coldPressurePsi) * 0.015, 0.82, 1.22);

    // Braking pedal mapping:
    // While in Reverse (`gear === -1 && reverseState === 'reverse'`), W (`input.throttle`) applies service brake
    // and S (`input.brake`) drives reverse throttle in powertrain!
    const isReversing = state.gear === -1 && state.reverseState === 'reverse';
    const serviceBrakeInput = isReversing ? clamp(input.throttle, 0, 1) : clamp(input.brake, 0, 1);
    const activeDriveIntent = isReversing ? clamp(input.brake, 0, 1) : clamp(input.throttle, 0, 1);
    const handbrakeInput = clamp(input.handbrake, 0, 1);
    const driftForgiveness = this.balanceConfig.physics_bias.drift_forgiveness;

    // Static hold gate for jitter-free stationary rest on slopes & grid
    const lowSpeedBlend = clamp((1.2 - state.speedMs) / 1.0, 0, 1);
    const isParkedHold =
      state.speedMs < 0.25 &&
      activeDriveIntent < 0.02 &&
      (serviceBrakeInput > 0.02 || handbrakeInput > 0.02 || state.speedMs < 0.1);

    const maxSuspForcePerCorner = totalWeightN * 3.0;
    const bumpLimitM = 0.075;

    // ABS threshold by assist preset (Beginner: active threshold ABS; Sport: late threshold ABS; Pro: off)
    const absEnabled = !state.aiEnabled && state.assistPreset !== 'pro';
    const absSlipThreshold = state.assistPreset === 'beginner' ? -0.14 : -0.22;

    // Downhill grade detection (+forwardWorld.y < 0 means nose pointed downhill).
    // Steep downhill braking shifts weight off the rear axle; EBD proportioning prevents violent rear-lock snap-spins.
    const downhillGrade = clamp(-state.forwardWorld.y, 0, 0.35);

    for (let i = 0; i < 4; i++) {
      const w = state.wheels[i];
      const isFront = i < 2;
      const isLeft = i === 0 || i === 2;
      const wheelRadiusM = isFront ? vehicle.wheelRadiusFrontM : vehicle.wheelRadiusRearM;
      const wheelInertia = Math.max(0.42, vehicle.wheelRotationalInertiaKgM2[i]);

      // Dynamic camber angle (negative = top tilted inward)
      const staticCamberRad = (isFront ? sus.camberFrontDeg : sus.camberRearDeg) * DEG_TO_RAD;
      const bumpCamberRad = deflectionsM[i] * camberGainRadPerM;
      let casterCamberRad = 0;
      if (isFront) {
        casterCamberRad = (isLeft ? 1 : -1) * Math.sin(w.steerAngleRad) * casterRad * 0.85;
      }
      w.camberAngleRad = clamp(staticCamberRad + bumpCamberRad + casterCamberRad, -10 * DEG_TO_RAD, 5 * DEG_TO_RAD);

      // Service brake + rear handbrake torque (with ABS + downhill/crest rear-load EBD)
      const baseAxleBrake = isFront
        ? vehicle.maxBrakeTorquePerAxleFrontNm * 0.5
        : vehicle.maxBrakeTorquePerAxleRearNm * 0.5;
      let serviceBrakeTorqueNm = baseAxleBrake * serviceBrakeInput * w.brakeFadeMultiplier;

      // Dynamic rear brake proportioning (EBD) when rear axle unloads under steep downhill braking or crests
      if (!isFront && serviceBrakeInput > 0.25 && handbrakeInput < 0.05) {
        const rearLoadRatio = clamp(w.normalLoadN / Math.max(500, staticCornerLoads[i]), 0, 1.2);
        const ebdScale = clamp(
          0.55 + rearLoadRatio * 0.45 - downhillGrade * 0.55,
          state.assistPreset === 'pro' ? 0.62 : 0.46,
          1.0
        );
        serviceBrakeTorqueNm *= ebdScale;
      }

      let absModulating = false;
      if (
        absEnabled &&
        w.grounded &&
        serviceBrakeInput > 0.2 &&
        state.speedMs > 2.2 &&
        w.slipRatio < absSlipThreshold
      ) {
        const overshoot = clamp((absSlipThreshold - w.slipRatio) / 0.25, 0, 1);
        serviceBrakeTorqueNm *= clamp(1 - overshoot * 0.72, 0.22, 1.0);
        absModulating = true;
      }

      let brakeTorqueNm = serviceBrakeTorqueNm;
      if (!isFront && handbrakeInput > 0.01) {
        // Strong hydraulic handbrake locks rear wheels promptly for clean drift initiation
        brakeTorqueNm += (4200 - 1600 * driftForgiveness) * handbrakeInput * w.brakeFadeMultiplier;
      }
      w.brakeTorqueNm = brakeTorqueNm;

      if (!w.grounded) {
        w.normalLoadN = 0;
        w.slipRatio = 0;
        w.slipAngleRad = 0;
        w.longitudinalForceN = 0;
        w.lateralForceN = 0;
        w.lockupIntensity = 0;
        w.scrubIntensity = 0;

        let omega = w.angularVelocityRadS;
        const subDt = dt / WHEEL_SPIN_SUBSTEPS;
        for (let s = 0; s < WHEEL_SPIN_SUBSTEPS; s++) {
          const driveAcc = w.driveTorqueNm / wheelInertia;
          omega += driveAcc * subDt;
          const brakeDecel = (brakeTorqueNm / wheelInertia) * subDt;
          if (Math.abs(omega) <= brakeDecel) {
            omega = 0;
          } else {
            omega -= Math.sign(omega) * brakeDecel;
          }
          omega *= 1 - 0.12 * subDt;
        }
        w.angularVelocityRadS = clamp(omega, -260, 260);
        w.rotationAngleRad += w.angularVelocityRadS * dt;
        continue;
      }

      // --- GROUNDED CORNER ---

      // 2a. Vertical Suspension Force
      const k = springRatesNm[i];
      const staticSagM = staticCornerLoads[i] / k;
      const springCompM = staticSagM + deflectionsM[i];
      const fSpring = springCompM > 0 ? k * springCompM : 0;

      const cCrit = 2 * Math.sqrt(k * cornerSprungMass[i]);
      const bumpClicks = isFront ? sus.damperBumpFront : sus.damperBumpRear;
      const reboundClicks = isFront ? sus.damperReboundFront : sus.damperReboundRear;
      const zeta =
        w.compressionVelocityMs >= 0
          ? 0.28 + (bumpClicks / 20) * 0.52
          : 0.34 + (reboundClicks / 20) * 0.64;
      const cDamper = cCrit * zeta;
      const fDamper = clamp(cDamper * w.compressionVelocityMs, -totalWeightN * 1.4, totalWeightN * 1.8);

      let fBumpStop = 0;
      if (w.bottomedOut || deflectionsM[i] > bumpLimitM) {
        const over = Math.max(0, deflectionsM[i] - bumpLimitM);
        fBumpStop = over * (k * 3.5 + 85000) + Math.max(0, w.compressionVelocityMs) * cCrit * 0.6;
      }

      const fArb = arbForces[i];
      const suspForceN = clamp(fSpring + fDamper + fBumpStop + fArb, 0, maxSuspForcePerCorner);

      const localAnchor = vehicle.wheelPositionsLocal[i];
      const suspPointWorld = localToWorld(state, {
        x: localAnchor.x,
        y: vehicle.cgHeightM,
        z: localAnchor.z,
      });

      state.pointForces.push({
        forceWorld: {
          x: w.contactNormalWorld.x * suspForceN,
          y: w.contactNormalWorld.y * suspForceN,
          z: w.contactNormalWorld.z * suspForceN,
        },
        pointWorld: suspPointWorld,
      });

      // Scale geometric load transfer by grounded suspension load fraction so wheels cresting a hill
      // genuinely unload smoothly instead of receiving phantom normal load while airborne/light.
      const groundedLoadFrac = clamp(suspForceN / Math.max(500, staticCornerLoads[i]), 0, 1.35);
      const latSign = isLeft ? 1 : -1;
      const longSign = isFront ? -1 : 1;
      const normalLoadN = clamp(
        suspForceN + (latSign * geomLatTransferN + longSign * geomLongTransferN) * groundedLoadFrac,
        0,
        maxSuspForcePerCorner
      );
      w.normalLoadN = normalLoadN;

      if (normalLoadN < 5) {
        w.slipRatio = 0;
        w.slipAngleRad = 0;
        w.longitudinalForceN = 0;
        w.lateralForceN = 0;
        w.lockupIntensity = 0;
        w.scrubIntensity = 0;
        w.rotationAngleRad += w.angularVelocityRadS * dt;
        continue;
      }

      // 3. Wheel Contact Patch Frame & Velocity
      const n = w.contactNormalWorld;
      const cosS = Math.cos(w.steerAngleRad);
      const sinS = Math.sin(w.steerAngleRad);

      const rawFwd: Vec3 = {
        x: state.forwardWorld.x * cosS - state.rightWorld.x * sinS,
        y: state.forwardWorld.y * cosS - state.rightWorld.y * sinS,
        z: state.forwardWorld.z * cosS - state.rightWorld.z * sinS,
      };
      const fwdDotN = dot(rawFwd, n);
      const wFwd = normalize({
        x: rawFwd.x - n.x * fwdDotN,
        y: rawFwd.y - n.y * fwdDotN,
        z: rawFwd.z - n.z * fwdDotN,
      });
      const wRight = normalize(cross(wFwd, n));

      const rPatch: Vec3 = {
        x: w.contactPointWorld.x - worldCom.x,
        y: w.contactPointWorld.y - worldCom.y,
        z: w.contactPointWorld.z - worldCom.z,
      };
      const rotVel = cross(state.angularVelocityWorld, rPatch);
      const patchVel: Vec3 = {
        x: state.linearVelocityWorld.x + rotVel.x,
        y: state.linearVelocityWorld.y + rotVel.y,
        z: state.linearVelocityWorld.z + rotVel.z,
      };

      const vLong = dot(patchVel, wFwd);
      const vLat = dot(patchVel, wRight);

      // 4. Effective Peak Friction (Pacejka + Load Sensitivity + Thermal/Wear + Surface + Corner Damage + Bias)
      const baseMu = isFront ? vehicle.peakTireMuFront : vehicle.peakTireMuRear;
      const loadSensitiveMu = computeLoadSensitiveMu(baseMu, normalLoadN, 3600);
      const surfaceGrip = SURFACE_GRIP[w.surface] ?? 1.0;
      const surfaceBMult = SURFACE_PACEJKA_B_MULT[w.surface] ?? 1.0;
      const cornerDamageMult = 1 - clamp(state.damageZones[i] ?? 0, 0, 1) * 0.25;
      const effectiveMu =
        loadSensitiveMu * gripBias * w.thermalGripMultiplier * surfaceGrip * cornerDamageMult;
      const maxTireForceN = effectiveMu * normalLoadN;

      const absCamberDeg = Math.abs(w.camberAngleRad / DEG_TO_RAD);
      const latCamberMult =
        w.camberAngleRad <= 0
          ? 1.0 + Math.min(absCamberDeg, 3.0) * 0.022 - Math.max(0, absCamberDeg - 3.6) * 0.025
          : 1.0 - absCamberDeg * 0.035;
      const longCamberMult = Math.max(0.88, 1.0 - Math.max(0, absCamberDeg - 1.5) * 0.018);

      // 5. Substepped Wheel Spin + Surface-Aware Progressive Pacejka + Combined Slip Circle
      const subDt = dt / WHEEL_SPIN_SUBSTEPS;
      const crr = (SURFACE_ROLLING_RESISTANCE[w.surface] ?? 0.014) * pressureRrFactor;
      const rollingResistTorque = crr * normalLoadN * wheelRadiusM;

      const speedScaleLat = clamp(Math.hypot(vLong, vLat) / 0.8, 0, 1);
      const slipAngleRad = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.15)) * speedScaleLat;

      // Handbrake rear-lock kinetic drop breaks rear traction smoothly on command for drift initiation,
      // while soft high-slip rear lateral curvature keeps sustained slides catchable on keyboard.
      const isRearHandbrakeSliding = !isFront && handbrakeInput > 0.12 && state.speedMs > 3.5;
      const handbrakeLatScale = isRearHandbrakeSliding ? 1 - handbrakeInput * (0.74 - 0.38 * driftForgiveness) : 1.0;
      const handbrakeLongScale = isRearHandbrakeSliding ? 1 - handbrakeInput * (0.35 - 0.13 * driftForgiveness) : 1.0;
      const latPacejkaC = !isFront ? Math.min(1.28, vehicle.pacejkaC) : vehicle.pacejkaC;
      const latPacejkaE = !isFront ? Math.min(-0.45, vehicle.pacejkaE) : vehicle.pacejkaE;

      let fyPure = -evaluatePacejka(slipAngleRad, {
        B: vehicle.pacejkaB * surfaceBMult,
        C: latPacejkaC,
        D: maxTireForceN * latCamberMult * handbrakeLatScale,
        E: latPacejkaE,
      });

      if (lowSpeedBlend > 0) {
        const latViscous = clamp(-vLat * normalLoadN * 0.85, -maxTireForceN, maxTireForceN);
        fyPure = fyPure * (1 - lowSpeedBlend) + latViscous * lowSpeedBlend;
      }

      let omega = w.angularVelocityRadS;
      let accumFx = 0;
      let lastKappa = 0;

      // Proper low-speed longitudinal slip denominator gives crisp standing launch without kappa blowup
      const vLongDenom = Math.max(Math.abs(vLong), 0.75);
      const longC = Math.min(1.34, vehicle.pacejkaC * 1.01);
      const longE = Math.min(-0.25, vehicle.pacejkaE);

      for (let s = 0; s < WHEEL_SPIN_SUBSTEPS; s++) {
        const wheelLinearSpeed = omega * wheelRadiusM;
        const rawKappa = (wheelLinearSpeed - vLong) / vLongDenom;
        const kappa = clamp(rawKappa, -1.5, 1.5);
        lastKappa = kappa;

        const fxPure = evaluatePacejka(kappa, {
          B: vehicle.pacejkaB * surfaceBMult * 1.06,
          C: longC,
          D: maxTireForceN * longCamberMult * handbrakeLongScale,
          E: longE,
        });

        const combined = combineFrictionCircle(fxPure, fyPure, maxTireForceN);
        const fxStep = combined.fx;
        accumFx += fxStep;

        const netActiveTorque = w.driveTorqueNm - fxStep * wheelRadiusM;
        let nextOmega = omega + (netActiveTorque / wheelInertia) * subDt;

        const passiveTorque = brakeTorqueNm + rollingResistTorque;
        const maxPassiveDeltaOmega = (passiveTorque / wheelInertia) * subDt;

        if (Math.abs(nextOmega) <= maxPassiveDeltaOmega) {
          nextOmega = 0;
        } else {
          nextOmega -= Math.sign(nextOmega) * maxPassiveDeltaOmega;
        }

        omega = clamp(nextOmega, -260, 260);
      }

      w.angularVelocityRadS = omega;
      w.rotationAngleRad += omega * dt;
      w.slipRatio = lastKappa;
      w.slipAngleRad = slipAngleRad;

      let fxFinal = accumFx / WHEEL_SPIN_SUBSTEPS;
      let fyFinal = combineFrictionCircle(fxFinal, fyPure, maxTireForceN).fy;

      // Compute HUD/Audio lockup & tire scrub cues [0..1]
      const loadCueWeight = clamp(normalLoadN / 2600, 0.2, 1.25);
      const speedCueWeight = clamp((state.speedMs - 1.5) / 4.5, 0, 1);
      if (serviceBrakeInput > 0.08 && lastKappa < -0.10) {
        const rawLock = clamp((-lastKappa - 0.10) / 0.45, 0, 1);
        w.lockupIntensity = clamp(Math.max(rawLock, absModulating ? 0.35 : 0) * speedCueWeight, 0, 1);
      } else if (!isFront && handbrakeInput > 0.15 && Math.abs(lastKappa) > 0.2) {
        w.lockupIntensity = clamp(handbrakeInput * speedCueWeight, 0, 1);
      } else {
        w.lockupIntensity = 0;
      }

      const isLooseSurface = w.surface === 'gravel' || w.surface === 'dirt';
      const latScrub = clamp((Math.abs(slipAngleRad) - (isLooseSurface ? 0.05 : 0.075)) / 0.18, 0, 1);
      const longScrub = clamp((Math.abs(lastKappa) - (isLooseSurface ? 0.10 : 0.14)) / 0.42, 0, 1);
      const looseBaseline = isLooseSurface ? clamp(state.speedMs / 25, 0, 0.25) : 0;
      w.scrubIntensity = clamp(
        Math.max(latScrub, longScrub * 0.85, looseBaseline) * loadCueWeight * speedCueWeight,
        0,
        1
      );

      // Stationary parking hold
      if (isParkedHold) {
        const holdLong = clamp(-vLong * normalLoadN * 1.8, -maxTireForceN * 0.9, maxTireForceN * 0.9);
        const holdLat = clamp(-vLat * normalLoadN * 1.8, -maxTireForceN * 0.9, maxTireForceN * 0.9);
        const held = combineFrictionCircle(holdLong, holdLat, maxTireForceN * 0.92);
        fxFinal = held.fx;
        fyFinal = held.fy;
        w.angularVelocityRadS *= 0.45;
        w.slipRatio = 0;
        w.slipAngleRad = 0;
        w.lockupIntensity = 0;
        w.scrubIntensity = 0;
      }

      w.longitudinalForceN = fxFinal;
      w.lateralForceN = fyFinal;

      const tireForceWorld: Vec3 = {
        x: wFwd.x * fxFinal + wRight.x * fyFinal,
        y: wFwd.y * fxFinal + wRight.y * fyFinal,
        z: wFwd.z * fxFinal + wRight.z * fyFinal,
      };

      const tireAppPoint: Vec3 = {
        x: w.contactPointWorld.x + state.upWorld.x * rollCenterHeightM,
        y: w.contactPointWorld.y + state.upWorld.y * rollCenterHeightM,
        z: w.contactPointWorld.z + state.upWorld.z * rollCenterHeightM,
      };

      state.pointForces.push({
        forceWorld: tireForceWorld,
        pointWorld: tireAppPoint,
      });
    }

    // 6. Subtle Caster Self-Centering & High-Speed Yaw Stability Damping
    if (state.speedMs > 2.0) {
      const casterStability = (sus.casterFrontDeg / 6.0) * 115 * clamp(state.speedMs / 35, 0, 1.5);
      const yawDampTorque = -state.yawRateRadS * casterStability;
      state.torqueAccumulatorWorld.x += state.upWorld.x * yawDampTorque;
      state.torqueAccumulatorWorld.y += state.upWorld.y * yawDampTorque;
      state.torqueAccumulatorWorld.z += state.upWorld.z * yawDampTorque;
    }
  }
}

export const vehicleSolverPlugin: IModulusPlugin = new VehicleSolverPlugin();
