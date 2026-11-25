import type {
  IEngineContext,
  IInputState,
  IModulusPlugin,
  IVehicleRuntimeState,
} from '../../core/types';

const LOOKAHEAD_DISTANCES_M = [10, 22, 36, 52, 70, 90, 112, 135];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Physical AI Test Driver (`priority: 35`)
 * Active ONLY when `state.aiEnabled === true`.
 * - Pure Pursuit steering with dynamic speed-scaled lookahead (`12m + speedMs * 0.65`)
 *   plus yaw/body-slip damping so high-power FR/MR builds stay planted.
 * - 8-sample forward spline curvature braking + traction-limited corner-exit throttle.
 * - Automatic upshift/downshift and stuck/off-track auto-recovery.
 */
class AiTestDriverController {
  private ctx: IEngineContext | null = null;
  private smoothSteer = 0;
  private smoothThrottle = 0;
  private smoothBrake = 0;
  private shiftCooldownS = 0;
  private stuckTimerS = 0;

  public init(ctx: IEngineContext): void {
    this.ctx = ctx;
  }

  public dispose(): void {
    this.ctx = null;
  }

  public step(dt: number, state: IVehicleRuntimeState, input: IInputState): void {
    if (!this.ctx || !state.aiEnabled) {
      this.stuckTimerS = 0;
      return;
    }

    const trackGeom = this.ctx.getTrackGeometry();
    if (!trackGeom?.spline) return;

    const spline = trackGeom.spline;
    const vehicle = this.ctx.getCompiledVehicle();
    const balance = this.ctx.getBalanceConfig();

    const speedMs = Math.max(0, state.speedMs);
    const closest = spline.findClosestSample(state.position, state.splineProgress);
    const totalLen = Math.max(100, spline.totalLengthM);

    // 1. Auto-recovery if stuck off-track, stalled, or flipped
    const halfWidth = closest.sample.widthM * 0.5;
    const isOffTrack = Math.abs(closest.lateralOffsetM) > halfWidth + 3.0;
    const isFlipped = state.upWorld.y < 0.35;
    const isStalled = speedMs < 1.2;

    if (isFlipped || (isStalled && (isOffTrack || state.currentLapTimeMs > 3000))) {
      this.stuckTimerS += dt;
      if (this.stuckTimerS > 3.2) {
        this.stuckTimerS = 0;
        this.smoothSteer = 0;
        this.smoothThrottle = 0;
        this.smoothBrake = 0;
        input.resetVehicle = true;
        return;
      }
    } else {
      this.stuckTimerS = Math.max(0, this.stuckTimerS - dt * 2);
    }

    // 2. Pure Pursuit Steering Target (`12m + speedMs * 0.65`)
    const lookaheadM = 12 + speedMs * 0.65;
    const targetProgress = closest.sample.t + lookaheadM / totalLen;
    const targetSample = spline.sampleAtProgress(targetProgress);

    state.aiTargetPointWorld.x = targetSample.position.x;
    state.aiTargetPointWorld.y = targetSample.position.y;
    state.aiTargetPointWorld.z = targetSample.position.z;

    // Transform target into vehicle local coordinates (+Z forward, +X left)
    const dx = targetSample.position.x - state.position.x;
    const dy = targetSample.position.y - state.position.y;
    const dz = targetSample.position.z - state.position.z;

    const fwd = state.forwardWorld;
    const right = state.rightWorld;
    const leftX = -right.x;
    const leftY = -right.y;
    const leftZ = -right.z;

    const localZ = dx * fwd.x + dy * fwd.y + dz * fwd.z;
    const localX = dx * leftX + dy * leftY + dz * leftZ;
    const distSq = Math.max(4.0, localX * localX + localZ * localZ);

    let steerCmd: number;
    if (localZ < -1.5) {
      // Facing backwards relative to target — full lock toward target side
      steerCmd = localX >= 0 ? 1 : -1;
    } else {
      const purePursuitAngle = Math.atan2(2 * vehicle.wheelbaseM * localX, distSq);
      steerCmd = purePursuitAngle / (0.46 * (vehicle.steeringLockDeg / 30));
    }

    // Yaw & body-slip damping so high-power MR/FR cars don't snap-spin
    const vel = state.linearVelocityWorld;
    const vForward = vel.x * fwd.x + vel.y * fwd.y + vel.z * fwd.z;
    const vRight = vel.x * right.x + vel.y * right.y + vel.z * right.z;
    const bodySlipRad = vForward > 3.5 ? Math.atan2(vRight, vForward) : 0;

    // Sliding right (+vRight) -> counter-steer right (-steer)
    const slipDamping = -bodySlipRad * 0.68 - state.yawRateRadS * 0.12;
    const rawSteer = clamp(steerCmd + slipDamping, -1, 1);

    const steerBlend = clamp(dt * 14, 0, 1);
    this.smoothSteer += (rawSteer - this.smoothSteer) * steerBlend;

    // 3. Forward Spline Curvature Braking (8 samples: 10m..135m)
    const avgTireMu = (vehicle.peakTireMuFront + vehicle.peakTireMuRear) * 0.5;
    const muEff = avgTireMu * balance.physics_bias.pacejka_grip_mult * 0.84;
    const downforcePerKg = Math.max(0, state.downforceTotalN) / Math.max(550, vehicle.totalMassKg);
    const aBrake = Math.max(6.5, muEff * (9.81 + downforcePerKg * 0.75) * 0.82);

    let maxBrakeRequired = 0;
    let nearCornerTargetSpeed = 999;

    for (let i = 0; i < LOOKAHEAD_DISTANCES_M.length; i++) {
      const distM = LOOKAHEAD_DISTANCES_M[i];
      const sample = spline.sampleAtProgress(closest.sample.t + distM / totalLen);
      const curvature = Math.max(sample.curvature, 0.0008);
      const bankBoost = Math.abs(Math.sin(sample.bankRad)) * 9.81 * 0.65;
      const vTarget = Math.sqrt((muEff * (9.81 + downforcePerKg) + bankBoost) / curvature);

      if (i <= 2 && vTarget < nearCornerTargetSpeed) {
        nearCornerTargetSpeed = vTarget;
      }

      const v2Diff = speedMs * speedMs - vTarget * vTarget;
      if (v2Diff > 0) {
        const effDist = Math.max(4.0, distM - 5.0);
        const reqDecel = v2Diff / (2 * effDist);
        if (reqDecel > aBrake * 0.45) {
          const brakeFrac = clamp((reqDecel - aBrake * 0.42) / (aBrake * 0.65), 0, 1);
          if (brakeFrac > maxBrakeRequired) {
            maxBrakeRequired = brakeFrac;
          }
        }
      }
    }

    // 4. Progressive Traction-Limited Corner-Exit Throttle
    let targetBrake = maxBrakeRequired;
    let targetThrottle = 0;

    if (targetBrake > 0.06) {
      targetThrottle = 0;
    } else {
      targetBrake = 0;
      // Base throttle modulated by near-corner speed cap, steering angle, and body slip
      let speedCapFactor = 1.0;
      if (nearCornerTargetSpeed < 900 && speedMs > nearCornerTargetSpeed * 0.88) {
        speedCapFactor = clamp(
          1.0 - (speedMs - nearCornerTargetSpeed * 0.88) / Math.max(4, nearCornerTargetSpeed * 0.16),
          0.15,
          1.0
        );
      }

      const slipPenalty = clamp(Math.abs(bodySlipRad) * 2.2, 0, 0.75);
      const steerPenalty = clamp(Math.abs(this.smoothSteer) * 0.32, 0, 0.32);
      const pwrCaution = vehicle.pwrRatioHpPerKg > 0.35 ? 0.12 : 0.0;
      const tractionLimit = clamp(1.0 - slipPenalty - steerPenalty * (1 + pwrCaution), 0.22, 1.0);

      targetThrottle = clamp(speedCapFactor * tractionLimit, 0, 1);

      // Gentle crawl back onto track if off-track
      if (isOffTrack && speedMs > 18) {
        targetThrottle = Math.min(targetThrottle, 0.35);
      }
    }

    const pedalBlend = clamp(dt * 12, 0, 1);
    this.smoothThrottle += (targetThrottle - this.smoothThrottle) * pedalBlend;
    this.smoothBrake += (targetBrake - this.smoothBrake) * pedalBlend;

    // 5. Automatic Upshift / Downshift
    this.shiftCooldownS = Math.max(0, this.shiftCooldownS - dt);
    const maxGears = vehicle.build.drivetrain.gearRatios.length;
    let gearUp = false;
    let gearDown = false;

    if (this.shiftCooldownS <= 0 && !state.isShifting) {
      if (state.gear <= 0) {
        gearUp = true;
        this.shiftCooldownS = 0.35;
      } else if (state.engineRpm >= vehicle.redlineRpm * 0.94 && state.gear < maxGears) {
        gearUp = true;
        this.shiftCooldownS = Math.max(0.28, vehicle.shiftDurationSeconds + 0.18);
      } else if (
        state.engineRpm <= Math.max(vehicle.idleRpm + 1400, vehicle.redlineRpm * 0.46) &&
        state.gear > 1 &&
        (this.smoothBrake > 0.15 || this.smoothThrottle > 0.3)
      ) {
        gearDown = true;
        this.shiftCooldownS = Math.max(0.32, vehicle.shiftDurationSeconds + 0.2);
      }
    }

    // Write physical commands directly into IInputState
    input.steer = clamp(this.smoothSteer, -1, 1);
    input.throttle = clamp(this.smoothThrottle, 0, 1);
    input.brake = clamp(this.smoothBrake, 0, 1);
    input.handbrake = 0;
    input.clutch = 0;
    input.gearUp = gearUp;
    input.gearDown = gearDown;
    input.inputSource = 'ai';
  }
}

const aiController = new AiTestDriverController();

export const aiTestDriverPlugin: IModulusPlugin = {
  id: 'ai-test-driver',
  version: '1.0.0',
  priority: 35,
  init(ctx) {
    aiController.init(ctx);
  },
  onPhysicsStep(dt, state, input) {
    aiController.step(dt, state, input);
  },
  dispose() {
    aiController.dispose();
  },
};
