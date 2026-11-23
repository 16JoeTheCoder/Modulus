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
const MAX_STEER_ANGLE_RAD = 31 * DEG_TO_RAD;
const WHEEL_SPIN_SUBSTEPS = 4;

const SURFACE_GRIP: Record<SurfaceType, number> = {
  tarmac: 1.0,
  kerb: 0.88,
  grass: 0.52,
  gravel: 0.62,
};

const SURFACE_ROLLING_RESISTANCE: Record<SurfaceType, number> = {
  tarmac: 0.014,
  kerb: 0.022,
  grass: 0.068,
  gravel: 0.082,
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
  public readonly version = '1.0.0';
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

    // 1. Ackermann Front Steering + Static Toe Alignment
    const steerInput = clamp(input.steer, -1, 1);
    const centerSteerRad = steerInput * MAX_STEER_ANGLE_RAD;
    let ackFL = 0;
    let ackFR = 0;

    if (Math.abs(centerSteerRad) > 1e-4) {
      const absSteer = Math.abs(centerSteerRad);
      const turnRadius = vehicle.wheelbaseM / Math.tan(absSteer);
      const halfTrack = vehicle.trackWidthM * 0.5;
      const innerAngle = Math.atan(vehicle.wheelbaseM / Math.max(0.6, turnRadius - halfTrack));
      const outerAngle = Math.atan(vehicle.wheelbaseM / (turnRadius + halfTrack));

      if (centerSteerRad > 0) {
        // Left turn: FL is inner (+), FR is outer (+)
        ackFL = innerAngle;
        ackFR = outerAngle;
      } else {
        // Right turn: FR is inner (-), FL is outer (-)
        ackFL = -outerAngle;
        ackFR = -innerAngle;
      }
    }

    const toeFrontRad = sus.toeFrontDeg * DEG_TO_RAD;
    const toeRearRad = sus.toeRearDeg * DEG_TO_RAD;
    // Toe-in (+): left wheel points slightly right (-), right wheel points slightly left (+)
    state.wheels[0].steerAngleRad = ackFL - toeFrontRad;
    state.wheels[1].steerAngleRad = ackFR + toeFrontRad;
    state.wheels[2].steerAngleRad = -toeRearRad;
    state.wheels[3].steerAngleRad = toeRearRad;

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
      // L_static = vehicle.suspensionRestLengthM[i] = 0.22 + rideHeightMm / 1000
      deflectionsM[i] = w.grounded ? vehicle.suspensionRestLengthM[i] - w.suspensionLengthM : -0.06;
    }

    // Torsional rigidity modulates ARB load-transfer precision
    const rigidityFactor = clamp(vehicle.torsionalRigidityNmDeg / 26000, 0.82, 1.18);
    const arbFrontForce = (deflectionsM[0] - deflectionsM[1]) * sus.arbFrontNmm * 1000 * rigidityFactor;
    const arbRearForce = (deflectionsM[2] - deflectionsM[3]) * sus.arbRearNmm * 1000 * rigidityFactor;
    const arbForces: [number, number, number, number] = [
      arbFrontForce,
      -arbFrontForce,
      arbRearForce,
      -arbRearForce,
    ];

    // Roll-center height by suspension geometry (splits elastic vs geometric load transfer and prevents high-grip flip)
    const rollCenterHeightM =
      sus.layout === 'Pushrod Inboard'
        ? Math.min(0.22, vehicle.cgHeightM * 0.44)
        : sus.layout === 'Double Wishbone'
          ? Math.min(0.18, vehicle.cgHeightM * 0.38)
          : Math.min(0.14, vehicle.cgHeightM * 0.32);

    // Geometric load transfer component for Pacejka normal load fidelity
    const geomLatTransferN =
      ((currentMassKg * state.lateralG * 9.81 * rollCenterHeightM) / Math.max(1.2, vehicle.trackWidthM)) * 0.5;
    const geomLongTransferN =
      ((currentMassKg * state.longitudinalG * 9.81 * rollCenterHeightM) / Math.max(1.8, vehicle.wheelbaseM)) * 0.5;

    // World center of mass (matches Rapier body localCom)
    const worldCom = localToWorld(state, vehicle.cgPositionLocal);

    // Suspension geometry camber recovery gain (rad per meter of bump compression)
    const camberGainRadPerM =
      sus.layout === 'Pushrod Inboard'
        ? -26 * DEG_TO_RAD
        : sus.layout === 'Double Wishbone'
          ? -22 * DEG_TO_RAD
          : -7 * DEG_TO_RAD;
    const casterRad = sus.casterFrontDeg * DEG_TO_RAD;

    // Tire pressure rolling resistance adjustment (lower PSI = slightly higher rolling drag)
    const pressureRrFactor = clamp(1 + (28.5 - build.wheelsAndTires.coldPressurePsi) * 0.015, 0.82, 1.22);

    // Braking inputs
    const brakeInput = clamp(input.brake, 0, 1);
    const handbrakeInput = clamp(input.handbrake, 0, 1);

    // Static hold gate for 100% jitter-free stationary rest on slopes & grid
    const lowSpeedBlend = clamp((1.6 - state.speedMs) / 1.4, 0, 1);
    const isParkedHold =
      state.speedMs < 0.25 &&
      input.throttle < 0.02 &&
      (brakeInput > 0.02 || handbrakeInput > 0.02 || state.speedMs < 0.1);

    const maxSuspForcePerCorner = totalWeightN * 3.0;
    const bumpLimitM = 0.075;

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
        // Left turn (steer > 0): outer FR gains negative camber, inner FL gains positive camber
        casterCamberRad = (isLeft ? 1 : -1) * Math.sin(w.steerAngleRad) * casterRad * 0.85;
      }
      w.camberAngleRad = clamp(staticCamberRad + bumpCamberRad + casterCamberRad, -10 * DEG_TO_RAD, 5 * DEG_TO_RAD);

      // Service brake + rear handbrake torque
      const baseAxleBrake = isFront
        ? vehicle.maxBrakeTorquePerAxleFrontNm * 0.5
        : vehicle.maxBrakeTorquePerAxleRearNm * 0.5;
      let brakeTorqueNm = baseAxleBrake * brakeInput * w.brakeFadeMultiplier;
      if (!isFront && handbrakeInput > 0.01) {
        brakeTorqueNm += 3600 * handbrakeInput * w.brakeFadeMultiplier;
      }
      w.brakeTorqueNm = brakeTorqueNm;

      if (!w.grounded) {
        // Airborne wheel: zero normal/tire forces, integrate free wheel spin
        w.normalLoadN = 0;
        w.slipRatio = 0;
        w.slipAngleRad = 0;
        w.longitudinalForceN = 0;
        w.lateralForceN = 0;

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
          // Subtle bearing drag
          omega *= 1 - 0.12 * subDt;
        }
        w.angularVelocityRadS = clamp(omega, -260, 260);
        w.rotationAngleRad += w.angularVelocityRadS * dt;
        continue;
      }

      // --- GROUNDED CORNER ---

      // 2a. Vertical Suspension Force (Spring + Asymmetric Damper + Bump-Stop + ARB)
      const k = springRatesNm[i];
      const staticSagM = staticCornerLoads[i] / k;
      const springCompM = staticSagM + deflectionsM[i];
      let fSpring = springCompM > 0 ? k * springCompM : 0;

      // Critical damping scaled by bump/rebound click settings (1..20)
      const cCrit = 2 * Math.sqrt(k * cornerSprungMass[i]);
      const bumpClicks = isFront ? sus.damperBumpFront : sus.damperBumpRear;
      const reboundClicks = isFront ? sus.damperReboundFront : sus.damperReboundRear;
      const zeta =
        w.compressionVelocityMs >= 0
          ? 0.28 + (bumpClicks / 20) * 0.52
          : 0.34 + (reboundClicks / 20) * 0.64;
      const cDamper = cCrit * zeta;
      const fDamper = clamp(cDamper * w.compressionVelocityMs, -totalWeightN * 1.4, totalWeightN * 1.8);

      // Progressive bump stop when bottoming out
      let fBumpStop = 0;
      if (w.bottomedOut || deflectionsM[i] > bumpLimitM) {
        const over = Math.max(0, deflectionsM[i] - bumpLimitM);
        fBumpStop = over * (k * 3.5 + 85000) + Math.max(0, w.compressionVelocityMs) * cCrit * 0.6;
      }

      const fArb = arbForces[i];
      const suspForceN = clamp(fSpring + fDamper + fBumpStop + fArb, 0, maxSuspForcePerCorner);

      // Apply suspension force along road contact normal at the corner hardpoint (CG Y height)
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

      // Normal load on contact patch includes elastic suspension force + geometric roll-center load transfer
      const latSign = isLeft ? 1 : -1;
      const longSign = isFront ? -1 : 1; // Braking (longG < 0) adds load to front (-1 * neg = +)
      const normalLoadN = clamp(
        suspForceN + latSign * geomLatTransferN + longSign * geomLongTransferN,
        0,
        maxSuspForcePerCorner
      );
      w.normalLoadN = normalLoadN;

      if (normalLoadN < 5) {
        w.slipRatio = 0;
        w.slipAngleRad = 0;
        w.longitudinalForceN = 0;
        w.lateralForceN = 0;
        w.rotationAngleRad += w.angularVelocityRadS * dt;
        continue;
      }

      // 3. Wheel Contact Patch Frame & Velocity
      const n = w.contactNormalWorld;
      const cosS = Math.cos(w.steerAngleRad);
      const sinS = Math.sin(w.steerAngleRad);

      // Wheel forward in chassis space: fwd * cos(steer) - right * sin(steer) (+steer = left)
      const rawFwd: Vec3 = {
        x: state.forwardWorld.x * cosS - state.rightWorld.x * sinS,
        y: state.forwardWorld.y * cosS - state.rightWorld.y * sinS,
        z: state.forwardWorld.z * cosS - state.rightWorld.z * sinS,
      };
      // Project onto contact plane perpendicular to road normal
      const fwdDotN = dot(rawFwd, n);
      const wFwd = normalize({
        x: rawFwd.x - n.x * fwdDotN,
        y: rawFwd.y - n.y * fwdDotN,
        z: rawFwd.z - n.z * fwdDotN,
      });
      // Wheel right vector on contact plane: wFwd x n
      const wRight = normalize(cross(wFwd, n));

      // Contact patch velocity = v_COM + omega x (contactPoint - COM)
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

      // 4. Effective Peak Friction (Pacejka + Load Sensitivity + Thermal/Wear + Surface + Camber + Admin Bias)
      const baseMu = isFront ? vehicle.peakTireMuFront : vehicle.peakTireMuRear;
      const loadSensitiveMu = computeLoadSensitiveMu(baseMu, normalLoadN, 3600);
      const surfaceGrip = SURFACE_GRIP[w.surface] ?? 1.0;
      const effectiveMu = loadSensitiveMu * gripBias * w.thermalGripMultiplier * surfaceGrip;
      const maxTireForceN = effectiveMu * normalLoadN;

      // Camber trade-off: modest negative camber boosts cornering grip, excessive negative camber trims straight traction
      const absCamberDeg = Math.abs(w.camberAngleRad / DEG_TO_RAD);
      const latCamberMult =
        w.camberAngleRad <= 0
          ? 1.0 + Math.min(absCamberDeg, 3.0) * 0.022 - Math.max(0, absCamberDeg - 3.6) * 0.025
          : 1.0 - absCamberDeg * 0.035;
      const longCamberMult = Math.max(0.88, 1.0 - Math.max(0, absCamberDeg - 1.5) * 0.018);

      // 5. Substepped Wheel Spin + Longitudinal Pacejka + Combined Slip Circle
      const subDt = dt / WHEEL_SPIN_SUBSTEPS;
      const crr = (SURFACE_ROLLING_RESISTANCE[w.surface] ?? 0.014) * pressureRrFactor;
      const rollingResistTorque = crr * normalLoadN * wheelRadiusM;

      // Slip angle (smoothly attenuated near 0 m/s for clean low-speed stability)
      const speedScaleLat = clamp(Math.hypot(vLong, vLat) / 0.85, 0, 1);
      const slipAngleRad = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.35)) * speedScaleLat;

      let fyPure = -evaluatePacejka(slipAngleRad, {
        B: vehicle.pacejkaB,
        C: vehicle.pacejkaC,
        D: maxTireForceN * latCamberMult,
        E: vehicle.pacejkaE,
      });

      // Blend in smooth low-speed lateral viscous friction to kill jitter/drift on slopes at 0 km/h
      if (lowSpeedBlend > 0) {
        const latViscous = clamp(-vLat * normalLoadN * 0.75, -maxTireForceN, maxTireForceN);
        fyPure = fyPure * (1 - lowSpeedBlend) + latViscous * lowSpeedBlend;
      }

      let omega = w.angularVelocityRadS;
      let accumFx = 0;
      let lastKappa = 0;

      // Longitudinal slip speed denominator prevents low-speed kappa blowup
      const vLongDenom = Math.max(Math.abs(vLong), 1.8);

      for (let s = 0; s < WHEEL_SPIN_SUBSTEPS; s++) {
        const wheelLinearSpeed = omega * wheelRadiusM;
        const rawKappa = (wheelLinearSpeed - vLong) / vLongDenom;
        const kappa = clamp(rawKappa, -1.6, 1.6);
        lastKappa = kappa;

        const fxPure = evaluatePacejka(kappa, {
          B: vehicle.pacejkaB * 1.08,
          C: vehicle.pacejkaC * 1.06,
          D: maxTireForceN * longCamberMult,
          E: vehicle.pacejkaE,
        });

        // Combined friction ellipse
        const combined = combineFrictionCircle(fxPure, fyPure, maxTireForceN);
        const fxStep = combined.fx;
        accumFx += fxStep;

        // Wheel rotational equation: I * dOmega/dt = T_drive - Fx * R - T_roll - T_brake
        const netActiveTorque = w.driveTorqueNm - fxStep * wheelRadiusM;
        let nextOmega = omega + (netActiveTorque / wheelInertia) * subDt;

        // Passive opposing torques (service brake + handbrake + rolling resistance) strictly oppose spin & clamp to 0
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

      // Stationary parking hold (prevents micro-creep on banked tracks/hills at 0 km/h)
      if (isParkedHold) {
        const holdLong = clamp(-vLong * normalLoadN * 1.6, -maxTireForceN * 0.85, maxTireForceN * 0.85);
        const holdLat = clamp(-vLat * normalLoadN * 1.6, -maxTireForceN * 0.85, maxTireForceN * 0.85);
        const held = combineFrictionCircle(holdLong, holdLat, maxTireForceN * 0.9);
        fxFinal = held.fx;
        fyFinal = held.fy;
        w.angularVelocityRadS *= 0.5;
        w.slipRatio = 0;
        w.slipAngleRad = 0;
      }

      w.longitudinalForceN = fxFinal;
      w.lateralForceN = fyFinal;

      // Apply tire horizontal force at roll-center-adjusted contact point for authentic dive/squat/roll without rollover exploits
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
      const casterStability = (sus.casterFrontDeg / 6.0) * 140 * clamp(state.speedMs / 35, 0, 1.5);
      const yawDampTorque = -state.yawRateRadS * casterStability;
      state.torqueAccumulatorWorld.x += state.upWorld.x * yawDampTorque;
      state.torqueAccumulatorWorld.y += state.upWorld.y * yawDampTorque;
      state.torqueAccumulatorWorld.z += state.upWorld.z * yawDampTorque;
    }
  }
}

export const vehicleSolverPlugin: IModulusPlugin = new VehicleSolverPlugin();
