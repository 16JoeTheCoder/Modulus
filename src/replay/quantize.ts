import type {
  DamageZoneTuple,
  ICompactVehicleNetSnapshot,
  IFixedStepInputFrame,
  InputSourceKind,
  IQuantizedInputFrame,
  IVehicleStateSnapshot,
  VehicleControllerKind,
} from '../contracts/simulation';
import type { IGhostPoseSample, IPackedInputRun } from './types';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function quantizeUnit01(value: number): number {
  const c = clamp(Number.isFinite(value) ? value : 0, 0, 1);
  return Math.round(c * 65535);
}

export function dequantizeUnit01(q: number): number {
  const c = clamp(Number.isFinite(q) ? q : 0, 0, 65535);
  return c / 65535;
}

export function quantizeSigned1(value: number): number {
  const c = clamp(Number.isFinite(value) ? value : 0, -1, 1);
  return Math.round(c * 32767);
}

export function dequantizeSigned1(q: number): number {
  const c = clamp(Number.isFinite(q) ? q : 0, -32767, 32767);
  return c / 32767;
}

export function quantizeInputFrame(frame: IFixedStepInputFrame): IQuantizedInputFrame {
  return {
    tick: frame.tick >>> 0,
    vehicleId: frame.vehicleId,
    throttleQ: quantizeUnit01(frame.throttle),
    brakeQ: quantizeUnit01(frame.brake),
    steerQ: quantizeSigned1(frame.steer),
    handbrakeQ: quantizeUnit01(frame.handbrake),
    clutchQ: quantizeUnit01(frame.clutch),
    flags: frame.flags & 0xff,
  };
}

export function dequantizeInputFrame(
  q: IQuantizedInputFrame,
  controllerKind: VehicleControllerKind = 'replay',
  inputSource: InputSourceKind = 'replay'
): IFixedStepInputFrame {
  return {
    tick: q.tick >>> 0,
    vehicleId: q.vehicleId,
    controllerKind,
    inputSource,
    throttle: dequantizeUnit01(q.throttleQ),
    brake: dequantizeUnit01(q.brakeQ),
    steer: dequantizeSigned1(q.steerQ),
    handbrake: dequantizeUnit01(q.handbrakeQ),
    clutch: dequantizeUnit01(q.clutchQ),
    flags: q.flags & 0xff,
  };
}

/**
 * Lossless run-length encoding for consecutive identical quantized input frames.
 * Edge-triggered flags (non-zero flags) are never coalesced across more than 1 tick.
 */
export function packQuantizedInputs(frames: readonly IQuantizedInputFrame[]): IPackedInputRun[] {
  const runs: IPackedInputRun[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const prev = runs.length > 0 ? runs[runs.length - 1] : null;
    const canCoalesce =
      prev !== null &&
      f.flags === 0 &&
      prev.flags === 0 &&
      f.tick === prev.startTick + prev.repeatCount &&
      f.throttleQ === prev.throttleQ &&
      f.brakeQ === prev.brakeQ &&
      f.steerQ === prev.steerQ &&
      f.handbrakeQ === prev.handbrakeQ &&
      f.clutchQ === prev.clutchQ;

    if (canCoalesce && prev) {
      prev.repeatCount += 1;
    } else {
      runs.push({
        startTick: f.tick,
        repeatCount: 1,
        throttleQ: f.throttleQ,
        brakeQ: f.brakeQ,
        steerQ: f.steerQ,
        handbrakeQ: f.handbrakeQ,
        clutchQ: f.clutchQ,
        flags: f.flags,
      });
    }
  }
  return runs;
}

export function unpackQuantizedInputs(
  runs: readonly IPackedInputRun[],
  vehicleId: string
): IQuantizedInputFrame[] {
  const frames: IQuantizedInputFrame[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    for (let k = 0; k < run.repeatCount; k++) {
      frames.push({
        tick: run.startTick + k,
        vehicleId,
        throttleQ: run.throttleQ,
        brakeQ: run.brakeQ,
        steerQ: run.steerQ,
        handbrakeQ: run.handbrakeQ,
        clutchQ: run.clutchQ,
        flags: run.flags,
      });
    }
  }
  return frames;
}

