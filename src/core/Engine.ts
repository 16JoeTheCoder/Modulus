import * as THREE from 'three';
import { createStarterBuild, TRACKS_BY_ID, TRACKS_CATALOG } from '../content';
import {
  CURRENT_PHYSICS_VERSION,
  CURRENT_RULESET_VERSION,
  FIXED_SIM_DT,
  FIXED_SIM_HZ,
  INPUT_FLAG,
  normalizeBuildSchemaVersion,
  normalizeTrackVersion,
  type DamageZoneTuple,
  type IFixedStepInputFrame,
  type IVehicleCollisionHandle,
  type IVehicleRenderHandle,
  type IVehicleStateSnapshot,
  type IWheelStateSnapshot,
  type LapInvalidationReason,
  type SessionMode,
} from '../contracts/simulation';
import { EventBus } from './EventBus';
import { compileVehicleBuild } from './math/vehicleCompiler';
import { PluginRegistry } from './PluginRegistry';
import { LapSectorTimer } from './timing';
import {
  DEFAULT_BALANCE_CONFIG,
  DEFAULT_KEY_BINDINGS,
  type CameraPreset,
  type ICompiledVehicle,
  type IDrivingAssistConfig,
  type IEngineContext,
  type IGlobalBalanceConfig,
  type IInputState,
  type IKeyBindings,
  type ILabOverlayOptions,
  type IModulusPlugin,
  type ITrackGeometryData,
  type ITrackSplineSchema,
  type IVehicleBuildConfig,
  type IVehicleRuntimeState,
  type IWheelRuntimeState,
  type VisualMode,
  type WheelIndex,
} from './types';

export const FIXED_PHYSICS_HZ = FIXED_SIM_HZ;
export const FIXED_DT = FIXED_SIM_DT;
/** Allows catching up down to 10 FPS without drifting simulation time behind real wall-clock time. */
const MAX_SUBSTEPS_PER_FRAME = 12;

