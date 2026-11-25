import type { ModulusEngine } from '../core/Engine';
import type { CameraPreset, ICompiledVehicle, IEngineContext, ITrackSplineSchema } from '../core/types';
import {
  CURRENT_BUILD_SCHEMA_VERSION,
  CURRENT_PHYSICS_VERSION,
  CURRENT_RULESET_VERSION,
  DEFAULT_TRACK_VERSION,
  normalizeBuildSchemaVersion,
  normalizeTrackVersion,
  type AssistPreset,
  type DamageZoneTuple,
  type ILapFinishedEvent,
  type ILapInvalidatedEvent,
  type ISectorSplitEvent,
  type ITrackSchemaV2Extensions,
  type IVehicleStateSnapshot,
  type IWheelStateSnapshot,
  type ReverseState,
  type TransmissionMode,
  type Vec3,
} from '../contracts/simulation';
import type { ExtendedCameraPreset, KeyBindingsConfig } from './settingsStore';

/**
 * Optional Phase-2 physics/courses engine extensions (confirmed in swarm #16).
 * Using this bridge keeps `lane/cockpit` compiling cleanly both before and after
 * `lane/physics` and `lane/courses` merge into `main`, with zero conflicts on `Engine.ts`.
 */
interface IExtendedEngineApi {
  getVehicleSnapshot?: (vehicleId?: string) => IVehicleStateSnapshot;
  setSimulationPaused?: (paused: boolean) => void;
  isSimulationPaused?: () => boolean;
  setDrivingAssists?: (partial: Partial<{ transmissionMode: TransmissionMode; assistPreset: AssistPreset }>) => void;
  getDrivingAssists?: () => { transmissionMode: TransmissionMode; assistPreset: AssistPreset };
  setKeyBindings?: (partial: Partial<KeyBindingsConfig>) => void;
  getKeyBindings?: () => KeyBindingsConfig;
  setSessionMode?: (mode: import('../contracts/simulation').SessionMode) => void;
  getSessionMode?: () => import('../contracts/simulation').SessionMode;
  onFixedStep?: (
    listener: (
      tick: number,
      inputFrame: import('../contracts/simulation').IFixedStepInputFrame,
      snapshot: IVehicleStateSnapshot
    ) => void
  ) => () => void;
}

export interface IGhostHudState {
  active: boolean;
  hasGhost: boolean;
  ghostBestLapMs: number | null;
  liveDeltaMs: number | null;
  ghostFinished: boolean;
  isRecording: boolean;
  pbImproved: boolean;
}

interface IExtendedCompiledVehicle extends Omit<ICompiledVehicle, 'cockpitEyeLocal' | 'steeringWheelLocal' | 'hoodCamLocal'> {
  cockpitEyeLocal?: Vec3;
  steeringWheelLocal?: Vec3;
  hoodCamLocal?: Vec3;
}

const ZERO_DAMAGE: DamageZoneTuple = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export function getCockpitAnchors(compiled: ICompiledVehicle): {
  cockpitEyeLocal: Vec3;
  steeringWheelLocal: Vec3;
  hoodCamLocal: Vec3;
} {
  const ext = compiled as IExtendedCompiledVehicle;
  if (ext.cockpitEyeLocal && ext.steeringWheelLocal && ext.hoodCamLocal) {
    return {
      cockpitEyeLocal: ext.cockpitEyeLocal,
      steeringWheelLocal: ext.steeringWheelLocal,
      hoodCamLocal: ext.hoodCamLocal,
    };
  }

  // Fallback anchors matching locked Apex LHD coordinates (#16) and legacy chassis silhouettes
  if (compiled.bodyStyle === 'prototype') {
    return {
      cockpitEyeLocal: { x: 0, y: 0.92, z: 0.02 },
      steeringWheelLocal: { x: 0, y: 0.74, z: 0.44 },
      hoodCamLocal: { x: 0, y: 0.96, z: 0.78 },
    };
  }
  if (compiled.bodyStyle === 'wedge') {
    return {
      cockpitEyeLocal: { x: 0.30, y: 0.98, z: -0.04 },
      steeringWheelLocal: { x: 0.30, y: 0.78, z: 0.40 },
      hoodCamLocal: { x: 0, y: 1.02, z: 0.72 },
    };
  }
  return {
    cockpitEyeLocal: { x: 0.34, y: 1.06, z: -0.08 },
    steeringWheelLocal: { x: 0.34, y: 0.84, z: 0.38 },
    hoodCamLocal: { x: 0, y: 1.10, z: 0.72 },
  };
}

