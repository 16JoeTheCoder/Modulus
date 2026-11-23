import { useEffect, useState } from 'react';
import type { ModulusEngine } from '../../core/Engine';

export interface WheelHudSnapshot {
  tireTempC: number;
  tireWear: number;
  brakeTempC: number;
  grounded: boolean;
}

export interface TelemetrySnapshot {
  speedKph: number;
  engineRpm: number;
  redlineRpm: number;
  revLimiterRpm: number;
  gear: number;
  isShifting: boolean;
  turboBoostBar: number;
  maxBoostBar: number;
  longitudinalG: number;
  lateralG: number;
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
  const st = engine.getRuntimeState();
  const inp = engine.getInputState();
  const comp = engine.getCompiledVehicle();

  return {
    speedKph: Math.max(0, st.speedKph),
    engineRpm: st.engineRpm,
    redlineRpm: comp.redlineRpm,
    revLimiterRpm: comp.revLimiterRpm,
    gear: st.gear,
    isShifting: st.isShifting,
    turboBoostBar: st.turboBoostBar,
    maxBoostBar: comp.maxBoostBar,
    longitudinalG: st.longitudinalG,
    lateralG: st.lateralG,
    downforceTotalKgf: Math.max(0, st.downforceTotalN / 9.81),
    diffuserStalled: st.diffuserStalled,
    engineTempC: st.engineTempC,
    engineMaxSafeTempC: comp.engineMaxSafeTempC,
    engineLimpMode: st.engineLimpMode,
    engineBlown: st.engineBlown,
    fuelLiters: Math.max(0, st.fuelLiters),
    fuelCapacityL: Math.max(5, comp.build.fuelAndCooling.fuelLoadL),
    tireOptimalWindowC: comp.tireOptimalTempWindowC,
    wheels: [
      {
        tireTempC: st.wheels[0].tireTempC,
        tireWear: st.wheels[0].tireWear,
        brakeTempC: st.wheels[0].brakeTempC,
        grounded: st.wheels[0].grounded,
      },
      {
        tireTempC: st.wheels[1].tireTempC,
        tireWear: st.wheels[1].tireWear,
        brakeTempC: st.wheels[1].brakeTempC,
        grounded: st.wheels[1].grounded,
      },
      {
        tireTempC: st.wheels[2].tireTempC,
        tireWear: st.wheels[2].tireWear,
        brakeTempC: st.wheels[2].brakeTempC,
        grounded: st.wheels[2].grounded,
      },
      {
        tireTempC: st.wheels[3].tireTempC,
        tireWear: st.wheels[3].tireWear,
        brakeTempC: st.wheels[3].brakeTempC,
        grounded: st.wheels[3].grounded,
      },
    ],
    currentLap: st.currentLap,
    currentSector: st.currentSector,
    currentLapTimeMs: st.currentLapTimeMs,
    bestLapTimeMs: st.bestLapTimeMs,
    lastLapTimeMs: st.lastLapTimeMs,
    lapDeltaMs: st.lapDeltaMs,
    sectorTimesMs: [st.sectorTimesMs[0], st.sectorTimesMs[1], st.sectorTimesMs[2]],
    lapValid: st.lapValid,
    aiEnabled: st.aiEnabled,
    throttle: inp.throttle,
    brake: inp.brake,
    steer: inp.steer,
    handbrake: inp.handbrake,
  };
}

/**
 * Throttled ~30Hz rAF telemetry hook for Drive HUD.
 * Runs zero React updates while in Engineering Lab mode.
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