function createZeroDamageZones(): DamageZoneTuple {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function createWheelRuntimeState(index: WheelIndex, restLengthM: number, ambientTempC: number): IWheelRuntimeState {
  return {
    index,
    grounded: false,
    surface: 'tarmac',
    contactPointWorld: { x: 0, y: 0, z: 0 },
    contactNormalWorld: { x: 0, y: 1, z: 0 },
    worldPosition: { x: 0, y: 0.32, z: 0 },
    prevWorldPosition: { x: 0, y: 0.32, z: 0 },
    suspensionLengthM: restLengthM,
    compressionM: 0,
    compressionVelocityMs: 0,
    bottomedOut: false,
    steerAngleRad: 0,
    camberAngleRad: 0,
    angularVelocityRadS: 0,
    rotationAngleRad: 0,
    normalLoadN: 0,
    slipRatio: 0,
    slipAngleRad: 0,
    longitudinalForceN: 0,
    lateralForceN: 0,
    driveTorqueNm: 0,
    brakeTorqueNm: 0,
    tireTempC: ambientTempC + 18,
    tireWear: 0,
    thermalGripMultiplier: 1.0,
    brakeTempC: ambientTempC + 20,
    brakeFadeMultiplier: 1.0,
    lockupIntensity: 0,
    scrubIntensity: 0,
  };
}

function createInitialRuntimeState(
  compiled: ICompiledVehicle,
  track: ITrackSplineSchema,
  assists: IDrivingAssistConfig
): IVehicleRuntimeState {
  return {
    simTick: 0,
    simTimeMs: 0,
    vehicleId: 'v0',

    position: { x: 0, y: 0.65, z: 0 },
    prevPosition: { x: 0, y: 0.65, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    prevRotation: { x: 0, y: 0, z: 0, w: 1 },
    linearVelocityWorld: { x: 0, y: 0, z: 0 },
    angularVelocityWorld: { x: 0, y: 0, z: 0 },
    localVelocity: { x: 0, y: 0, z: 0 },
    forwardWorld: { x: 0, y: 0, z: 1 },
    upWorld: { x: 0, y: 1, z: 0 },
    rightWorld: { x: -1, y: 0, z: 0 },

    speedMs: 0,
    forwardSpeedMs: 0,
    speedKph: 0,
    longitudinalG: 0,
    lateralG: 0,
    yawRateRadS: 0,
    bodySlipAngleRad: 0,

    rawSteerInput: 0,
    commandedSteer: 0,
    frontWheelAngleRad: 0,
    reverseState: 'forward',
    transmissionMode: assists.transmissionMode,
    assistPreset: assists.assistPreset,

    engineRpm: compiled.idleRpm,
    engineTorqueNm: 0,
    enginePowerHp: 0,
    engineLoad: 0,
    turboBoostBar: 0,
    gear: 1,
    shiftTimerS: 0,
    isShifting: false,
    shiftDirection: 0,
    clutchEngagement: 1,
    fuelLiters: compiled.build.fuelAndCooling.fuelLoadL,

    downforceFrontN: 0,
    downforceRearN: 0,
    downforceTotalN: 0,
    dragForceN: 0,
    diffuserStalled: false,

    ambientTempC: track.ambientTempC,
    trackTempC: track.trackTempC,
    engineTempC: 82,
    engineLimpMode: false,
    engineBlown: false,

    wheels: [
      createWheelRuntimeState(0, compiled.suspensionRestLengthM[0], track.ambientTempC),
      createWheelRuntimeState(1, compiled.suspensionRestLengthM[1], track.ambientTempC),
      createWheelRuntimeState(2, compiled.suspensionRestLengthM[2], track.ambientTempC),
      createWheelRuntimeState(3, compiled.suspensionRestLengthM[3], track.ambientTempC),
    ],

    damageZones: createZeroDamageZones(),
    lastImpact: null,

    forceAccumulatorWorld: { x: 0, y: 0, z: 0 },
    torqueAccumulatorWorld: { x: 0, y: 0, z: 0 },
    pointForces: [],

    aiEnabled: false,
    aiTargetPointWorld: { x: 0, y: 0, z: 20 },
    splineProgress: 0,
    lapArmed: false,
    checkpointMask: 0,
    currentLap: 1,
    currentSector: 0,
    currentLapTimeMs: 0,
    lastLapTimeMs: null,
    bestLapTimeMs: null,
    lapDeltaMs: 0,
    sectorTimesMs: [0, 0, 0],
    peakLapSpeedKph: 0,
    offTrackCount: 0,
    lapValid: true,
  };
}

/**
 * MODULUS Core 120Hz Deterministic Simulation & Single-Context Three.js Host
 * Decoupled 100% from React reconciliation.
 */
export class ModulusEngine implements IEngineContext {
  public readonly events = new EventBus();
  public readonly registry = new PluginRegistry();
  public readonly scene = new THREE.Scene();
  public readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 2400);

  public renderer: THREE.WebGLRenderer | null = null;
  public canvas: HTMLCanvasElement | null = null;

  private visualMode: VisualMode = 'lab';
  private sessionMode: SessionMode = 'practice';
  private cameraPreset: CameraPreset = 'cockpit';
  private simulationPaused = false;
  private fixedStepListeners = new Set<
    (tick: number, inputFrame: IFixedStepInputFrame, snapshot: IVehicleStateSnapshot) => void
  >();
  private assists: IDrivingAssistConfig = {
    transmissionMode: 'auto',
    assistPreset: 'beginner',
  };
  private keyBindings: IKeyBindings = {
    throttle: [...DEFAULT_KEY_BINDINGS.throttle],
    brake: [...DEFAULT_KEY_BINDINGS.brake],
    steerLeft: [...DEFAULT_KEY_BINDINGS.steerLeft],
    steerRight: [...DEFAULT_KEY_BINDINGS.steerRight],
    handbrake: [...DEFAULT_KEY_BINDINGS.handbrake],
    gearUp: [...DEFAULT_KEY_BINDINGS.gearUp],
    gearDown: [...DEFAULT_KEY_BINDINGS.gearDown],
    reset: [...DEFAULT_KEY_BINDINGS.reset],
    camera: [...DEFAULT_KEY_BINDINGS.camera],
  };

  private labOverlays: ILabOverlayOptions = {
    wireframe: false,
    cgSphere: true,
    aeroVectors: true,
    highlightedModule: null,
  };

  private balanceConfig: IGlobalBalanceConfig = DEFAULT_BALANCE_CONFIG;
  private activeTrack: ITrackSplineSchema = TRACKS_CATALOG[0];
  private trackGeometry: ITrackGeometryData | null = null;
  private compiledVehicle: ICompiledVehicle;
  private runtimeState: IVehicleRuntimeState;

  private keyboardInput: IInputState = this.createEmptyInput('keyboard');
  private touchInput: IInputState = this.createEmptyInput('touch');
  private activeInput: IInputState = this.createEmptyInput('keyboard');
  private fixedInputFrame: IFixedStepInputFrame = {
    tick: 0,
    vehicleId: 'v0',
    controllerKind: 'local',
    inputSource: 'keyboard',
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: 0,
    clutch: 0,
    flags: INPUT_FLAG.NONE,
  };

  private rafId: number | null = null;
  private running = false;
  private accumulatorS = 0;
  private lastFrameTimeMs = 0;
  private simTick = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private boundOnResize: () => void;
  private passedMidTrack = false;
  private sectorStartTimeMs = 0;
  private bestSectorTimesMs: Array<number | null> = [null, null, null];
  private invalidReasons: LapInvalidationReason[] = [];
  private lapTimer: LapSectorTimer | null = null;

  constructor(initialPlugins: IModulusPlugin[] = []) {
    const starterBuild = createStarterBuild();
    this.compiledVehicle = compileVehicleBuild(starterBuild, this.balanceConfig);
    this.runtimeState = createInitialRuntimeState(this.compiledVehicle, this.activeTrack, this.assists);
    this.registry.registerAll(initialPlugins);
    this.boundOnResize = () => this.scheduleResize();
  }

  private createEmptyInput(source: 'keyboard' | 'touch' | 'ai'): IInputState {
    return {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: 0,
      clutch: 0,
      gearUp: false,
      gearDown: false,
      resetVehicle: false,
      brakeFreshPress: false,
      reverseRequest: false,
      inputSource: source,
    };
  }

  /**
   * Mounts the SINGLE persistent WebGL context onto the host canvas.
   * Never destroys/recreates WebGL on resize or orientation change (iOS Safari safe).
   */
  public async mountCanvas(canvas: HTMLCanvasElement): Promise<void> {
    if (typeof window !== 'undefined') {
      (window as unknown as { __modulusEngine?: ModulusEngine }).__modulusEngine = this;
    }

    if (this.canvas === canvas && this.renderer) {
      this.applyCanvasDimensions();
      return;
    }

    this.canvas = canvas;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false,
        stencil: false,
      });
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    this.applyCanvasDimensions();
    window.addEventListener('resize', this.boundOnResize, { passive: true });
    window.addEventListener('orientationchange', this.boundOnResize, { passive: true });

    await this.registry.initAll(this);
    this.registry.notifyBalanceConfig(this.balanceConfig);
    this.registry.notifyBuildCompiled(this.compiledVehicle);

    if (!this.running) {
      this.start();
    }
  }

  private scheduleResize(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.applyCanvasDimensions();
    }, 60);
  }

  private applyCanvasDimensions(): void {
    if (!this.renderer || !this.canvas) return;
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTimeMs = performance.now();
    this.accumulatorS = 0;

    const tick = (nowMs: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);

      const rawDtS = Math.max(0, Math.min(0.1, (nowMs - this.lastFrameTimeMs) / 1000));
      this.lastFrameTimeMs = nowMs;

      if (this.visualMode === 'track' && !this.simulationPaused) {
        // Advance fewer fixed ticks per wall second while preserving simulated mph and lap timing.
        this.accumulatorS += rawDtS * this.balanceConfig.physics_bias.driving_pace;
        let substeps = 0;
        while (this.accumulatorS >= FIXED_DT && substeps < MAX_SUBSTEPS_PER_FRAME) {
          this.stepSingleFixedTick(FIXED_DT);
          this.accumulatorS -= FIXED_DT;
          substeps++;
        }
        if (substeps === MAX_SUBSTEPS_PER_FRAME && this.accumulatorS > FIXED_DT * 2) {
          this.accumulatorS = FIXED_DT;
        }
      } else {
        // In Engineering Lab or Paused mode, freeze simulation time cleanly
        this.accumulatorS = 0;
      }

      const alpha =
        this.visualMode === 'track' && !this.simulationPaused
          ? Math.max(0, Math.min(1, this.accumulatorS / FIXED_DT))
          : 1.0;
      this.registry.renderAll(alpha, this.runtimeState);

      if (this.renderer) {
        this.renderer.render(this.scene, this.camera);
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }

  /**
   * Executes one deterministic 120 Hz fixed simulation tick.
   * Zero 1-tick lag: input plugins (priority 30-35) shape raw hardware input directly into
   * `activeInput` & `fixedInputFrame` BEFORE powertrain/solver/rapier (priority 40-75) consume it.
   */
  private stepSingleFixedTick(dt: number): void {
    this.simTick = (this.simTick + 1) >>> 0;
    this.runtimeState.simTick = this.simTick;
    this.runtimeState.simTimeMs = this.simTick * dt * 1000;
    this.runtimeState.transmissionMode = this.assists.transmissionMode;
    this.runtimeState.assistPreset = this.assists.assistPreset;

    this.mergeHardwareInputs();
    if (this.activeInput.resetVehicle) {
      this.activeInput.resetVehicle = false;
      this.keyboardInput.resetVehicle = false;
      this.touchInput.resetVehicle = false;
      this.resetVehicleToStart();
    }

    this.registry.stepPhysics(dt, this.runtimeState, this.activeInput);
    this.captureFixedInputFrame();
    this.updateLapAndSectorTiming(dt);

    if (this.fixedStepListeners.size > 0) {
      const snap = this.getVehicleSnapshot();
      for (const listener of Array.from(this.fixedStepListeners)) {
        try {
          listener(this.simTick, this.fixedInputFrame, snap);
        } catch (err) {
          console.error('[ModulusEngine] Error in onFixedStep listener:', err);
        }
      }
    }

    // Clear edge-triggered input flags after one physics step
    this.keyboardInput.gearUp = false;
    this.keyboardInput.gearDown = false;
    this.keyboardInput.brakeFreshPress = false;
    this.keyboardInput.reverseRequest = false;
    this.touchInput.gearUp = false;
    this.touchInput.gearDown = false;
    this.touchInput.brakeFreshPress = false;
    this.touchInput.reverseRequest = false;
    this.activeInput.gearUp = false;
    this.activeInput.gearDown = false;
    this.activeInput.brakeFreshPress = false;
    this.activeInput.reverseRequest = false;
  }

  private captureFixedInputFrame(): void {
    const inp = this.activeInput;
    let flags = INPUT_FLAG.NONE;
    if (inp.gearUp) flags |= INPUT_FLAG.GEAR_UP;
    if (inp.gearDown) flags |= INPUT_FLAG.GEAR_DOWN;
    if (inp.resetVehicle) flags |= INPUT_FLAG.RESET_VEHICLE;
    if (inp.brakeFreshPress) flags |= INPUT_FLAG.BRAKE_FRESH_PRESS;
    if (inp.reverseRequest) flags |= INPUT_FLAG.REVERSE_REQUEST;

    this.fixedInputFrame = {
      tick: this.simTick,
      vehicleId: this.runtimeState.vehicleId,
      controllerKind: this.runtimeState.aiEnabled ? 'ai' : 'local',
      inputSource: inp.inputSource,
      throttle: inp.throttle,
      brake: inp.brake,
      steer: this.runtimeState.rawSteerInput,
      handbrake: inp.handbrake,
      clutch: inp.clutch,
      flags,
    };
  }

  public stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.boundOnResize);
    window.removeEventListener('orientationchange', this.boundOnResize);
    this.registry.disposeAll();
    this.renderer?.dispose();
    this.renderer = null;
  }

  private mergeHardwareInputs(): void {
    const touchActive =
      this.touchInput.throttle > 0.01 ||
      this.touchInput.brake > 0.01 ||
      Math.abs(this.touchInput.steer) > 0.01 ||
      this.touchInput.handbrake > 0.01 ||
      this.touchInput.gearUp ||
      this.touchInput.gearDown;

    const src = touchActive ? this.touchInput : this.keyboardInput;
    this.activeInput.throttle = src.throttle;
    this.activeInput.brake = src.brake;
    this.activeInput.steer = src.steer;
    this.activeInput.handbrake = src.handbrake;
    this.activeInput.clutch = src.clutch;
    this.activeInput.gearUp = this.keyboardInput.gearUp || this.touchInput.gearUp;
    this.activeInput.gearDown = this.keyboardInput.gearDown || this.touchInput.gearDown;
    this.activeInput.resetVehicle = this.keyboardInput.resetVehicle || this.touchInput.resetVehicle;
    this.activeInput.brakeFreshPress = Boolean(
      this.keyboardInput.brakeFreshPress || this.touchInput.brakeFreshPress
    );
    this.activeInput.reverseRequest = Boolean(
      this.keyboardInput.reverseRequest || this.touchInput.reverseRequest
    );
    this.activeInput.inputSource = this.runtimeState.aiEnabled
      ? 'ai'
      : touchActive
      ? 'touch'
      : 'keyboard';
  }

  private updateLapAndSectorTiming(dt: number): void {
    const geom = this.trackGeometry;
    if (!geom) return;

    const st = this.runtimeState;
    if (this.lapTimer) {
      // While unarmed on the standing grid, use horizontal speed so initial vertical suspension settle doesn't start the clock.
      const planarSpeedMs = Math.hypot(st.linearVelocityWorld.x, st.linearVelocityWorld.z);
      const res = this.lapTimer.stepVehicle({
        tick: this.simTick,
        dt,
        vehicleId: st.vehicleId,
        position: st.position,
        speedMs: st.lapArmed ? st.speedMs : planarSpeedMs,
        forwardSpeedMs: st.forwardSpeedMs,
        throttle: this.activeInput.throttle,
        buildId: this.compiledVehicle.build.id,
        buildSchemaVersion: normalizeBuildSchemaVersion(this.compiledVehicle.build.buildSchemaVersion),
        chassisId: this.compiledVehicle.build.chassisId,
        pwrRatio: this.compiledVehicle.pwrRatioHpPerKg,
        isAiAssisted: st.aiEnabled,
      });

      const ts = res.state;
      st.splineProgress = ts.splineProgress;
      st.lapArmed = ts.lapArmed;
      st.currentLap = ts.lapNumber;
      st.currentSector = ts.sectorIndex;
      st.currentLapTimeMs = ts.currentLapTimeMs;
      st.lastLapTimeMs = ts.lastLapTimeMs;
      st.bestLapTimeMs = ts.bestLapTimeMs;
      st.lapDeltaMs = ts.lapDeltaMs;
      st.sectorTimesMs = [
        ts.sectorTimesMs[0] ?? 0,
        ts.sectorTimesMs[1] ?? 0,
        ts.sectorTimesMs[2] ?? 0,
      ];
      st.peakLapSpeedKph = ts.peakSpeedKph;
      st.offTrackCount = ts.offTrackTicks;
      st.lapValid = ts.lapValid;
      st.checkpointMask = ts.checkpointMask;

      for (const inv of res.lapInvalidated) {
        this.events.emit('lap:invalidated', inv);
      }
      for (const split of res.sectorSplits) {
        this.events.emit('sector:split', split);
      }
      if (res.lapFinished) {
        const lf = res.lapFinished;
        this.events.emit('lap:finished', {
          ...lf,
          sectorTimesMs: [
            lf.sectorTimesMs[0] ?? 0,
            lf.sectorTimesMs[1] ?? 0,
            lf.sectorTimesMs[2] ?? 0,
          ] as [number, number, number],
        });
      }
      return;
    }

    const prevProgress = st.splineProgress;
    const closest = geom.spline.findClosestSample(st.position, prevProgress);
    const nextProgress = closest.sample.t;
    st.splineProgress = nextProgress;

    if (st.speedKph > st.peakLapSpeedKph) {
      st.peakLapSpeedKph = st.speedKph;
    }

    // Standing-start arming: clock stays 0:00.000 until first launch movement or throttle
    if (!st.lapArmed) {
      if (st.forwardSpeedMs > 0.35 || this.activeInput.throttle > 0.1 || st.aiEnabled) {
        st.lapArmed = true;
      } else {
        return;
      }
    }

    const halfWidth = closest.sample.widthM * 0.5;
    if (Math.abs(closest.lateralOffsetM) > halfWidth + 2.5) {
      st.offTrackCount++;
      if (st.offTrackCount > 120 && st.lapValid) {
        st.lapValid = false;
        if (!this.invalidReasons.includes('off_track')) {
          this.invalidReasons.push('off_track');
        }
        this.events.emit('lap:invalidated', {
          vehicleId: st.vehicleId,
          tick: this.simTick,
          lapNumber: st.currentLap,
          sectorIndex: st.currentSector,
          reason: 'off_track',
        });
      }
    } else {
      st.offTrackCount = 0;
    }

    st.currentLapTimeMs += dt * 1000;

    if (nextProgress > 0.42 && nextProgress < 0.62) {
      this.passedMidTrack = true;
      st.checkpointMask |= 1 << 2;
    }

    const [s1End, s2End] = this.activeTrack.sectorFractions;
    const trackVersion = normalizeTrackVersion(
      (this.activeTrack as ITrackSplineSchema & { trackVersion?: string }).trackVersion
    );
    const geometryHash = geom.collisionHandle?.geometryHash ?? `${this.activeTrack.id}_${trackVersion}`;
    const sessionMode: SessionMode = st.aiEnabled ? 'ai_race' : this.sessionMode;
    const sectorNames =
      geom.collisionHandle?.sectors.map((s) => s.name) ?? ['Sector 1', 'Sector 2', 'Sector 3'];

    if (st.currentSector === 0 && nextProgress >= s1End && prevProgress < s1End) {
      const split = st.currentLapTimeMs - this.sectorStartTimeMs;
      st.sectorTimesMs[0] = split;
      st.currentSector = 1;
      st.checkpointMask |= 1 << 0;
      this.sectorStartTimeMs = st.currentLapTimeMs;
      const prevBest = this.bestSectorTimesMs[0];
      const isBestSector = st.lapValid && (prevBest === null || split < prevBest);
      if (isBestSector) this.bestSectorTimesMs[0] = split;
      this.events.emit('sector:split', {
        sectorIndex: 0,
        splitTimeMs: split,
        vehicleId: st.vehicleId,
        tick: this.simTick,
        sessionMode,
        trackId: this.activeTrack.id,
        trackVersion,
        rulesetVersion: CURRENT_RULESET_VERSION,
        lapNumber: st.currentLap,
        sectorCount: 3,
        sectorName: sectorNames[0] ?? 'Sector 1',
        cumulativeLapTimeMs: st.currentLapTimeMs,
        deltaToBestSectorMs: prevBest !== null ? split - prevBest : null,
        isBestSector,
        sectorValid: st.lapValid,
        checkpointMask: st.checkpointMask,
      });
    } else if (st.currentSector === 1 && nextProgress >= s2End && prevProgress < s2End) {
      const split = st.currentLapTimeMs - this.sectorStartTimeMs;
      st.sectorTimesMs[1] = split;
      st.currentSector = 2;
      st.checkpointMask |= 1 << 1;
      this.sectorStartTimeMs = st.currentLapTimeMs;
      const prevBest = this.bestSectorTimesMs[1];
      const isBestSector = st.lapValid && (prevBest === null || split < prevBest);
      if (isBestSector) this.bestSectorTimesMs[1] = split;
      this.events.emit('sector:split', {
        sectorIndex: 1,
        splitTimeMs: split,
        vehicleId: st.vehicleId,
        tick: this.simTick,
        sessionMode,
        trackId: this.activeTrack.id,
        trackVersion,
        rulesetVersion: CURRENT_RULESET_VERSION,
        lapNumber: st.currentLap,
        sectorCount: 3,
        sectorName: sectorNames[1] ?? 'Sector 2',
        cumulativeLapTimeMs: st.currentLapTimeMs,
        deltaToBestSectorMs: prevBest !== null ? split - prevBest : null,
        isBestSector,
        sectorValid: st.lapValid,
        checkpointMask: st.checkpointMask,
      });
    }

    // Start/Finish Line Crossing
    if (this.passedMidTrack && prevProgress > 0.85 && nextProgress < 0.15) {
      const finishedLapTime = st.currentLapTimeMs;
      const s3Split = Math.max(0, finishedLapTime - this.sectorStartTimeMs);
      st.sectorTimesMs[2] = s3Split;
      const prevBestS3 = this.bestSectorTimesMs[2];
      if (st.lapValid && (prevBestS3 === null || s3Split < prevBestS3)) {
        this.bestSectorTimesMs[2] = s3Split;
      }

      st.lastLapTimeMs = finishedLapTime;
      const prevBestLap = st.bestLapTimeMs;
      const deltaToBestLapMs = prevBestLap !== null ? finishedLapTime - prevBestLap : null;
      st.lapDeltaMs = deltaToBestLapMs ?? 0;

      const isPersonalBest =
        st.lapValid && (prevBestLap === null || finishedLapTime < prevBestLap);
      if (isPersonalBest) {
        st.bestLapTimeMs = finishedLapTime;
      }

      this.events.emit('lap:finished', {
        trackId: this.activeTrack.id,
        balanceVersionId: this.balanceConfig.version_id,
        lapNumber: st.currentLap,
        lapTimeMs: finishedLapTime,
        sectorTimesMs: [...st.sectorTimesMs] as [number, number, number],
        peakSpeedKph: Math.round(st.peakLapSpeedKph * 10) / 10,
        chassisId: this.compiledVehicle.build.chassisId,
        buildId: this.compiledVehicle.build.id,
        pwrRatio: this.compiledVehicle.pwrRatioHpPerKg,
        isAiAssisted: st.aiEnabled,
        lapValid: st.lapValid,
        vehicleId: st.vehicleId,
        tick: this.simTick,
        sessionMode,
        trackVersion,
        geometryHash,
        physicsVersion: CURRENT_PHYSICS_VERSION,
        rulesetVersion: CURRENT_RULESET_VERSION,
        buildSchemaVersion: normalizeBuildSchemaVersion(this.compiledVehicle.build.buildSchemaVersion),
        sectorNames,
        deltaToBestLapMs,
        isPersonalBest,
        invalidReasons: [...this.invalidReasons],
        checkpointMask: st.checkpointMask,
        orderedCheckpointsHit: [0, 1, 2],
        peakSpeedMs: Math.round((st.peakLapSpeedKph / 3.6) * 100) / 100,
        verificationLevel: 'local',
      });

      st.currentLap += 1;
      st.currentSector = 0;
      st.currentLapTimeMs = 0;
      this.sectorStartTimeMs = 0;
      st.peakLapSpeedKph = st.speedKph;
      st.lapValid = true;
      st.offTrackCount = 0;
      st.checkpointMask = 0;
      this.invalidReasons = [];
      this.passedMidTrack = false;
    }
  }

  // --- IEngineContext Implementation ---

  public getVisualMode(): VisualMode {
    return this.visualMode;
  }

  public setVisualMode(mode: VisualMode): void {
    if (this.visualMode === mode) return;
    this.visualMode = mode;
    if (mode === 'track') {
      this.simulationPaused = false;
      this.resetVehicleToStart();
    }
    this.events.emit('mode:changed', { mode });
  }

  public getCameraPreset(): CameraPreset {
    return this.cameraPreset;
  }

  public setCameraPreset(preset: CameraPreset): void {
    this.cameraPreset = preset;
    this.events.emit('camera:preset', { preset });
  }

  public setSimulationPaused(paused: boolean): void {
    if (this.simulationPaused === paused) return;
    this.simulationPaused = paused;
    if (paused) {
      this.accumulatorS = 0;
    }
    this.events.emit('sim:paused', { paused });
  }

  public isSimulationPaused(): boolean {
    return this.simulationPaused;
  }

  public setDrivingAssists(partial: Partial<IDrivingAssistConfig>): void {
    this.assists = { ...this.assists, ...partial };
    this.runtimeState.transmissionMode = this.assists.transmissionMode;
    this.runtimeState.assistPreset = this.assists.assistPreset;
    this.lapTimer?.setRuleset({
      assistPreset: this.assists.assistPreset,
      transmissionMode: this.assists.transmissionMode,
    });
    this.events.emit('assists:changed', { ...this.assists });
  }

  public getDrivingAssists(): IDrivingAssistConfig {
    return { ...this.assists };
  }

  public setKeyBindings(partial: Partial<IKeyBindings>): void {
    this.keyBindings = {
      ...this.keyBindings,
      ...partial,
    };
  }

  public getKeyBindings(): IKeyBindings {
    return this.keyBindings;
  }

  public getLabOverlayOptions(): ILabOverlayOptions {
    return this.labOverlays;
  }

  public setLabOverlayOptions(partial: Partial<ILabOverlayOptions>): void {
    this.labOverlays = { ...this.labOverlays, ...partial };
    this.events.emit('lab:overlay-toggled', {
      wireframe: this.labOverlays.wireframe,
      cgSphere: this.labOverlays.cgSphere,
      aeroVectors: this.labOverlays.aeroVectors,
    });
    if ('highlightedModule' in partial) {
      this.events.emit('lab:highlight-module', {
        module: this.labOverlays.highlightedModule,
      });
    }
  }

  public getBalanceConfig(): IGlobalBalanceConfig {
    return this.balanceConfig;
  }

  public setBalanceConfig(config: IGlobalBalanceConfig): void {
    this.balanceConfig = config;
    this.lapTimer?.setRuleset({ balanceVersionId: config.version_id });
    this.compiledVehicle = compileVehicleBuild(this.compiledVehicle.build, config);
    this.registry.notifyBalanceConfig(config);
    this.registry.notifyBuildCompiled(this.compiledVehicle);
    this.events.emit('config:updated', { config });
    this.events.emit('car:rebuilt', { compiled: this.compiledVehicle });
  }

  public getCompiledVehicle(): ICompiledVehicle {
    return this.compiledVehicle;
  }

  public updateBuild(build: IVehicleBuildConfig): ICompiledVehicle {
    this.compiledVehicle = compileVehicleBuild(build, this.balanceConfig);
    this.runtimeState.fuelLiters = build.fuelAndCooling.fuelLoadL;
    this.registry.notifyBuildCompiled(this.compiledVehicle);
    this.events.emit('car:build-updated', { build, compiled: this.compiledVehicle });
    this.events.emit('car:rebuilt', { compiled: this.compiledVehicle });
    return this.compiledVehicle;
  }

  public getActiveTrack(): ITrackSplineSchema {
    return this.activeTrack;
  }

  public selectTrack(trackId: string): void {
    const next = TRACKS_BY_ID.get(trackId);
    if (!next) return;
    this.activeTrack = next;
    this.runtimeState.ambientTempC = next.ambientTempC;
    this.runtimeState.trackTempC = next.trackTempC;
    this.runtimeState.bestLapTimeMs = null;
    this.runtimeState.lastLapTimeMs = null;
    this.bestSectorTimesMs = [null, null, null];
    this.events.emit('track:selected', { trackId: next.id, schema: next });
    if (this.visualMode === 'track') {
      this.resetVehicleToStart();
    }
  }

  public getTrackGeometry(): ITrackGeometryData | null {
    return this.trackGeometry;
  }

  public setTrackGeometry(geometry: ITrackGeometryData): void {
    this.trackGeometry = geometry;
    if (geometry.collisionHandle) {
      this.lapTimer = new LapSectorTimer(geometry.collisionHandle, geometry.spline, {
        startTimingMode: 'standing_on_launch',
        sessionMode: this.runtimeState.aiEnabled ? 'ai_race' : this.sessionMode,
        ruleset: {
          balanceVersionId: this.balanceConfig.version_id,
          assistPreset: this.assists.assistPreset,
          transmissionMode: this.assists.transmissionMode,
        },
      });
    } else {
      this.lapTimer = null;
    }
    this.events.emit('track:built', { geometry });
    if (this.visualMode === 'track') {
      this.resetVehicleToStart();
    }
  }

  public getRuntimeState(): IVehicleRuntimeState {
    return this.runtimeState;
  }

  public getCurrentTick(): number {
    return this.simTick;
  }

  public getFixedStepInputFrame(): IFixedStepInputFrame {
    return this.fixedInputFrame;
  }

  public onFixedStep(
    listener: (
      tick: number,
      inputFrame: IFixedStepInputFrame,
      snapshot: IVehicleStateSnapshot
    ) => void
  ): () => void {
    this.fixedStepListeners.add(listener);
    return () => {
      this.fixedStepListeners.delete(listener);
    };
  }

  public getSessionMode(): SessionMode {
    return this.sessionMode;
  }

  public setSessionMode(mode: SessionMode): void {
    if (this.sessionMode === mode) return;
    this.sessionMode = mode;
    if (!this.runtimeState.aiEnabled) {
      this.lapTimer?.setSessionMode(mode);
    }
    this.events.emit('session:mode-changed', { mode });
  }

  public getVehicleCollisionHandle(vehicleId = 'v0'): IVehicleCollisionHandle {
    const comp = this.compiledVehicle;
    return {
      handleId: `veh_col_${vehicleId}_${comp.build.chassisId}`,
      vehicleId,
      chassisId: comp.build.chassisId,
      buildSchemaVersion: normalizeBuildSchemaVersion(comp.build.buildSchemaVersion),
      collisionEnabled: true,
      hull: comp.collisionHull,
      wheelAnchorsLocal: comp.wheelPositionsLocal,
      wheelRadiusFrontM: comp.wheelRadiusFrontM,
      wheelRadiusRearM: comp.wheelRadiusRearM,
    };
  }

  public getVehicleRenderHandle(vehicleId = 'v0'): IVehicleRenderHandle {
    const comp = this.compiledVehicle;
    return {
      handleId: `veh_ren_${vehicleId}_${comp.build.chassisId}`,
      vehicleId,
      chassisId: comp.build.chassisId,
      isGhost: false,
      cockpitEyeLocal: { ...comp.cockpitEyeLocal },
      steeringWheelLocal: { ...comp.steeringWheelLocal },
      hoodCamLocal: { ...comp.hoodCamLocal },
      sceneObject: null,
      dispose: () => {},
    };
  }

  public getVehicleSnapshot(_vehicleId = 'v0'): IVehicleStateSnapshot {
    const st = this.runtimeState;
    const comp = this.compiledVehicle;
    const inp = this.activeInput;

    const mapWheel = (idx: WheelIndex): IWheelStateSnapshot => {
      const w = st.wheels[idx];
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
        lockupIntensity: w.lockupIntensity,
        scrubIntensity: w.scrubIntensity,
        tireTempC: w.tireTempC,
        tireWear: w.tireWear,
        brakeTempC: w.brakeTempC,
      };
    };

    const brakeLightOn =
      (st.reverseState !== 'reverse' && inp.brake > 0.05) ||
      st.wheels[0].brakeTorqueNm + st.wheels[1].brakeTorqueNm > 80;

    return {
      tick: st.simTick,
      simTimeMs: st.simTimeMs,
      vehicleId: st.vehicleId,
      slotIndex: 0,
      controllerKind: st.aiEnabled ? 'ai' : 'local',
      position: { ...st.position },
      rotation: { ...st.rotation },
      linearVelocityWorld: { ...st.linearVelocityWorld },
      angularVelocityWorld: { ...st.angularVelocityWorld },
      speedMs: st.speedMs,
      forwardSpeedMs: st.forwardSpeedMs,
      longitudinalG: st.longitudinalG,
      lateralG: st.lateralG,
      yawRateRadS: st.yawRateRadS,
      bodySlipAngleRad: st.bodySlipAngleRad,
      rawSteerInput: st.rawSteerInput,
      commandedSteer: st.commandedSteer,
      frontWheelAngleRad: st.frontWheelAngleRad,
      throttle: inp.throttle,
      brake: inp.brake,
      handbrake: inp.handbrake,
      brakeLightOn,
      reverseState: st.reverseState,
      transmissionMode: st.transmissionMode,
      assistPreset: st.assistPreset,
      gear: st.gear,
      isShifting: st.isShifting,
      shiftDirection: st.shiftDirection,
      engineRpm: st.engineRpm,
      idleRpm: comp.idleRpm,
      redlineRpm: comp.redlineRpm,
      revLimiterRpm: comp.revLimiterRpm,
      engineLoad: st.engineLoad,
      turboBoostBar: st.turboBoostBar,
      maxBoostBar: comp.maxBoostBar,
      fuelLiters: st.fuelLiters,
      fuelCapacityL: Math.max(5, comp.build.fuelAndCooling.fuelLoadL),
      engineTempC: st.engineTempC,
      engineMaxSafeTempC: comp.engineMaxSafeTempC,
      engineLimpMode: st.engineLimpMode,
      engineBlown: st.engineBlown,
      downforceTotalN: st.downforceTotalN,
      diffuserStalled: st.diffuserStalled,
      wheels: [mapWheel(0), mapWheel(1), mapWheel(2), mapWheel(3)],
      damageZones: [...st.damageZones] as DamageZoneTuple,
      lastImpact: st.lastImpact ? { ...st.lastImpact, localDirection: { ...st.lastImpact.localDirection } } : null,
      lapNumber: st.currentLap,
      sectorIndex: st.currentSector,
      sectorCount: 3,
      splineProgress: st.splineProgress,
      lapArmed: st.lapArmed,
      currentLapTimeMs: st.currentLapTimeMs,
      lastLapTimeMs: st.lastLapTimeMs,
      bestLapTimeMs: st.bestLapTimeMs,
      lapDeltaMs: st.lapDeltaMs,
      sectorTimesMs: [...st.sectorTimesMs],
      lapValid: st.lapValid,
      checkpointMask: st.checkpointMask,
    };
  }

  public getInputState(): IInputState {
    return this.activeInput;
  }

  public setHardwareInput(source: 'keyboard' | 'touch', partial: Partial<IInputState>): void {
    const target = source === 'touch' ? this.touchInput : this.keyboardInput;
    Object.assign(target, partial);
  }

  public resetVehicleToStart(): void {
    const slot0 = this.trackGeometry?.collisionHandle?.startGrid?.[0];
    const spawn = slot0
      ? { position: slot0.position, rotation: slot0.rotation, splineProgress: slot0.splineProgress }
      : this.trackGeometry
      ? {
          position: this.trackGeometry.spawnPosition,
          rotation: this.trackGeometry.spawnRotation,
          splineProgress: 0.005,
        }
      : {
          position: { x: 0, y: 0.75, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          splineProgress: 0,
        };

    const st = this.runtimeState;
    st.position = { ...spawn.position };
    st.prevPosition = { ...spawn.position };
    st.rotation = { ...spawn.rotation };
    st.prevRotation = { ...spawn.rotation };
    st.linearVelocityWorld = { x: 0, y: 0, z: 0 };
    st.angularVelocityWorld = { x: 0, y: 0, z: 0 };
    st.localVelocity = { x: 0, y: 0, z: 0 };
    st.speedMs = 0;
    st.forwardSpeedMs = 0;
    st.speedKph = 0;
    st.longitudinalG = 0;
    st.lateralG = 0;
    st.yawRateRadS = 0;
    st.bodySlipAngleRad = 0;
    st.rawSteerInput = 0;
    st.commandedSteer = 0;
    st.frontWheelAngleRad = 0;
    st.reverseState = 'forward';
    st.engineRpm = this.compiledVehicle.idleRpm;
    st.engineTorqueNm = 0;
    st.enginePowerHp = 0;
    st.engineLoad = 0;
    st.turboBoostBar = 0;
    st.gear = 1;
    st.isShifting = false;
    st.shiftDirection = 0;
    st.shiftTimerS = 0;
    st.fuelLiters = this.compiledVehicle.build.fuelAndCooling.fuelLoadL;
    st.engineTempC = 82;
    st.engineLimpMode = false;
    st.engineBlown = false;
    st.damageZones = createZeroDamageZones();
    st.lastImpact = null;
    st.forceAccumulatorWorld = { x: 0, y: 0, z: 0 };
    st.torqueAccumulatorWorld = { x: 0, y: 0, z: 0 };
    st.pointForces.length = 0;
    st.splineProgress = spawn.splineProgress;
    st.lapArmed = false;
    st.checkpointMask = 0;
    st.currentSector = 0;
    st.currentLapTimeMs = 0;
    st.sectorTimesMs = [0, 0, 0];
    this.sectorStartTimeMs = 0;
    this.invalidReasons = [];
    st.peakLapSpeedKph = 0;
    st.lapValid = true;
    st.offTrackCount = 0;
    this.passedMidTrack = false;

    for (let i = 0; i < 4; i++) {
      const w = st.wheels[i];
      w.angularVelocityRadS = 0;
      w.slipRatio = 0;
      w.slipAngleRad = 0;
      w.longitudinalForceN = 0;
      w.lateralForceN = 0;
      w.driveTorqueNm = 0;
      w.brakeTorqueNm = 0;
      w.tireTempC = this.activeTrack.ambientTempC + 28;
      w.tireWear = 0;
      w.brakeTempC = this.activeTrack.ambientTempC + 40;
      w.brakeFadeMultiplier = 1.0;
      w.thermalGripMultiplier = 1.0;
      w.lockupIntensity = 0;
      w.scrubIntensity = 0;
    }

    const resetInvalidEvent = this.lapTimer?.resetVehicle(st.vehicleId, {
      tick: this.simTick,
      slotIndex: 0,
      position: spawn.position,
      splineProgress: spawn.splineProgress,
      preserveBestLap: true,
      emitInvalidationIfArmed: true,
    });
    if (resetInvalidEvent) {
      this.events.emit('lap:invalidated', resetInvalidEvent);
    }

    this.events.emit('vehicle:reset', {
      position: { ...spawn.position },
      rotation: { ...spawn.rotation },
    });
  }

  public setAiEnabled(enabled: boolean): void {
    this.runtimeState.aiEnabled = enabled;
    this.lapTimer?.setSessionMode(enabled ? 'ai_race' : this.sessionMode);
    this.events.emit('ai:toggled', { enabled });
  }
}
