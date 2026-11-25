import { useEffect, useState } from 'react';
import type { ModulusEngine } from '../../core/Engine';
import type {
  AssistPreset,
  DamageZoneTuple,
  ReverseState,
  SurfaceType,
  TransmissionMode,
} from '../../contracts/simulation';
import { readVehicleSnapshot } from '../engineBridge';

export interface WheelHudSnapshot {
  tireTempC: number;
  tireWear: number;
  brakeTempC: number;
  grounded: boolean;
  surface: SurfaceType;
  lockupIntensity: number;
  scrubIntensity: number;
}

export interface TelemetrySnapshot {
  speedMs: number;
  speedKph: number;
  forwardSpeedMs: number;
  engineRpm: number;
  redlineRpm: number;
  revLimiterRpm: number;
  engineLoad: number;
  gear: number;
  isShifting: boolean;
  turboBoostBar: number;
  maxBoostBar: number;
  longitudinalG: number;
  lateralG: number;
  yawRateRadS: number;
  bodySlipAngleRad: number;
  commandedSteer: number;
  frontWheelAngleRad: number;
  reverseState: ReverseState;
  transmissionMode: TransmissionMode;
  assistPreset: AssistPreset;
  downforceTotalKgf: number;
  diffuserStalled: boolean;
  engineTempC: number;
  engineMaxSafeTempC: number;
  engineLimpMode: boolean;
  engineBlown: boolean;
  fuelLiters: number;
  fuelCapacityL: number;
  tireOptimalWindowC: [number, number];
  wheels: [WheelHudSnapshot, WheelHudSnapshot, WheelHudSnapshot, WheelHudSnapshot];
  damageZones: DamageZoneTuple;
  lapArmed: boolean;
  currentLap: number;
  currentSector: number;
  currentLapTimeMs: number;
  bestLapTimeMs: number | null;
  lastLapTimeMs: number | null;
  lapDeltaMs: number;
  sectorTimesMs: [number, number, number];
  lapValid: boolean;
  aiEnabled: boolean;
  throttle: number;
  brake: number;
  steer: number;
  handbrake: number;
}

function captureSnapshot(engine: ModulusEngine): TelemetrySnapshot {
  const snap = readVehicleSnapshot(engine);
  const comp = engine.getCompiledVehicle();
  const rt = engine.getRuntimeState();

  return {
    speedMs: Math.max(0, snap.speedMs),
    speedKph: Math.max(0, snap.speedMs * 3.6),
    forwardSpeedMs: snap.forwardSpeedMs,
    engineRpm: snap.engineRpm,
    redlineRpm: snap.redlineRpm,
    revLimiterRpm: snap.revLimiterRpm,
    engineLoad: snap.engineLoad,
    gear: snap.gear,
    isShifting: snap.isShifting,
    turboBoostBar: snap.turboBoostBar,
    maxBoostBar: snap.maxBoostBar,
    longitudinalG: snap.longitudinalG,
    lateralG: snap.lateralG,
    yawRateRadS: snap.yawRateRadS,
    bodySlipAngleRad: snap.bodySlipAngleRad,
    commandedSteer: snap.commandedSteer,
    frontWheelAngleRad: snap.frontWheelAngleRad,
    reverseState: snap.reverseState,
    transmissionMode: snap.transmissionMode,
    assistPreset: snap.assistPreset,
    downforceTotalKgf: Math.max(0, snap.downforceTotalN / 9.81),
    diffuserStalled: snap.diffuserStalled,
    engineTempC: snap.engineTempC,
    engineMaxSafeTempC: snap.engineMaxSafeTempC,
    engineLimpMode: snap.engineLimpMode,
    engineBlown: snap.engineBlown,
    fuelLiters: Math.max(0, snap.fuelLiters),
    fuelCapacityL: Math.max(5, snap.fuelCapacityL),
    tireOptimalWindowC: comp.tireOptimalTempWindowC,
    wheels: [
      {
        tireTempC: snap.wheels[0].tireTempC,
        tireWear: snap.wheels[0].tireWear,
        brakeTempC: snap.wheels[0].brakeTempC,
        grounded: snap.wheels[0].grounded,
        surface: snap.wheels[0].surface,
        lockupIntensity: snap.wheels[0].lockupIntensity,
        scrubIntensity: snap.wheels[0].scrubIntensity,
      },
      {
        tireTempC: snap.wheels[1].tireTempC,
        tireWear: snap.wheels[1].tireWear,
        brakeTempC: snap.wheels[1].brakeTempC,
        grounded: snap.wheels[1].grounded,
        surface: snap.wheels[1].surface,
        lockupIntensity: snap.wheels[1].lockupIntensity,
        scrubIntensity: snap.wheels[1].scrubIntensity,
      },
      {
        tireTempC: snap.wheels[2].tireTempC,
        tireWear: snap.wheels[2].tireWear,
        brakeTempC: snap.wheels[2].brakeTempC,
        grounded: snap.wheels[2].grounded,
        surface: snap.wheels[2].surface,
        lockupIntensity: snap.wheels[2].lockupIntensity,
        scrubIntensity: snap.wheels[2].scrubIntensity,
      },
      {
        tireTempC: snap.wheels[3].tireTempC,
        tireWear: snap.wheels[3].tireWear,
        brakeTempC: snap.wheels[3].brakeTempC,
        grounded: snap.wheels[3].grounded,
        surface: snap.wheels[3].surface,
        lockupIntensity: snap.wheels[3].lockupIntensity,
        scrubIntensity: snap.wheels[3].scrubIntensity,
      },
    ],
    damageZones: snap.damageZones,
    lapArmed: snap.lapArmed,
    currentLap: snap.lapNumber,
    currentSector: snap.sectorIndex,
    currentLapTimeMs: snap.currentLapTimeMs,
    bestLapTimeMs: snap.bestLapTimeMs,
    lastLapTimeMs: snap.lastLapTimeMs,
    lapDeltaMs: snap.lapDeltaMs,
    sectorTimesMs: [
      snap.sectorTimesMs[0] ?? 0,
      snap.sectorTimesMs[1] ?? 0,
      snap.sectorTimesMs[2] ?? 0,
    ],
    lapValid: snap.lapValid,
    aiEnabled: rt.aiEnabled,
    throttle: snap.throttle,
    brake: snap.brake,
    steer: snap.commandedSteer,
    handbrake: snap.handbrake,
  };
}

/**
 * Throttled ~30Hz rAF telemetry hook for Drive HUD.
 * Runs zero React updates while in Title / Garage / Lab modes.
 */
export function useTelemetry(engine: ModulusEngine, active: boolean): TelemetrySnapshot {
  const [snap, setSnap] = useState<TelemetrySnapshot>(() => captureSnapshot(engine));

  useEffect(() => {
    if (!active) return;
    let rafId = 0;
    let lastEmit = 0;

    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      if (now - lastEmit >= 33) {
        lastEmit = now;
        setSnap(captureSnapshot(engine));
      }
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [engine, active]);

  return snap;
}