export function getTrackSectorNames(track: ITrackSplineSchema): string[] {
  const ext = track as ITrackSplineSchema & ITrackSchemaV2Extensions;
  if (Array.isArray(ext.sectors) && ext.sectors.length > 0) {
    return ext.sectors.map((s) => s.name);
  }
  return ['Sector 1', 'Sector 2', 'Sector 3'];
}

export function getTrackVersion(track: ITrackSplineSchema): string {
  const ext = track as ITrackSplineSchema & ITrackSchemaV2Extensions;
  return normalizeTrackVersion(ext.trackVersion);
}

export function getCameraPresetSafe(ctx: Pick<IEngineContext, 'getCameraPreset'>): ExtendedCameraPreset {
  const raw = ctx.getCameraPreset() as string;
  if (raw === 'cockpit' || raw === 'hood' || raw === 'chase' || raw === 'orbit') {
    return raw;
  }
  return 'cockpit';
}

export function setCameraPresetSafe(
  ctx: Pick<IEngineContext, 'setCameraPreset'>,
  preset: ExtendedCameraPreset
): void {
  ctx.setCameraPreset(preset as CameraPreset);
}

export function setSimulationPausedSafe(engine: ModulusEngine, paused: boolean): void {
  const ext = engine as unknown as IExtendedEngineApi;
  if (typeof ext.setSimulationPaused === 'function') {
    ext.setSimulationPaused(paused);
  }
}

export function isSimulationPausedSafe(engine: ModulusEngine): boolean {
  const ext = engine as unknown as IExtendedEngineApi;
  if (typeof ext.isSimulationPaused === 'function') {
    return ext.isSimulationPaused();
  }
  return false;
}

export function syncAssistsToEngine(
  engine: ModulusEngine,
  assists: { transmissionMode: TransmissionMode; assistPreset: AssistPreset }
): void {
  const ext = engine as unknown as IExtendedEngineApi;
  ext.setDrivingAssists?.(assists);
}

export function syncKeyBindingsToEngine(
  engine: ModulusEngine,
  keyBindings: KeyBindingsConfig
): void {
  const ext = engine as unknown as IExtendedEngineApi;
  ext.setKeyBindings?.(keyBindings);
}

export function setSessionModeSafe(
  engine: ModulusEngine,
  mode: import('../contracts/simulation').SessionMode
): void {
  const ext = engine as unknown as IExtendedEngineApi;
  ext.setSessionMode?.(mode);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('modulus:session-mode', { detail: { mode } }));
  }
}

export function subscribeFixedStepSafe(
  engine: ModulusEngine,
  listener: (
    tick: number,
    inputFrame: import('../contracts/simulation').IFixedStepInputFrame,
    snapshot: IVehicleStateSnapshot
  ) => void
): (() => void) | null {
  const ext = engine as unknown as IExtendedEngineApi;
  if (typeof ext.onFixedStep === 'function') {
    return ext.onFixedStep(listener);
  }
  return null;
}