export function vehicleSnapshotToCompactNet(
  snap: IVehicleStateSnapshot
): ICompactVehicleNetSnapshot {
  const maxScrub = Math.max(
    snap.wheels[0].scrubIntensity,
    snap.wheels[1].scrubIntensity,
    snap.wheels[2].scrubIntensity,
    snap.wheels[3].scrubIntensity
  );

  const damageZonesQ = snap.damageZones.map((d) =>
    Math.round(clamp(d, 0, 1) * 255)
  ) as DamageZoneTuple;

  return {
    tick: snap.tick,
    vehicleId: snap.vehicleId,
    position: { ...snap.position },
    rotation: { ...snap.rotation },
    linearVelocityWorld: { ...snap.linearVelocityWorld },
    angularVelocityWorld: { ...snap.angularVelocityWorld },
    speedMs: snap.speedMs,
    engineRpm: snap.engineRpm,
    gear: snap.gear,
    frontWheelAngleRad: snap.frontWheelAngleRad,
    wheelCompressionM: [
      snap.wheels[0].compressionM,
      snap.wheels[1].compressionM,
      snap.wheels[2].compressionM,
      snap.wheels[3].compressionM,
    ],
    wheelRotationRad: [
      snap.wheels[0].rotationAngleRad,
      snap.wheels[1].rotationAngleRad,
      snap.wheels[2].rotationAngleRad,
      snap.wheels[3].rotationAngleRad,
    ],
    brakeLightOn: snap.brakeLightOn,
    skidIntensity: clamp(maxScrub, 0, 1),
    damageZonesQ,
    lapNumber: snap.lapNumber,
    sectorIndex: snap.sectorIndex,
    splineProgress: snap.splineProgress,
    lapValid: snap.lapValid,
  };
}

export function vehicleSnapshotToGhostPose(snap: IVehicleStateSnapshot): IGhostPoseSample {
  const maxScrub = Math.max(
    snap.wheels[0].scrubIntensity,
    snap.wheels[1].scrubIntensity,
    snap.wheels[2].scrubIntensity,
    snap.wheels[3].scrubIntensity
  );

  return {
    tick: snap.tick,
    simTimeMs: snap.currentLapTimeMs,
    position: { ...snap.position },
    rotation: { ...snap.rotation },
    speedMs: snap.speedMs,
    engineRpm: snap.engineRpm,
    gear: snap.gear,
    frontWheelAngleRad: snap.frontWheelAngleRad,
    wheelCompressionM: [
      snap.wheels[0].compressionM,
      snap.wheels[1].compressionM,
      snap.wheels[2].compressionM,
      snap.wheels[3].compressionM,
    ],
    wheelRotationRad: [
      snap.wheels[0].rotationAngleRad,
      snap.wheels[1].rotationAngleRad,
      snap.wheels[2].rotationAngleRad,
      snap.wheels[3].rotationAngleRad,
    ],
    brakeLightOn: snap.brakeLightOn,
    skidIntensity: clamp(maxScrub, 0, 1),
    splineProgress: snap.splineProgress,
  };
}

export function compactNetToGhostPose(
  net: ICompactVehicleNetSnapshot,
  simTimeMs: number
): IGhostPoseSample {
  return {
    tick: net.tick,
    simTimeMs,
    position: { ...net.position },
    rotation: { ...net.rotation },
    speedMs: net.speedMs,
    engineRpm: net.engineRpm,
    gear: net.gear,
    frontWheelAngleRad: net.frontWheelAngleRad,
    wheelCompressionM: [...net.wheelCompressionM] as [number, number, number, number],
    wheelRotationRad: [...net.wheelRotationRad] as [number, number, number, number],
    brakeLightOn: net.brakeLightOn,
    skidIntensity: net.skidIntensity,
    splineProgress: net.splineProgress,
  };
}
