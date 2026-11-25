import type { AssistPreset } from '../../contracts/simulation';
import type { IVehicleRuntimeState } from '../../core/types';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export interface IRawDriverAxes {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (right) .. +1 (left)
  handbrake: number; // 0..1
}

export interface IShapedDriverAxes {
  throttle: number;
  brake: number;
  steer: number; // -1 (right) .. +1 (left), post speed-authority + counter-steer assist
  handbrake: number;
}

/**
 * Computes speed-progressive steering authority [0.16 .. 1.0].
 * Gives full ~30 deg lock at parking speeds (0..7 mph) and progressively narrows
 * front wheel authority across 15..60+ mph so keyboard steering stays right inside
 * the Pacejka peak slip window instead of slamming 31 deg at 35 mph.
 */
export function computeSpeedSteerAuthority(speedMs: number): number {
  const v = Math.max(0, speedMs);
  if (v <= 3.0) return 1.0;
  return clamp(1 / (1 + Math.pow((v - 3.0) / 11.5, 1.35)), 0.16, 1.0);
}

/**
 * Deterministic Fixed-Step Driver Input Shaper.
 * Runs inside the 120 Hz physics step from raw bounded driver inputs so live runs,
 * replays, and Friend Race clients produce identical steering & pedal trajectories.
 */
export class DeterministicInputShaper {
  private throttle = 0;
  private brake = 0;
  private steer = 0;
  private handbrake = 0;

  public reset(): void {
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.handbrake = 0;
  }

  public step(
    dt: number,
    raw: IRawDriverAxes,
    state: Pick<IVehicleRuntimeState, 'speedMs' | 'localVelocity' | 'yawRateRadS'>,
    assistPreset: AssistPreset
  ): IShapedDriverAxes {
    const throttleTarget = clamp(raw.throttle, 0, 1);
    const brakeTarget = clamp(raw.brake, 0, 1);
    const handbrakeTarget = clamp(raw.handbrake, 0, 1);
    const rawSteer = clamp(raw.steer, -1, 1);

    // Progressive pedal ramping: smooth engagement prevents sudden tire shock on keyboard taps
    const throttleRate = throttleTarget > this.throttle ? 6.5 : 14.0;
    const brakeRate = brakeTarget > this.brake ? 7.5 : 16.0;
    this.throttle = moveTowards(this.throttle, throttleTarget, throttleRate * dt);
    this.brake = moveTowards(this.brake, brakeTarget, brakeRate * dt);
    this.handbrake = moveTowards(this.handbrake, handbrakeTarget, 14.0 * dt);

    // Speed-progressive steering authority (smoothly active from ~7 mph upward)
    const speedMs = Math.max(0, state.speedMs);
    const authority = computeSpeedSteerAuthority(speedMs);
    const targetSteer = rawSteer * authority;

    // Prompt initial turn-in on small taps, faster crisp recentering/counter-steer reversal
    const isReturning =
      Math.abs(rawSteer) < 0.02 || Math.sign(targetSteer) !== Math.sign(this.steer);
    const baseTurnInRate = clamp(4.2 - (speedMs / 35) * 1.4, 2.4, 4.2);
    // Boost initial bite near center so quick line-correction taps feel immediate
    const nearCenterBoost = Math.abs(this.steer) < authority * 0.35 ? 1.25 : 1.0;
    const steerRate = isReturning ? 7.8 : baseTurnInRate * nearCenterBoost;

    this.steer = moveTowards(this.steer, targetSteer, steerRate * dt);

    // Catchable counter-steer assist scaled by assistPreset (0 in Pro, reduced under handbrake)
    let counterSteer = 0;
    const assistGain =
      assistPreset === 'beginner' ? 0.44 : assistPreset === 'sport' ? 0.24 : 0.0;

    if (assistGain > 0 && state.localVelocity.z > 5.0) {
      const bodySlipRad = Math.atan2(state.localVelocity.x, state.localVelocity.z);
      const speedBlend = clamp((state.localVelocity.z - 5.0) / 10.0, 0, 1);
      const handbrakeScale = 1.0 - this.handbrake * 0.7;
      // Sliding right (+vRight -> +bodySlipRad) -> counter-steer right (-steer)
      counterSteer =
        clamp(-bodySlipRad * assistGain, -0.32, 0.32) * speedBlend * handbrakeScale;
    }

    const finalSteer = clamp(this.steer + counterSteer, -1, 1);

    return {
      throttle: this.throttle,
      brake: this.brake,
      steer: finalSteer,
      handbrake: this.handbrake,
    };
  }
}
