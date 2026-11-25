import {
  DEFAULT_BALANCE_CONFIG,
  type ICompiledVehicle,
  type IDynoPoint,
  type IEngineContext,
  type IGlobalBalanceConfig,
  type IInputState,
  type IModulusPlugin,
  type IVehicleRuntimeState,
  type WheelIndex,
} from '../../core/types';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

interface DynoSample {
  torqueNm: number;
  boostBar: number;
}

function sampleDynoCurve(curve: IDynoPoint[], rpm: number): DynoSample {
  const len = curve.length;
  if (len === 0) {
    return { torqueNm: 180, boostBar: 0 };
  }
  if (rpm <= curve[0].rpm) {
    const p0 = curve[0];
    const ratio = clamp(rpm / Math.max(1, p0.rpm), 0.35, 1.0);
    return {
      torqueNm: p0.torqueNm * (0.62 + 0.38 * ratio),
      boostBar: p0.boostBar * ratio,
    };
  }
  const last = curve[len - 1];
  if (rpm >= last.rpm) {
    const over = rpm - last.rpm;
    const taper = Math.max(0.1, 1 - over / 600);
    return {
      torqueNm: last.torqueNm * taper,
      boostBar: last.boostBar,
    };
  }

  const estIdx = Math.floor((rpm - curve[0].rpm) / 250);
  let i = clamp(estIdx, 0, len - 2);
  while (i > 0 && curve[i].rpm > rpm) i--;
  while (i < len - 2 && curve[i + 1].rpm < rpm) i++;

  const a = curve[i];
  const b = curve[i + 1];
  const span = Math.max(1, b.rpm - a.rpm);
  const t = clamp((rpm - a.rpm) / span, 0, 1);

  return {
    torqueNm: a.torqueNm + (b.torqueNm - a.torqueNm) * t,
    boostBar: a.boostBar + (b.boostBar - a.boostBar) * t,
  };
}

function distributeAxleDifferential(
  axleTorqueNm: number,
  omegaLeft: number,
  omegaRight: number,
  diffType: ICompiledVehicle['build']['drivetrain']['differentialType'],
  accelLockPct: number,
  decelLockPct: number,
  isForwardDrive: boolean
): [number, number] {
  const halfTorque = axleTorqueNm * 0.5;
  const deltaOmega = omegaLeft - omegaRight;
  const isAccel = isForwardDrive ? axleTorqueNm >= 0 : axleTorqueNm <= 0;
  const absTorque = Math.abs(axleTorqueNm);

  let lockTorque = 0;
  const stabilityCap = Math.abs(deltaOmega) * 28;

  if (diffType === 'Open') {
    lockTorque = clamp(deltaOmega * 3.0, -20, 20);
  } else if (diffType === 'Torsen') {
    const lockFrac = (isAccel ? accelLockPct : decelLockPct * 0.35) / 100;
    const maxBiasTransfer = absTorque * clamp(lockFrac * 0.52, 0, 0.42);
    const desired = maxBiasTransfer * Math.tanh(deltaOmega * 0.25);
    lockTorque = clamp(desired, -stabilityCap, stabilityCap);
  } else {
    let lockFrac = 0;
    let preloadNm = 0;
    if (diffType === '1-Way LSD') {
      lockFrac = isAccel ? accelLockPct / 100 : 0.04;
      preloadNm = 30;
    } else if (diffType === '1.5-Way LSD') {
      lockFrac = isAccel ? accelLockPct / 100 : (decelLockPct / 100) * 0.55;
      preloadNm = 45;
    } else {
      lockFrac = isAccel ? accelLockPct / 100 : decelLockPct / 100;
      preloadNm = 60;
    }

    const rampTransfer = absTorque * lockFrac * 0.62;
    const totalLockCap = Math.min(preloadNm + rampTransfer, stabilityCap);
    const viscousLock = deltaOmega * (16 + lockFrac * 20);
    lockTorque = clamp(viscousLock, -totalLockCap, totalLockCap);
  }

  return [halfTorque - lockTorque, halfTorque + lockTorque];
}

export class PowertrainPlugin implements IModulusPlugin {
  public readonly id = 'powertrain';
  public readonly version = '2.0.0';
  public readonly priority = 40;

