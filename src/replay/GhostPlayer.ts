import type { ITrackVersionMeta, Quat, Vec3 } from '../contracts/simulation';
import type { IGhostPlaybackPose, IGhostPoseSample, ITimeTrialReplayBundle } from './types';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

/**
 * Shortest-arc normalized quaternion SLERP for silky-smooth ghost rotation playback.
 */
export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;

  let cosHalfTheta = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cosHalfTheta < 0) {
    cosHalfTheta = -cosHalfTheta;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  if (cosHalfTheta >= 0.9995) {
    const x = lerp(a.x, bx, t);
    const y = lerp(a.y, by, t);
    const z = lerp(a.z, bz, t);
    const w = lerp(a.w, bw, t);
    const len = Math.hypot(x, y, z, w) || 1;
    return { x: x / len, y: y / len, z: z / len, w: w / len };
  }

  const halfTheta = Math.acos(Math.min(1, Math.max(-1, cosHalfTheta)));
  const sinHalfTheta = Math.sin(halfTheta);
  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

  return {
    x: a.x * ratioA + bx * ratioB,
    y: a.y * ratioA + by * ratioB,
    z: a.z * ratioA + bz * ratioB,
    w: a.w * ratioA + bw * ratioB,
  };
}

/**
 * Zero-collision visual Ghost Replay Player.
 * Consumes an ITimeTrialReplayBundle and outputs smoothly interpolated poses at any
 * simulation time (simTimeMs) or relative tick, plus live split/delta comparisons.
 */
export class GhostPlayer {
  private bundle: ITimeTrialReplayBundle | null = null;

  public load(bundle: ITimeTrialReplayBundle | null): void {
    this.bundle = bundle;
  }

  public getLoadedBundle(): ITimeTrialReplayBundle | null {
    return this.bundle;
  }

  public isLoaded(): boolean {
    return Boolean(this.bundle && this.bundle.poseSamples.length > 0);
  }

  public isCompatibleWithTrack(track: ITrackVersionMeta): boolean {
    if (!this.bundle) return false;
    return (
      this.bundle.header.track.trackId === track.trackId &&
      this.bundle.header.track.trackVersion === track.trackVersion
    );
  }

  public sampleAtSimTimeMs(simTimeMs: number): IGhostPlaybackPose | null {
    const samples = this.bundle?.poseSamples;
    if (!samples || samples.length === 0) return null;

    if (simTimeMs <= samples[0].simTimeMs) {
      return this.toPose(samples[0], false);
    }
    const last = samples[samples.length - 1];
    if (simTimeMs >= last.simTimeMs) {
      return this.toPose(last, true);
    }

    let lo = 0;
    let hi = samples.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (samples[mid].simTimeMs <= simTimeMs) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const a = samples[lo];
    const b = samples[lo + 1];
    const span = Math.max(1e-6, b.simTimeMs - a.simTimeMs);
    const alpha = Math.min(1, Math.max(0, (simTimeMs - a.simTimeMs) / span));

    return this.interpolateSamples(a, b, alpha, simTimeMs);
  }

  public sampleAtRelativeTick(relativeTick: number): IGhostPlaybackPose | null {
    const bundle = this.bundle;
    const samples = bundle?.poseSamples;
    if (!bundle || !samples || samples.length === 0) return null;

    const targetTick = bundle.header.startTick + Math.max(0, relativeTick);
    if (targetTick <= samples[0].tick) {
      return this.toPose(samples[0], false);
    }
    const last = samples[samples.length - 1];
    if (targetTick >= last.tick) {
      return this.toPose(last, true);
    }

    let lo = 0;
    let hi = samples.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (samples[mid].tick <= targetTick) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const a = samples[lo];
    const b = samples[lo + 1];
    const span = Math.max(1e-6, b.tick - a.tick);
    const alpha = Math.min(1, Math.max(0, (targetTick - a.tick) / span));
    return this.interpolateSamples(a, b, alpha, lerp(a.simTimeMs, b.simTimeMs, alpha));
  }

  /**
   * Estimates live time delta (ms) of the player vs the loaded ghost at the player's
   * current splineProgress (negative = player is ahead of ghost, positive = behind).
   */
  public computeLiveDeltaMs(playerSplineProgress: number, playerSimTimeMs: number): number | null {
    const samples = this.bundle?.poseSamples;
    if (!samples || samples.length < 2) return null;

    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (
        b.splineProgress >= a.splineProgress &&
        playerSplineProgress >= a.splineProgress &&
        playerSplineProgress <= b.splineProgress
      ) {
        const span = Math.max(1e-6, b.splineProgress - a.splineProgress);
        const alpha = (playerSplineProgress - a.splineProgress) / span;
        const ghostTimeAtProgress = lerp(a.simTimeMs, b.simTimeMs, alpha);
        return Math.round(playerSimTimeMs - ghostTimeAtProgress);
      }
    }
    return null;
  }

  private toPose(s: IGhostPoseSample, finished: boolean): IGhostPlaybackPose {
    return {
      collisionEnabled: false,
      tick: s.tick,
      simTimeMs: s.simTimeMs,
      position: { ...s.position },
      rotation: { ...s.rotation },
      speedMs: s.speedMs,
      engineRpm: s.engineRpm,
      gear: s.gear,
      frontWheelAngleRad: s.frontWheelAngleRad,
      wheelCompressionM: [...s.wheelCompressionM] as [number, number, number, number],
      wheelRotationRad: [...s.wheelRotationRad] as [number, number, number, number],
      brakeLightOn: s.brakeLightOn,
      skidIntensity: s.skidIntensity,
      splineProgress: s.splineProgress,
      finished,
    };
  }

  private interpolateSamples(
    a: IGhostPoseSample,
    b: IGhostPoseSample,
    alpha: number,
    simTimeMs: number
  ): IGhostPlaybackPose {
    return {
      collisionEnabled: false,
      tick: Math.round(lerp(a.tick, b.tick, alpha)),
      simTimeMs,
      position: lerpVec3(a.position, b.position, alpha),
      rotation: slerpQuat(a.rotation, b.rotation, alpha),
      speedMs: lerp(a.speedMs, b.speedMs, alpha),
      engineRpm: lerp(a.engineRpm, b.engineRpm, alpha),
      gear: alpha < 0.5 ? a.gear : b.gear,
      frontWheelAngleRad: lerp(a.frontWheelAngleRad, b.frontWheelAngleRad, alpha),
      wheelCompressionM: [
        lerp(a.wheelCompressionM[0], b.wheelCompressionM[0], alpha),
        lerp(a.wheelCompressionM[1], b.wheelCompressionM[1], alpha),
        lerp(a.wheelCompressionM[2], b.wheelCompressionM[2], alpha),
        lerp(a.wheelCompressionM[3], b.wheelCompressionM[3], alpha),
      ],
      wheelRotationRad: [
        lerp(a.wheelRotationRad[0], b.wheelRotationRad[0], alpha),
        lerp(a.wheelRotationRad[1], b.wheelRotationRad[1], alpha),
        lerp(a.wheelRotationRad[2], b.wheelRotationRad[2], alpha),
        lerp(a.wheelRotationRad[3], b.wheelRotationRad[3], alpha),
      ],
      brakeLightOn: alpha < 0.5 ? a.brakeLightOn : b.brakeLightOn,
      skidIntensity: lerp(a.skidIntensity, b.skidIntensity, alpha),
      splineProgress: lerp(a.splineProgress, b.splineProgress, alpha),
      finished: false,
    };
  }
}