export function subscribeGhostHudState(
  engine: ModulusEngine,
  handler: (state: IGhostHudState) => void
): () => void {
  const bus = engine.events as unknown as {
    on: (ev: string, fn: (payload: unknown) => void) => () => void;
  };
  const unsubBus = bus.on('ghost:state', (payload) => {
    if (payload && typeof payload === 'object') {
      handler(payload as IGhostHudState);
    }
  });
  const onWin = (e: Event) => {
    const detail = (e as CustomEvent<IGhostHudState>).detail;
    if (detail && typeof detail === 'object') {
      handler(detail);
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('modulus:ghost-state', onWin);
  }
  return () => {
    unsubBus();
    if (typeof window !== 'undefined') {
      window.removeEventListener('modulus:ghost-state', onWin);
    }
  };
}

/**
 * Reads the official contract `IVehicleStateSnapshot` from `engine.getVehicleSnapshot()` when
 * available, or synthesizes a full snapshot from legacy `getRuntimeState()` + `getInputState()`.
 */
export function readVehicleSnapshot(ctx: IEngineContext): IVehicleStateSnapshot {
  const ext = ctx as unknown as IExtendedEngineApi;
  if (typeof ext.getVehicleSnapshot === 'function') {
    return ext.getVehicleSnapshot();
  }

  const st = ctx.getRuntimeState();
  const inp = ctx.getInputState();
  const comp = ctx.getCompiledVehicle();

  const forwardSpeedMs = st.localVelocity.z;
  const speedMs = Math.max(0, st.speedMs);
  const bodySlipAngleRad =
    speedMs > 1.5 ? Math.atan2(st.localVelocity.x, Math.max(1.0, Math.abs(forwardSpeedMs))) : 0;

  let reverseState: ReverseState = 'forward';
  if (st.gear === -1) {
    reverseState = 'reverse';
  } else if (speedMs < 0.6 && inp.brake > 0.15) {
    reverseState = 'stopped_brake_held';
  } else if (speedMs < 0.6) {
    reverseState = 'reverse_ready';
  }

  const wheels = st.wheels.map((w): IWheelStateSnapshot => {
    const lockupIntensity =
      w.grounded && inp.brake > 0.15 && speedMs > 3.0
        ? Math.max(0, Math.min(1, (-w.slipRatio - 0.14) / 0.35))
        : 0;
    const combinedSlip = Math.hypot(w.slipRatio, Math.abs(w.slipAngleRad) * 1.6);
    const scrubIntensity =
      w.grounded && speedMs > 2.0 ? Math.max(0, Math.min(1, (combinedSlip - 0.12) / 0.38)) : 0;

    return {
      index: w.index,
      grounded: w.grounded,
      surface: w.surface,
      suspensionLengthM: w.suspensionLengthM,
      compressionM: w.compressionM,
      compressionVelocityMs: w.compressionVelocityMs,
      steerAngleRad: w.steerAngleRad,
      camberAngleRad: w.camberAngleRad,
      rotationAngleRad: w.rotationAngleRad,
      angularVelocityRadS: w.angularVelocityRadS,
      normalLoadN: w.normalLoadN,
      slipRatio: w.slipRatio,
      slipAngleRad: w.slipAngleRad,
      lockupIntensity,
      scrubIntensity,
      tireTempC: w.tireTempC,
      tireWear: w.tireWear,
      brakeTempC: w.brakeTempC,
    };
  }) as [IWheelStateSnapshot, IWheelStateSnapshot, IWheelStateSnapshot, IWheelStateSnapshot];

  const frontWheelAngleRad = (st.wheels[0].steerAngleRad + st.wheels[1].steerAngleRad) * 0.5;
  const engineLoad = Math.max(0, Math.min(1, inp.throttle * 0.8 + (st.engineTorqueNm > 0 ? 0.2 : 0)));

  return {
    tick: 0,
    simTimeMs: st.currentLapTimeMs,
    vehicleId: 'v0',
    slotIndex: 0,
    controllerKind: st.aiEnabled ? 'ai' : 'local',
    position: st.position,
    rotation: st.rotation,
    linearVelocityWorld: st.linearVelocityWorld,
    angularVelocityWorld: st.angularVelocityWorld,
    speedMs,
    forwardSpeedMs,
    longitudinalG: st.longitudinalG,
    lateralG: st.lateralG,
    yawRateRadS: st.yawRateRadS,
    bodySlipAngleRad,
    rawSteerInput: inp.steer,
    commandedSteer: inp.steer,
    frontWheelAngleRad,
    throttle: inp.throttle,
    brake: inp.brake,
    handbrake: inp.handbrake,
    brakeLightOn: inp.brake > 0.05,
    reverseState,
    transmissionMode: 'auto',
    assistPreset: 'beginner',
    gear: st.gear,
    isShifting: st.isShifting,
    shiftDirection: 0,
    engineRpm: st.engineRpm,
    idleRpm: comp.idleRpm,
    redlineRpm: comp.redlineRpm,
    revLimiterRpm: comp.revLimiterRpm,
    engineLoad,
    turboBoostBar: st.turboBoostBar,
    maxBoostBar: comp.maxBoostBar,
    fuelLiters: Math.max(0, st.fuelLiters),
    fuelCapacityL: Math.max(5, comp.build.fuelAndCooling.fuelLoadL),
    engineTempC: st.engineTempC,
    engineMaxSafeTempC: comp.engineMaxSafeTempC,
    engineLimpMode: st.engineLimpMode,
    engineBlown: st.engineBlown,
    downforceTotalN: st.downforceTotalN,
    diffuserStalled: st.diffuserStalled,
    wheels,
    damageZones: ZERO_DAMAGE,
    lastImpact: null,
    lapNumber: st.currentLap,
    sectorIndex: st.currentSector,
    sectorCount: 3,
    splineProgress: st.splineProgress,
    lapArmed: st.currentLapTimeMs > 0 || speedMs > 0.5,
    currentLapTimeMs: st.currentLapTimeMs,
    lastLapTimeMs: st.lastLapTimeMs,
    bestLapTimeMs: st.bestLapTimeMs,
    lapDeltaMs: st.lapDeltaMs,
    sectorTimesMs: [st.sectorTimesMs[0], st.sectorTimesMs[1], st.sectorTimesMs[2]],
    lapValid: st.lapValid,
    checkpointMask: 0,
  };
}

/**
 * Normalizes either the legacy `ILapFinishedPayload` or the v2 contract `ILapFinishedEvent`
 * into a guaranteed `ILapFinishedEvent` for Debrief & PB history.
 */
export function normalizeLapFinishedEvent(
  raw: Record<string, unknown>,
  track: ITrackSplineSchema
): ILapFinishedEvent {
  const sectorTimes = Array.isArray(raw.sectorTimesMs)
    ? (raw.sectorTimesMs as number[]).map((n) => (Number.isFinite(n) ? n : 0))
    : [0, 0, 0];
  const defaultNames = getTrackSectorNames(track);
  const sectorNames =
    Array.isArray(raw.sectorNames) && (raw.sectorNames as string[]).length > 0
      ? (raw.sectorNames as string[])
      : defaultNames.slice(0, sectorTimes.length);

  const peakSpeedKph = Number(raw.peakSpeedKph ?? 0);
  const peakSpeedMs =
    typeof raw.peakSpeedMs === 'number' && Number.isFinite(raw.peakSpeedMs)
      ? raw.peakSpeedMs
      : peakSpeedKph / 3.6;

  const lapValid = Boolean(raw.lapValid);
  const invalidReasons: ILapFinishedEvent['invalidReasons'] = Array.isArray(raw.invalidReasons)
    ? (raw.invalidReasons as ILapFinishedEvent['invalidReasons'])
    : lapValid
    ? []
    : ['off_track'];

  return {
    vehicleId: String(raw.vehicleId ?? 'v0'),
    tick: Number(raw.tick ?? 0),
    sessionMode: (raw.sessionMode as ILapFinishedEvent['sessionMode']) ?? 'practice',
    trackId: String(raw.trackId ?? track.id),
    trackVersion: normalizeTrackVersion(
      (raw.trackVersion as string | undefined) ?? getTrackVersion(track) ?? DEFAULT_TRACK_VERSION
    ),
    geometryHash: String(raw.geometryHash ?? 'legacy'),
    physicsVersion: String(raw.physicsVersion ?? CURRENT_PHYSICS_VERSION),
    rulesetVersion: String(raw.rulesetVersion ?? CURRENT_RULESET_VERSION),
    balanceVersionId: String(raw.balanceVersionId ?? 'v1.0.0'),
    buildId: String(raw.buildId ?? 'build_starter_apex'),
    buildSchemaVersion: normalizeBuildSchemaVersion(
      raw.buildSchemaVersion as number | undefined
    ) || CURRENT_BUILD_SCHEMA_VERSION,
    buildContentHash: raw.buildContentHash as string | undefined,
    chassisId: String(raw.chassisId ?? 'chassis_apex_fr'),
    pwrRatio: Number(raw.pwrRatio ?? 0),
    lapNumber: Number(raw.lapNumber ?? 1),
    lapTimeMs: Number(raw.lapTimeMs ?? 0),
    sectorTimesMs: sectorTimes,
    sectorNames,
    deltaToBestLapMs:
      typeof raw.deltaToBestLapMs === 'number' ? raw.deltaToBestLapMs : null,
    isPersonalBest: Boolean(raw.isPersonalBest),
    lapValid,
    invalidReasons,
    checkpointMask: Number(raw.checkpointMask ?? 0),
    orderedCheckpointsHit: Array.isArray(raw.orderedCheckpointsHit)
      ? (raw.orderedCheckpointsHit as number[])
      : [],
    peakSpeedMs,
    peakSpeedKph,
    isAiAssisted: Boolean(raw.isAiAssisted),
    verificationLevel:
      (raw.verificationLevel as ILapFinishedEvent['verificationLevel']) ?? 'local',
  };
}

export function subscribeLapInvalidated(
  engine: ModulusEngine,
  handler: (ev: ILapInvalidatedEvent) => void
): () => void {
  const bus = engine.events as unknown as {
    on: (ev: string, fn: (payload: unknown) => void) => () => void;
  };
  return bus.on('lap:invalidated', (payload) => {
    if (payload && typeof payload === 'object') {
      handler(payload as ILapInvalidatedEvent);
    }
  });
}

export function subscribeSectorSplit(
  engine: ModulusEngine,
  handler: (ev: Partial<ISectorSplitEvent> & { sectorIndex: number; splitTimeMs: number }) => void
): () => void {
  return engine.events.on('sector:split', (payload) => {
    handler(payload as Partial<ISectorSplitEvent> & { sectorIndex: number; splitTimeMs: number });
  });
}