  private ctx: IEngineContext | null = null;
  private vehicle: ICompiledVehicle | null = null;
  private balanceConfig: IGlobalBalanceConfig = DEFAULT_BALANCE_CONFIG;
  private unsubscribeReset: (() => void) | null = null;

  private pendingTargetGear: number | null = null;
  private revLimiterCutTimerS = 0;
  private autoShiftCooldownS = 0;

  public init(ctx: IEngineContext): void {
    this.ctx = ctx;
    this.vehicle = ctx.getCompiledVehicle();
    this.balanceConfig = ctx.getBalanceConfig();
    this.unsubscribeReset = ctx.events.on('vehicle:reset', () => {
      this.resetInternalState();
    });
  }

  public onBalanceConfigUpdated(config: IGlobalBalanceConfig): void {
    this.balanceConfig = config;
  }

  public onBuildCompiled(vehicle: ICompiledVehicle): void {
    this.vehicle = vehicle;
    this.pendingTargetGear = null;
  }

  private resetInternalState(): void {
    this.pendingTargetGear = null;
    this.revLimiterCutTimerS = 0;
    this.autoShiftCooldownS = 0;
  }

  public onPhysicsStep(dt: number, state: IVehicleRuntimeState, input: IInputState): void {
    const vehicle = this.vehicle ?? this.ctx?.getCompiledVehicle();
    if (!vehicle) return;

    const { build } = vehicle;
    const gearRatios = build.drivetrain.gearRatios;
    const maxGear = gearRatios.length;
    const finalDrive = build.drivetrain.finalDriveRatio;
    const drivetrain = build.chassis.drivetrain;

    const drivenIndices: WheelIndex[] =
      drivetrain === 'FF'
        ? [0, 1]
        : drivetrain === 'AWD'
          ? [0, 1, 2, 3]
          : [2, 3];

    let avgDrivenOmega = 0;
    let groundedDrivenCount = 0;
    let maxDrivenSlip = 0;
    for (let i = 0; i < drivenIndices.length; i++) {
      const w = state.wheels[drivenIndices[i]];
      avgDrivenOmega += w.angularVelocityRadS;
      if (w.grounded) groundedDrivenCount++;
      const absSlip = Math.abs(w.slipRatio);
      if (absSlip > maxDrivenSlip) maxDrivenSlip = absSlip;
    }
    avgDrivenOmega /= drivenIndices.length;

    // 1. Timers
    if (this.revLimiterCutTimerS > 0) {
      this.revLimiterCutTimerS = Math.max(0, this.revLimiterCutTimerS - dt);
    }
    if (this.autoShiftCooldownS > 0) {
      this.autoShiftCooldownS = Math.max(0, this.autoShiftCooldownS - dt);
    }

    const startShift = (nextGear: number, isManual: boolean) => {
      const clampedGear = clamp(nextGear, -1, maxGear);
      if (clampedGear === state.gear) return;
      this.pendingTargetGear = clampedGear;
      state.isShifting = true;
      state.shiftDirection = clampedGear > state.gear ? 1 : -1;
      state.shiftTimerS = Math.max(0.02, vehicle.shiftDurationSeconds);
      this.autoShiftCooldownS = isManual ? 1.25 : 0.4;
    };

    // 2. Deterministic Standstill Reverse-on-Fresh-Press State Machine
    //    - W accelerates forward. S brakes while moving.
    //    - Holding S through a stop enters `stopped_brake_held` and keeps car stopped in 1st gear.
    //    - Releasing S at standstill enters `reverse_ready`.
    //    - A fresh press of S from `reverse_ready` shifts cleanly into Reverse (`gear = -1`).
    //    - While in Reverse, S drives backward; W brakes to a stop and shifts back to 1st gear.
    const vFwd = state.localVelocity.z;
    const atStandstill = Math.abs(vFwd) <= 0.35;

    if (!state.aiEnabled) {
      if (state.gear === -1) {
        state.reverseState = 'reverse';
        if (input.throttle > 0.12 && vFwd >= -0.35) {
          state.reverseState = 'forward';
          if (!state.isShifting) startShift(1, false);
        }
      } else {
        if (vFwd > 0.4) {
          state.reverseState = 'forward';
        } else if (atStandstill) {
          if (state.reverseState === 'forward' && input.brake > 0.08) {
            state.reverseState = 'stopped_brake_held';
          } else if (state.reverseState === 'stopped_brake_held' && input.brake < 0.06) {
            state.reverseState = 'reverse_ready';
          } else if (state.reverseState === 'forward' && input.brake < 0.06) {
            state.reverseState = 'reverse_ready';
          } else if (
            state.reverseState === 'reverse_ready' &&
            (input.brakeFreshPress || input.reverseRequest || input.brake > 0.25) &&
            input.throttle < 0.08
          ) {
            state.reverseState = 'reverse';
            if (!state.isShifting) {
              state.gear = -1;
              this.pendingTargetGear = null;
              state.shiftDirection = -1;
            }
          }
        }
      }
    } else {
      state.reverseState = state.gear === -1 ? 'reverse' : 'forward';
    }

    // 3. Shift state machine & gear selection (Manual + Auto Transmission)
    if (state.isShifting) {
      state.shiftTimerS -= dt;
      if (state.shiftTimerS <= 0) {
        state.isShifting = false;
        state.shiftTimerS = 0;
        if (this.pendingTargetGear !== null) {
          state.gear = this.pendingTargetGear;
          this.pendingTargetGear = null;
        }
        state.shiftDirection = 0;
      }
    } else {
      state.shiftDirection = 0;
      if (input.gearUp) {
        if (state.gear < maxGear) {
          const next = state.gear === -1 ? 1 : state.gear + 1;
          if (next >= 1) state.reverseState = 'forward';
          startShift(next, true);
        }
      } else if (input.gearDown) {
        // Downshifts carry ZERO damage penalty per rebuild plan
        if (state.gear > -1) {
          if (state.gear === 1 && vFwd > 2.5) {
            // Prevent accidental reverse engagement at forward road speed
          } else {
            const next = state.gear === 1 ? -1 : state.gear - 1;
            if (next === -1) state.reverseState = 'reverse';
            startShift(next, true);
          }
        }
      } else if (
        this.autoShiftCooldownS <= 0 &&
        (state.transmissionMode === 'auto' || state.aiEnabled)
      ) {
        if (state.gear === 0 && input.throttle > 0.2) {
          startShift(1, false);
        } else if (state.gear >= 1) {
          const upshiftRpm = Math.min(vehicle.revLimiterRpm - 180, vehicle.redlineRpm + 80);
          const hitLimiterEmergency = state.engineRpm >= vehicle.revLimiterRpm - 60;
          if (
            state.gear < maxGear &&
            input.throttle > 0.25 &&
            groundedDrivenCount > 0 &&
            ((state.engineRpm >= upshiftRpm && maxDrivenSlip < 0.32) || hitLimiterEmergency)
          ) {
            startShift(state.gear + 1, false);
          } else if (state.gear > 1) {
            const lowerRatio = gearRatios[state.gear - 2] * finalDrive;
            const projectedRpm = Math.abs(avgDrivenOmega * lowerRatio * 60) / (2 * Math.PI);
            const downshiftCeiling = vehicle.redlineRpm * 0.74;
            const bandFrac = input.brake > 0.2 ? 0.44 : input.throttle > 0.7 ? 0.24 : 0.32;
            const lowBandRpm = vehicle.idleRpm + (vehicle.redlineRpm - vehicle.idleRpm) * bandFrac;

            if (state.engineRpm < lowBandRpm && projectedRpm < downshiftCeiling) {
              startShift(state.gear - 1, false);
            }
          }
        }
      }
    }

    const activeGearRatio =
      state.gear === 0
        ? 0
        : state.gear === -1
          ? -(gearRatios[0] * 0.85)
          : gearRatios[clamp(state.gear - 1, 0, maxGear - 1)] ?? 1.0;
    const totalRatio = activeGearRatio * finalDrive;

    // 4. Dyno lookup & Dynamic Turbo Boost Spool
    const dyno = sampleDynoCurve(vehicle.dynoCurve, state.engineRpm);
    const aspiration = build.engine.aspiration;

    // In reverse gear, S (input.brake) drives reverse throttle (capped gently for predictable low-speed reversing)
    const isReversing = state.gear === -1 && state.reverseState === 'reverse';
    const rawDriveCmd = isReversing
      ? clamp(input.brake, 0, 1) * (Math.abs(vFwd) > 7.5 ? 0.12 : 0.78)
      : clamp(input.throttle, 0, 1);

    let effectiveThrottle = rawDriveCmd;
    if (state.isShifting) {
      const isDownshift = this.pendingTargetGear !== null && this.pendingTargetGear < state.gear;
      effectiveThrottle = isDownshift ? 0.28 : 0.0;
    }

    const turboLagMult = Math.max(0.25, this.balanceConfig.physics_bias.turbo_lag_mult);
    let boostGain = 0.72;

    if (aspiration === 'Naturally Aspirated') {
      state.turboBoostBar = 0;
    } else if (aspiration === 'Supercharger') {
      boostGain = 0.62;
      const targetBoost = dyno.boostBar * (0.2 + 0.8 * effectiveThrottle);
      const rate = 18.0 / Math.sqrt(turboLagMult);
      state.turboBoostBar += (targetBoost - state.turboBoostBar) * Math.min(1, rate * dt);
    } else {
      const baseSpoolRate = aspiration === 'Twin-Turbo' ? 5.8 : 3.8;
      const spoolUpRate = baseSpoolRate / turboLagMult;
      const isFlatShift = state.isShifting && vehicle.shiftDurationSeconds <= 0.08;
      const spoolDownRate = isFlatShift ? 1.8 : 6.2;

      const targetBoost =
        state.engineBlown || state.fuelLiters <= 0
          ? 0
          : dyno.boostBar * (0.1 + 0.9 * effectiveThrottle);

      const rate = targetBoost >= state.turboBoostBar ? spoolUpRate : spoolDownRate;
      state.turboBoostBar += (targetBoost - state.turboBoostBar) * Math.min(1, rate * dt);
      state.turboBoostBar = clamp(state.turboBoostBar, 0, vehicle.maxBoostBar);
    }

    // 5. Engine Torque Calculation (soft rev limiter, limp mode, driveline damage)
    const dynoBoostMult = 1 + dyno.boostBar * boostGain;
    const liveBoostMult = 1 + state.turboBoostBar * boostGain;
    const dynamicWotTorqueNm = dyno.torqueNm * (liveBoostMult / Math.max(0.5, dynoBoostMult));

    // Progressive soft rev-limiter taper over final 160 RPM before hard fuel cut
    let limiterScale = 1.0;
    if (state.engineRpm >= vehicle.revLimiterRpm) {
      this.revLimiterCutTimerS = 0.024;
      limiterScale = 0;
    } else if (state.engineRpm > vehicle.revLimiterRpm - 160) {
      limiterScale = clamp((vehicle.revLimiterRpm - state.engineRpm) / 160, 0.15, 1.0);
    }

    // Gentle traction-control assist in Beginner / Sport presets (0 intervention in Pro)
    let tcScale = 1.0;
    if (!state.aiEnabled && state.gear >= 1 && effectiveThrottle > 0.15) {
      const tcThresh =
        state.assistPreset === 'beginner'
          ? 0.22
          : state.assistPreset === 'sport'
            ? 0.36
            : 99;
      if (maxDrivenSlip > tcThresh) {
        const excess = maxDrivenSlip - tcThresh;
        tcScale = clamp(1 - excess * (state.assistPreset === 'beginner' ? 1.8 : 1.1), 0.32, 1.0);
      }
    }

    let combustionTorqueNm = 0;
    const canFire =
      !state.engineBlown &&
      state.fuelLiters > 0.0001 &&
      this.revLimiterCutTimerS <= 0;

    if (canFire) {
      combustionTorqueNm = dynamicWotTorqueNm * effectiveThrottle * limiterScale * tcScale;

      if (state.engineLimpMode) {
        combustionTorqueNm *= 0.65;
      }

      if (state.engineRpm < vehicle.idleRpm + 120) {
        const deficit = clamp((vehicle.idleRpm + 120 - state.engineRpm) / 450, 0, 1);
        combustionTorqueNm = Math.max(combustionTorqueNm, dynamicWotTorqueNm * 0.25 * deficit);
      }
    }

    const rpmFrac = clamp(
      (state.engineRpm - vehicle.idleRpm) / Math.max(500, vehicle.revLimiterRpm - vehicle.idleRpm),
      0,
      1.2
    );
    const engineBrakeScale = 16 + build.engine.displacementL * 13;
    const closedThrottleFrac = 1 - effectiveThrottle * 0.85;
    const engineFrictionTorqueNm = -engineBrakeScale * (0.18 + 0.82 * rpmFrac) * closedThrottleFrac;

    const netEngineTorqueNm = combustionTorqueNm + engineFrictionTorqueNm;

    // 6. Smooth Progressive Launch Clutch & RPM Coupling
    const wheelImpliedRpm = (avgDrivenOmega * totalRatio * 60) / (2 * Math.PI);
    const inGear = state.gear !== 0 && !state.isShifting;

    if (!inGear) {
      state.clutchEngagement = 0;
    } else {
      const manualClutch = 1 - clamp(input.clutch, 0, 1);
      if (Math.abs(state.gear) === 1 && Math.abs(vFwd) < 2.6) {
        // Crisp progressive launch slip: transmits ~78-100% torque smoothly without redline wheelspin shock
        const launchProgress = clamp(Math.abs(vFwd) / 2.2, 0, 1);
        const launchEngage =
          effectiveThrottle > 0.05
            ? clamp(0.78 + 0.22 * launchProgress, 0.78, 1.0)
            : clamp(launchProgress, 0.15, 1.0);
        state.clutchEngagement = manualClutch * launchEngage;
      } else {
        state.clutchEngagement = Math.min(manualClutch, state.clutchEngagement + dt * 16);
      }
    }

    const engineInertia = Math.max(0.08, vehicle.engineRotationalInertiaKgM2);
    const omegaEngine = (state.engineRpm * 2 * Math.PI) / 60;

    if (!inGear || state.clutchEngagement < 0.05 || groundedDrivenCount === 0) {
      const alphaEng = netEngineTorqueNm / engineInertia;
      const nextOmega = omegaEngine + alphaEng * dt;
      state.engineRpm = (nextOmega * 60) / (2 * Math.PI);
    } else {
      // Smooth launch RPM slip band so engine builds torque cleanly off the line without limiter bounce or RPM dip
      const slipBlend =
        Math.abs(state.gear) === 1 ? clamp(1 - Math.abs(vFwd) / 5.5, 0, 1) : 0;
      const slipFloorRpm =
        vehicle.idleRpm + (1850 * effectiveThrottle) * slipBlend;
      const launchTargetRpm = Math.max(
        vehicle.idleRpm * 0.88,
        slipFloorRpm,
        Math.min(wheelImpliedRpm, slipBlend > 0.15 ? vehicle.redlineRpm * 0.72 : vehicle.revLimiterRpm + 200)
      );
      const targetOmega = (launchTargetRpm * 2 * Math.PI) / 60;
      const freeNextOmega = omegaEngine + (netEngineTorqueNm / engineInertia) * dt;
      const lockStrength = clamp(state.clutchEngagement * 22 * dt, 0, 0.9);
      const coupledOmega = freeNextOmega + (targetOmega - freeNextOmega) * lockStrength;
      state.engineRpm = (coupledOmega * 60) / (2 * Math.PI);
    }

    state.engineRpm = clamp(
      state.engineRpm,
      state.engineBlown ? 0 : vehicle.idleRpm * 0.8,
      vehicle.revLimiterRpm + 180
    );

    state.engineTorqueNm = netEngineTorqueNm;
    state.enginePowerHp = Math.max(0, (combustionTorqueNm * state.engineRpm) / 7127);
    state.engineLoad = clamp(
      canFire ? effectiveThrottle * (0.35 + 0.65 * clamp(combustionTorqueNm / Math.max(40, vehicle.peakTorqueNm), 0, 1.2)) : 0,
      0,
      1
    );

    // 7. Dynamic Fuel Consumption
    if (!state.engineBlown && state.fuelLiters > 0) {
      const powerFrac = clamp(state.enginePowerHp / Math.max(1, vehicle.peakPowerHp), 0, 1.25);
      const burnRateLPerS = vehicle.fuelBurnRateLPerSecAtMaxPower * (0.035 + 0.965 * powerFrac);
      state.fuelLiters = Math.max(0, state.fuelLiters - burnRateLPerS * dt);
    }

    // 8. Wheel Drive Torque Distribution & Differential Vectoring (with driveline damage factor)
    for (let i = 0; i < 4; i++) {
      state.wheels[i].driveTorqueNm = 0;
    }

    const drivelineHealth = 1 - clamp(state.damageZones[9] ?? 0, 0, 1) * 0.32;

    if (inGear && state.clutchEngagement > 0.02 && Math.abs(totalRatio) > 0.01) {
      let totalWheelTorqueNm =
        netEngineTorqueNm *
        totalRatio *
        vehicle.drivetrainLossEfficiency *
        drivelineHealth *
        state.clutchEngagement;

      if (state.gear >= 1 && Math.abs(avgDrivenOmega) < 0.8 && totalWheelTorqueNm < 0) {
        totalWheelTorqueNm *= clamp(Math.abs(avgDrivenOmega) / 0.8, 0, 1);
      } else if (state.gear === -1 && Math.abs(avgDrivenOmega) < 0.8 && totalWheelTorqueNm > 0) {
        totalWheelTorqueNm *= clamp(Math.abs(avgDrivenOmega) / 0.8, 0, 1);
      }

      const diffType = build.drivetrain.differentialType;
      const accelLock = build.drivetrain.diffAccelLockPct;
      const decelLock = build.drivetrain.diffDecelLockPct;
      const isForward = state.gear > 0;

      if (drivetrain === 'FF') {
        const [tFL, tFR] = distributeAxleDifferential(
          totalWheelTorqueNm,
          state.wheels[0].angularVelocityRadS,
          state.wheels[1].angularVelocityRadS,
          diffType,
          accelLock,
          decelLock,
          isForward
        );
        state.wheels[0].driveTorqueNm = tFL;
        state.wheels[1].driveTorqueNm = tFR;
      } else if (drivetrain === 'AWD') {
        const avgFront = 0.5 * (state.wheels[0].angularVelocityRadS + state.wheels[1].angularVelocityRadS);
        const avgRear = 0.5 * (state.wheels[2].angularVelocityRadS + state.wheels[3].angularVelocityRadS);
        const centerTransfer = clamp(
          (avgFront - avgRear) * 260,
          -Math.abs(totalWheelTorqueNm) * 0.25,
          Math.abs(totalWheelTorqueNm) * 0.25
        );

        const frontAxleTorque = totalWheelTorqueNm * 0.42 - centerTransfer;
        const rearAxleTorque = totalWheelTorqueNm * 0.58 + centerTransfer;

        const [tFL, tFR] = distributeAxleDifferential(
          frontAxleTorque,
          state.wheels[0].angularVelocityRadS,
          state.wheels[1].angularVelocityRadS,
          diffType,
          accelLock * 0.85,
          decelLock * 0.85,
          isForward
        );
        const [tRL, tRR] = distributeAxleDifferential(
          rearAxleTorque,
          state.wheels[2].angularVelocityRadS,
          state.wheels[3].angularVelocityRadS,
          diffType,
          accelLock,
          decelLock,
          isForward
        );
        state.wheels[0].driveTorqueNm = tFL;
        state.wheels[1].driveTorqueNm = tFR;
        state.wheels[2].driveTorqueNm = tRL;
        state.wheels[3].driveTorqueNm = tRR;
      } else {
        const [tRL, tRR] = distributeAxleDifferential(
          totalWheelTorqueNm,
          state.wheels[2].angularVelocityRadS,
          state.wheels[3].angularVelocityRadS,
          diffType,
          accelLock,
          decelLock,
          isForward
        );
        state.wheels[2].driveTorqueNm = tRL;
        state.wheels[3].driveTorqueNm = tRR;
      }
    }
  }

  public dispose(): void {
    this.unsubscribeReset?.();
    this.unsubscribeReset = null;
  }
}

export const powertrainPlugin: IModulusPlugin = new PowertrainPlugin();
