import type * as THREE from 'three';
import type { IGlobalBalanceConfig } from './balance';
import type { ITrackSplineSchema, PartModuleCategory, Quat, Vec3 } from './content';
import type { ICompiledVehicle, IInputState, IVehicleBuildConfig, IVehicleRuntimeState } from './vehicle';
import type { TrackSpline } from '../math/spline';

export type VisualMode = 'lab' | 'track';
export type CameraPreset = 'chase' | 'hood' | 'orbit';

export interface ILapFinishedPayload {
  trackId: string;
  balanceVersionId: string;
  lapNumber: number;
  lapTimeMs: number;
  sectorTimesMs: [number, number, number];
  peakSpeedKph: number;
  chassisId: string;
  buildId: string;
  pwrRatio: number;
  isAiAssisted: boolean;
  lapValid: boolean;
}

export interface ITrackGeometryData {
  trackSchema: ITrackSplineSchema;
  spline: TrackSpline;
  /** Flat road + kerb collision vertices (x, y, z triples) for Rapier trimesh */
  roadVertices: Float32Array;
  roadIndices: Uint32Array;
  /** Optional left/right guardrail wall trimesh for off-track containment */
  wallVertices?: Float32Array;
  wallIndices?: Uint32Array;
  /** Triangle surface lookup: 0 = tarmac, 1 = kerb, 2 = grass */
  triangleSurfaces?: Uint8Array;
  spawnPosition: Vec3;
  spawnRotation: Quat;
}

export interface IAuthUser {
  id: string;
  email: string;
  role: 'player' | 'admin';
  credits: number;
  unlockAll: boolean;
}

export interface EngineEventMap {
  'mode:changed': { mode: VisualMode };
  'camera:preset': { preset: CameraPreset };
  'lab:overlay-toggled': { wireframe: boolean; cgSphere: boolean; aeroVectors: boolean };
  'lab:highlight-module': { module: PartModuleCategory | null };
  'car:build-updated': { build: IVehicleBuildConfig; compiled: ICompiledVehicle };
  'car:rebuilt': { compiled: ICompiledVehicle };
  'vehicle:reset': { position: Vec3; rotation: Quat };
  'track:selected': { trackId: string; schema: ITrackSplineSchema };
  'track:built': { geometry: ITrackGeometryData };
  'lap:finished': ILapFinishedPayload;
  'sector:split': { sectorIndex: number; splitTimeMs: number };
  'config:updated': { config: IGlobalBalanceConfig };
  'ai:toggled': { enabled: boolean };
  'auth:open-modal': undefined;
  'auth:changed': { user: IAuthUser | null };
  'sync:status': { syncing: boolean; lastSyncedAt: string | null; error: string | null };
  'economy:updated': { credits: number; ownedPartIds: string[] };
}

export interface ITypedEventBus {
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void
  ): () => void;
  once<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void
  ): () => void;
  emit<K extends keyof EngineEventMap>(event: K, payload: EngineEventMap[K]): void;
  clear(): void;
}

export interface ILabOverlayOptions {
  wireframe: boolean;
  cgSphere: boolean;
  aeroVectors: boolean;
  highlightedModule: PartModuleCategory | null;
}

export interface IEngineContext {
  readonly events: ITypedEventBus;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer | null;
  readonly canvas: HTMLCanvasElement | null;

  getVisualMode(): VisualMode;
  setVisualMode(mode: VisualMode): void;
  getCameraPreset(): CameraPreset;
  setCameraPreset(preset: CameraPreset): void;
  getLabOverlayOptions(): ILabOverlayOptions;
  setLabOverlayOptions(partial: Partial<ILabOverlayOptions>): void;

  getBalanceConfig(): IGlobalBalanceConfig;
  setBalanceConfig(config: IGlobalBalanceConfig): void;

  getCompiledVehicle(): ICompiledVehicle;
  updateBuild(build: IVehicleBuildConfig): ICompiledVehicle;

  getActiveTrack(): ITrackSplineSchema;
  selectTrack(trackId: string): void;
  getTrackGeometry(): ITrackGeometryData | null;
  setTrackGeometry(geometry: ITrackGeometryData): void;

  getRuntimeState(): IVehicleRuntimeState;
  getInputState(): IInputState;
  setHardwareInput(source: 'keyboard' | 'touch', partial: Partial<IInputState>): void;

  resetVehicleToStart(): void;
  setAiEnabled(enabled: boolean): void;
}

/**
 * Core Locked Plugin Contract (ARCHITECTURE.md Section 3)
 */
export interface IModulusPlugin {
  readonly id: string;
  readonly version: string;
  readonly priority: number; // Execution order in 120Hz loop
  init(ctx: IEngineContext): Promise<void> | void;
  onBalanceConfigUpdated?(config: IGlobalBalanceConfig): void;
  onBuildCompiled?(vehicle: ICompiledVehicle): void;
  onPhysicsStep?(dt: number, state: IVehicleRuntimeState, input: IInputState): void;
  onRender?(alpha: number, state: IVehicleRuntimeState): void;
  dispose?(): void;
}
