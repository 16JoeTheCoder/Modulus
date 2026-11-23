import * as THREE from 'three';
import { createStarterBuild, TRACKS_BY_ID, TRACKS_CATALOG } from '../content';
import { EventBus } from './EventBus';
import { compileVehicleBuild } from './math/vehicleCompiler';
import { PluginRegistry } from './PluginRegistry';
import {
  DEFAULT_BALANCE_CONFIG,
  type CameraPreset,
  type ICompiledVehicle,
  type IEngineContext,
  type IGlobalBalanceConfig,
  type IInputState,
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

export const FIXED_PHYSICS_HZ = 120;
export const FIXED_DT = 1 / FIXED_PHYSICS_HZ;
const MAX_SUBSTEPS_PER_FRAME = 8;

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
    tireTempC: ambientTempC + 12,
    tireWear: 0,
    thermalGripMultiplier: 1.0,
    brakeTempC: ambientTempC + 15,
    brakeFadeMultiplier: 1.0,
  };
}

function createInitialRuntimeState(
  compiled: ICompiledVehicle,
  track: ITrackSplineSchema
): IVehicleRuntimeState {
  return {
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
    speedKph: 0,
    longitudinalG: 0,
    lateralG: 0,
    yawRateRadS: 0,

    engineRpm: compiled.idleRpm,
    engineTorqueNm: 0,
    enginePowerHp: 0,
    turboBoostBar: 0,
    gear: 1,
    shiftTimerS: 0,
    isShifting: false,
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

    forceAccumulatorWorld: { x: 0, y: 0, z: 0 },
    torqueAccumulatorWorld: { x: 0, y: 0, z: 0 },
    pointForces: [],

    aiEnabled: false,
    aiTargetPointWorld: { x: 0, y: 0, z: 20 },
    splineProgress: 0,
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
  private cameraPreset: CameraPreset = 'chase';
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

  private rafId: number | null = null;
  private running = false;
  private accumulatorS = 0;
  private lastFrameTimeMs = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private boundOnResize: () => void;
  private passedMidTrack = false;
  private sectorStartTimeMs = 0;

  constructor(initialPlugins: IModulusPlugin[] = []) {
    const starterBuild = createStarterBuild();
    this.compiledVehicle = compileVehicleBuild(starterBuild, this.balanceConfig);
    this.runtimeState = createInitialRuntimeState(this.compiledVehicle, this.activeTrack);
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
      inputSource: source,
    };
  }

  /**
   * Mounts the SINGLE persistent WebGL context onto the host canvas.
   * Never destroys/recreates WebGL on resize or orientation change (iOS Safari safe).
   */
  public async mountCanvas(canvas: HTMLCanvasElement): Promise<void> {
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

      if (this.visualMode === 'track') {
        this.accumulatorS += rawDtS;
        let substeps = 0;
        while (this.accumulatorS >= FIXED_DT && substeps < MAX_SUBSTEPS_PER_FRAME) {
          this.mergeHardwareInputs();
          if (this.activeInput.resetVehicle) {
            this.activeInput.resetVehicle = false;
            this.keyboardInput.resetVehicle = false;
            this.touchInput.resetVehicle = false;
            this.resetVehicleToStart();
          }
          this.registry.stepPhysics(FIXED_DT, this.runtimeState, this.activeInput);
          this.updateLapAndSectorTiming(FIXED_DT);
          // Clear edge-triggered shift flags after one physics step
          this.keyboardInput.gearUp = false;
          this.keyboardInput.gearDown = false;
          this.touchInput.gearUp = false;
          this.touchInput.gearDown = false;

          this.accumulatorS -= FIXED_DT;
          substeps++;
        }
        if (substeps === MAX_SUBSTEPS_PER_FRAME) {
          this.accumulatorS = 0;
        }
      } else {
        // In Engineering Lab mode, keep car resting cleanly at studio pedestal (0, 0, 0)
        this.accumulatorS = 0;
      }

      const alpha = this.visualMode === 'track' ? this.accumulatorS / FIXED_DT : 1.0;
      this.registry.renderAll(alpha, this.runtimeState);

      if (this.renderer) {
        this.renderer.render(this.scene, this.camera);
      }
    };

    this.rafId = requestAnimationFrame(tick);
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
    const prevProgress = st.splineProgress;
    const closest = geom.spline.findClosestSample(st.position, prevProgress);
    const nextProgress = closest.sample.t;
    st.splineProgress = nextProgress;

    if (st.speedKph > st.peakLapSpeedKph) {
      st.peakLapSpeedKph = st.speedKph;
    }

    const halfWidth = closest.sample.widthM * 0.5;
    if (Math.abs(closest.lateralOffsetM) > halfWidth + 2.5) {
      st.offTrackCount++;
      if (st.offTrackCount > 120) {
        st.lapValid = false;
      }
    } else {
      st.offTrackCount = 0;
    }

    st.currentLapTimeMs += dt * 1000;

    if (nextProgress > 0.42 && nextProgress < 0.62) {
      this.passedMidTrack = true;
    }

    const [s1End, s2End] = this.activeTrack.sectorFractions;
    if (st.currentSector === 0 && nextProgress >= s1End && prevProgress < s1End) {
      const split = st.currentLapTimeMs - this.sectorStartTimeMs;
      st.sectorTimesMs[0] = split;
      st.currentSector = 1;
      this.sectorStartTimeMs = st.currentLapTimeMs;
      this.events.emit('sector:split', { sectorIndex: 0, splitTimeMs: split });
    } else if (st.currentSector === 1 && nextProgress >= s2End && prevProgress < s2End) {
      const split = st.currentLapTimeMs - this.sectorStartTimeMs;
      st.sectorTimesMs[1] = split;
      st.currentSector = 2;
      this.sectorStartTimeMs = st.currentLapTimeMs;
      this.events.emit('sector:split', { sectorIndex: 1, splitTimeMs: split });
    }

    // Start/Finish Line Crossing
    if (this.passedMidTrack && prevProgress > 0.85 && nextProgress < 0.15) {
      const finishedLapTime = st.currentLapTimeMs;
      st.sectorTimesMs[2] = Math.max(0, finishedLapTime - this.sectorStartTimeMs);
      st.lastLapTimeMs = finishedLapTime;

      if (st.bestLapTimeMs !== null) {
        st.lapDeltaMs = finishedLapTime - st.bestLapTimeMs;
      } else {
        st.lapDeltaMs = 0;
      }

      if (st.lapValid && (st.bestLapTimeMs === null || finishedLapTime < st.bestLapTimeMs)) {
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
      });

      st.currentLap += 1;
      st.currentSector = 0;
      st.currentLapTimeMs = 0;
      this.sectorStartTimeMs = 0;
      st.peakLapSpeedKph = st.speedKph;
      st.lapValid = true;
      st.offTrackCount = 0;
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
    this.events.emit('track:built', { geometry });
    if (this.visualMode === 'track') {
      this.resetVehicleToStart();
    }
  }

  public getRuntimeState(): IVehicleRuntimeState {
    return this.runtimeState;
  }

  public getInputState(): IInputState {
    return this.activeInput;
  }

  public setHardwareInput(source: 'keyboard' | 'touch', partial: Partial<IInputState>): void {
    const target = source === 'touch' ? this.touchInput : this.keyboardInput;
    Object.assign(target, partial);
  }

  public resetVehicleToStart(): void {
    const spawn = this.trackGeometry
      ? { position: this.trackGeometry.spawnPosition, rotation: this.trackGeometry.spawnRotation }
      : { position: { x: 0, y: 0.75, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };

    const st = this.runtimeState;
    st.position = { ...spawn.position };
    st.prevPosition = { ...spawn.position };
    st.rotation = { ...spawn.rotation };
    st.prevRotation = { ...spawn.rotation };
    st.linearVelocityWorld = { x: 0, y: 0, z: 0 };
    st.angularVelocityWorld = { x: 0, y: 0, z: 0 };
    st.localVelocity = { x: 0, y: 0, z: 0 };
    st.speedMs = 0;
    st.speedKph = 0;
    st.longitudinalG = 0;
    st.lateralG = 0;
    st.yawRateRadS = 0;
    st.engineRpm = this.compiledVehicle.idleRpm;
    st.gear = 1;
    st.isShifting = false;
    st.shiftTimerS = 0;
    st.fuelLiters = this.compiledVehicle.build.fuelAndCooling.fuelLoadL;
    st.engineTempC = 82;
    st.engineLimpMode = false;
    st.engineBlown = false;
    st.forceAccumulatorWorld = { x: 0, y: 0, z: 0 };
    st.torqueAccumulatorWorld = { x: 0, y: 0, z: 0 };
    st.pointForces.length = 0;
    st.splineProgress = 0.005;
    st.currentSector = 0;
    st.currentLapTimeMs = 0;
    this.sectorStartTimeMs = 0;
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
    }

    this.events.emit('vehicle:reset', {
      position: { ...spawn.position },
      rotation: { ...spawn.rotation },
    });
  }

  public setAiEnabled(enabled: boolean): void {
    this.runtimeState.aiEnabled = enabled;
    this.events.emit('ai:toggled', { enabled });
  }
}
