import * as THREE from 'three';
import {
  CURRENT_PHYSICS_VERSION,
  CURRENT_RULESET_VERSION,
  INPUT_FLAG,
  normalizeBuildSchemaVersion,
  normalizeTrackVersion,
  type ICarBuildVersionMeta,
  type IFixedStepInputFrame,
  type ILapInvalidatedEvent,
  type IRulesetVersionKey,
  type ISimulationCheckpoint,
  type ITrackSchemaV2Extensions,
  type ITrackVersionMeta,
  type IVehicleStateSnapshot,
  type SessionMode,
} from '../../contracts/simulation';
import type {
  ICompiledVehicle,
  IEngineContext,
  IInputState,
  IModulusPlugin,
  IVehicleRuntimeState,
} from '../../core/types';
import {
  GhostPlayer,
  GhostRecorder,
  makeReplayPartitionKey,
  validateReplayIntegrity,
  type IGhostPlaybackPose,
  type ITimeTrialReplayBundle,
} from '../../replay';
import {
  normalizeLapFinishedEvent,
  readVehicleSnapshot,
} from '../../ui/engineBridge';
import { buildGhostCarMesh, type IGhostCarRig } from './buildGhostCarMesh';
import {
  getGhostHudState,
  getSharedGhostStorage,
  publishGhostHudState,
  setActiveFriendGhost,
  setGhostSessionMode,
  setGhostVisible,
  subscribeFriendGhost,
  subscribeGhostSessionMode,
  subscribeGhostVisibility,
  type IGhostHudState,
  type IPhysicsGhostHooks,
} from './ghostBridge';

declare global {
  interface Window {
    __modulusGhost?: {
      getState: () => IGhostHudState;
      setSessionMode: (mode: SessionMode) => void;
      setVisible: (visible: boolean) => void;
      getLastPose: () => IGhostPlaybackPose | null;
      getLoadedReplay: () => ITimeTrialReplayBundle | null;
      loadFriendGhost: (bundle: ITimeTrialReplayBundle | null) => void;
      isMeshVisible: () => boolean;
      hasCollisionBody: () => false;
    };
  }
}

const HUD_PUBLISH_INTERVAL_MS = 50; // ~20 Hz throttled live delta updates
const PROXIMITY_FADE_NEAR_M = 1.6;
const PROXIMITY_FADE_FAR_M = 4.2;

function buildFallbackInputFrame(
  tick: number,
  input: IInputState,
  state: IVehicleRuntimeState
): IFixedStepInputFrame {
  let flags = INPUT_FLAG.NONE;
  if (input.gearUp) flags |= INPUT_FLAG.GEAR_UP;
  if (input.gearDown) flags |= INPUT_FLAG.GEAR_DOWN;
  if (input.resetVehicle) flags |= INPUT_FLAG.RESET_VEHICLE;

  const isAi = state.aiEnabled || input.inputSource === 'ai';
  return {
    tick,
    vehicleId: 'v0',
    controllerKind: isAi ? 'ai' : 'local',
    inputSource: isAi ? 'ai' : input.inputSource,
    throttle: input.throttle,
    brake: input.brake,
    steer: input.steer,
    handbrake: input.handbrake,
    clutch: input.clutch,
    flags,
  };
}

/**
 * Time Trial Ghost Recorder & Translucent Zero-Collision Ghost Renderer (`priority: 85`).
 *
 * - Strictly Time Trial only (never records or plays PB ghosts in Practice, Drift, AI, or Friend Race).
 * - Uses Engine `onFixedStep(tick, inputFrame, snapshot)` when exposed by `@physics`,
 *   with a clean `onPhysicsStep` fallback so it runs seamlessly across merge order.
 * - Saves improved local PBs to `GhostStorage` (IndexedDB) partitioned by track/ruleset/weather/assists
 *   and immediately loads the new PB into `GhostPlayer` for the next run + live delta.
 * - Renders a translucent holographic ghost silhouette with ZERO Rapier collision bodies
 *   and proximity fade near the player's camera so cockpit sightlines remain clear.
 */
class GhostRendererController implements IModulusPlugin {
  public readonly id = 'ghost-renderer';
  public readonly version = '1.0.0';
  public readonly priority = 85;

  private ctx: IEngineContext | null = null;
  private ghostRig: IGhostCarRig | null = null;
  private readonly recorder = new GhostRecorder();
  private readonly player = new GhostPlayer();
  private readonly storage = getSharedGhostStorage();

  private sessionMode: SessionMode = 'practice';
  private ghostVisible = true;
  private ghostSource: 'personal_best' | 'friend' | null = null;
  private friendGhostOverride: ITimeTrialReplayBundle | null = null;
  private lastPbImproved = false;
  private lastRecordedReplayId: string | null = null;
  private lastPose: IGhostPlaybackPose | null = null;
  private lastLiveDeltaMs: number | null = null;
  private lastHudPublishMs = 0;

  private usesEngineFixedStepHook = false;
  private fallbackTick = 0;
  private unsubs: Array<() => void> = [];
  private loadGeneration = 0;
  private readonly tmpGhostPos = new THREE.Vector3();

  public init(ctx: IEngineContext): void {
    this.ctx = ctx;
    this.rebuildGhostMesh(ctx.getCompiledVehicle());

    const hooks = ctx as unknown as IPhysicsGhostHooks;
    if (typeof hooks.getSessionMode === 'function') {
      this.sessionMode = hooks.getSessionMode();
    } else {
      this.sessionMode = getGhostHudState().sessionMode;
    }

    if (typeof hooks.onFixedStep === 'function') {
      this.usesEngineFixedStepHook = true;
      this.unsubs.push(
        hooks.onFixedStep((tick, inputFrame, snapshot) => {
          this.handleFixedStep(tick, inputFrame, snapshot);
        })
      );
    } else {
      this.usesEngineFixedStepHook = false;
    }

    this.unsubs.push(
      ctx.events.on('mode:changed', ({ mode }) => {
        if (mode === 'track') {
          this.syncSessionModeFromEngine();
          void this.refreshActiveGhostAndArmRecorder();
        } else {
          this.recorder.abortRun('left_track_mode');
          this.hideGhostMesh();
          this.publishHud(true);
        }
      }),
      ctx.events.on('track:selected', () => {
        this.recorder.abortRun('track_selected');
        this.lastPose = null;
        this.lastLiveDeltaMs = null;
        if (ctx.getVisualMode() === 'track') {
          void this.refreshActiveGhostAndArmRecorder();
        } else {
          this.publishHud(true);
        }
      }),
      ctx.events.on('track:built', () => {
        if (ctx.getVisualMode() === 'track') {
          void this.refreshActiveGhostAndArmRecorder();
        }
      }),
      ctx.events.on('vehicle:reset', () => {
        // Never splice two runs across a manual reset
        this.recorder.abortRun('vehicle_reset');
        this.lastPose = null;
        this.lastLiveDeltaMs = null;
        this.fallbackTick = 0;
        if (ctx.getVisualMode() === 'track') {
          this.armRecorderIfTimeTrial();
        }
        this.publishHud(true);
      }),
      ctx.events.on('ai:toggled', ({ enabled }) => {
        if (enabled) {
          this.recorder.abortRun('ai_enabled');
          this.publishHud(true);
        }
      }),
      (
        ctx.events as unknown as {
          on: (event: string, fn: (payload: ILapInvalidatedEvent) => void) => () => void;
        }
      ).on('lap:invalidated', (ev) => {
        this.recorder.onLapInvalidated(ev);
        this.publishHud(true);
      }),
      ctx.events.on('lap:finished', (rawPayload) => {
        this.handleLapFinished(rawPayload as unknown as Record<string, unknown>);
      }),
      subscribeGhostSessionMode((mode) => {
        this.applySessionModeChange(mode);
      }),
      // Subscribe to physics' 'session:mode-changed' EventBus event once landed (#44)
      (
        ctx.events as unknown as {
          on: (event: string, fn: (payload: { mode: SessionMode }) => void) => () => void;
        }
      ).on('session:mode-changed', ({ mode }) => {
        this.applySessionModeChange(mode);
      }),
      subscribeGhostVisibility((visible) => {
        this.ghostVisible = visible;
        if (!visible) this.hideGhostMesh();
        this.publishHud(true);
      }),
      subscribeFriendGhost((bundle) => {
        this.loadGeneration++;
        this.friendGhostOverride = bundle;
        if (bundle) {
          this.player.load(bundle);
          this.ghostSource = 'friend';
        } else {
          void this.loadPersonalBestGhost();
        }
        this.publishHud(true);
      })
    );

    if (typeof window !== 'undefined') {
      const onWindowSessionMode = (event: Event) => {
        const detail = (event as CustomEvent<{ mode?: SessionMode } | SessionMode>).detail;
        const mode = typeof detail === 'string' ? detail : detail?.mode;
        if (mode) {
          this.applySessionModeChange(mode);
        }
      };
      window.addEventListener('modulus:session-mode', onWindowSessionMode);
      this.unsubs.push(() => {
        window.removeEventListener('modulus:session-mode', onWindowSessionMode);
      });

      window.__modulusGhost = {
        getState: () => getGhostHudState(),
        setSessionMode: (mode) => setGhostSessionMode(mode, ctx),
        setVisible: (visible) => setGhostVisible(visible),
        getLastPose: () => this.lastPose,
        getLoadedReplay: () => this.player.getLoadedBundle(),
        loadFriendGhost: (bundle) => setActiveFriendGhost(bundle),
        isMeshVisible: () => Boolean(this.ghostRig?.root.visible),
        hasCollisionBody: () => false,
      };
    }

    if (ctx.getVisualMode() === 'track') {
      void this.refreshActiveGhostAndArmRecorder();
    } else {
      this.publishHud(true);
    }
  }

  public onBuildCompiled(vehicle: ICompiledVehicle): void {
    this.recorder.abortRun('build_compiled');
    this.rebuildGhostMesh(vehicle);
    if (this.ctx?.getVisualMode() === 'track') {
      void this.refreshActiveGhostAndArmRecorder();
    }
  }

  public onPhysicsStep(_dt: number, state: IVehicleRuntimeState, input: IInputState): void {
    if (!this.ctx || this.usesEngineFixedStepHook) return;
    if (this.ctx.getVisualMode() !== 'track') return;

    this.syncSessionModeFromEngine();
    const snap = readVehicleSnapshot(this.ctx);
    const tick = typeof snap.tick === 'number' && snap.tick > 0 ? snap.tick : this.fallbackTick++;
    const frame = buildFallbackInputFrame(tick, input, state);
    this.handleFixedStep(tick, frame, snap);
  }

  public onRender(_alpha: number, _state: IVehicleRuntimeState): void {
    if (!this.ctx || !this.ghostRig) return;

    this.syncSessionModeFromEngine();
    const isTrack = this.ctx.getVisualMode() === 'track';
    const isTimeTrial = this.sessionMode === 'time_trial';

    if (!isTrack || !isTimeTrial || !this.ghostVisible || !this.player.isLoaded()) {
      this.hideGhostMesh();
      this.lastPose = null;
      this.lastLiveDeltaMs = null;
      this.publishHud(false);
      return;
    }

    const trackMeta = this.getTrackVersionMeta();
    if (!this.player.isCompatibleWithTrack(trackMeta)) {
      this.hideGhostMesh();
      this.lastPose = null;
      this.lastLiveDeltaMs = null;
      this.publishHud(false);
      return;
    }

    const snap = readVehicleSnapshot(this.ctx);
    const sampleTimeMs = snap.lapArmed ? snap.currentLapTimeMs : 0;
    const pose = this.player.sampleAtSimTimeMs(sampleTimeMs);
    if (!pose) {
      this.hideGhostMesh();
      this.lastPose = null;
      this.lastLiveDeltaMs = null;
      this.publishHud(false);
      return;
    }

    this.lastPose = pose;
    this.tmpGhostPos.set(pose.position.x, pose.position.y, pose.position.z);
    const camDistM = this.ctx.camera.position.distanceTo(this.tmpGhostPos);
    const proxT = Math.max(
      0,
      Math.min(1, (camDistM - PROXIMITY_FADE_NEAR_M) / (PROXIMITY_FADE_FAR_M - PROXIMITY_FADE_NEAR_M))
    );
    const proximityOpacityScale = 0.14 + 0.86 * proxT;

    this.ghostRig.root.visible = true;
    this.ghostRig.applyPose(pose, proximityOpacityScale);

    this.lastLiveDeltaMs = snap.lapArmed
      ? this.player.computeLiveDeltaMs(snap.splineProgress, snap.currentLapTimeMs)
      : null;

    this.publishHud(false);
  }

  public dispose(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.recorder.abortRun('disposed');
    if (this.ghostRig && this.ctx) {
      this.ctx.scene.remove(this.ghostRig.root);
      this.ghostRig.dispose();
      this.ghostRig = null;
    }
    if (typeof window !== 'undefined' && window.__modulusGhost) {
      delete window.__modulusGhost;
    }
    this.ctx = null;
  }

  // --- Internal Helpers ---

  private applySessionModeChange(mode: SessionMode): void {
    if (!this.ctx || this.sessionMode === mode) return;
    this.sessionMode = mode;
    this.recorder.abortRun('session_mode_changed');
    this.lastLiveDeltaMs = null;
    if (this.ctx.getVisualMode() === 'track') {
      void this.refreshActiveGhostAndArmRecorder();
    } else {
      this.hideGhostMesh();
      this.publishHud(true);
    }
  }

  private syncSessionModeFromEngine(): void {
    if (!this.ctx) return;
    const hooks = this.ctx as unknown as IPhysicsGhostHooks;
    if (typeof hooks.getSessionMode === 'function') {
      const engineMode = hooks.getSessionMode();
      if (engineMode && engineMode !== this.sessionMode) {
        this.sessionMode = engineMode;
        this.recorder.abortRun('engine_session_mode_changed');
        if (this.ctx.getVisualMode() === 'track') {
          void this.refreshActiveGhostAndArmRecorder();
        }
      }
    }
  }

  private handleFixedStep(
    _tick: number,
    inputFrame: IFixedStepInputFrame,
    snapshot: IVehicleStateSnapshot
  ): void {
    if (this.sessionMode !== 'time_trial') return;
    if (!this.recorder.isRecording() && snapshot.lapValid && inputFrame.controllerKind === 'local') {
      // Auto-arm cleanly if entering Time Trial without an explicit reset event
      this.armRecorderIfTimeTrial(snapshot);
    }
    this.recorder.recordFixedStep(inputFrame, snapshot);
  }

  private handleLapFinished(rawPayload: Record<string, unknown>): void {
    if (!this.ctx) return;
    this.syncSessionModeFromEngine();
    const track = this.ctx.getActiveTrack();
    const normalized = normalizeLapFinishedEvent(
      { ...rawPayload, sessionMode: this.sessionMode },
      track
    );

    if (this.sessionMode !== 'time_trial' || normalized.isAiAssisted || !normalized.lapValid) {
      this.recorder.abortRun('ineligible_lap');
      this.lastPbImproved = false;
      this.armRecorderIfTimeTrial();
      this.publishHud(true);
      return;
    }

    const nextCheckpoint = this.buildCurrentStartCheckpoint(readVehicleSnapshot(this.ctx));
    const bundle = this.recorder.finalizeLap(normalized, nextCheckpoint);
    if (!bundle) {
      this.lastPbImproved = false;
      this.publishHud(true);
      return;
    }

    const integrity = validateReplayIntegrity(bundle, {
      expectedTrackId: normalized.trackId,
      expectedTrackVersion: normalized.trackVersion,
      expectedBalanceVersionId: normalized.balanceVersionId,
    });

    if (!integrity.valid) {
      this.lastPbImproved = false;
      this.publishHud(true);
      return;
    }

    this.lastRecordedReplayId = bundle.header.replayId;
    void this.storage.savePersonalBestIfFaster(bundle).then((res) => {
      this.lastPbImproved = res.improved;
      if (res.improved && !this.friendGhostOverride) {
        this.player.load(bundle);
        this.ghostSource = 'personal_best';
      }
      this.publishHud(true);
    });
  }

  private async refreshActiveGhostAndArmRecorder(): Promise<void> {
    this.armRecorderIfTimeTrial();
    await this.loadPersonalBestGhost();
    this.publishHud(true);
  }

  private async loadPersonalBestGhost(): Promise<void> {
    if (!this.ctx) return;
    const gen = ++this.loadGeneration;

    if (this.sessionMode !== 'time_trial') {
      this.player.load(null);
      this.ghostSource = null;
      return;
    }

    if (this.friendGhostOverride && this.player.isCompatibleWithTrack(this.getTrackVersionMeta())) {
      this.player.load(this.friendGhostOverride);
      this.ghostSource = 'friend';
      return;
    }

    const key = makeReplayPartitionKey(this.getTrackVersionMeta(), this.getRulesetKey());
    const stored = await this.storage.getPersonalBest(key);
    if (gen !== this.loadGeneration || this.friendGhostOverride) return;

    if (stored?.bundle) {
      this.player.load(stored.bundle);
      this.ghostSource = 'personal_best';
    } else {
      this.player.load(null);
      this.ghostSource = null;
    }
  }

  private armRecorderIfTimeTrial(snapshot?: IVehicleStateSnapshot): void {
    if (!this.ctx) return;
    if (this.sessionMode !== 'time_trial' || this.ctx.getRuntimeState().aiEnabled) {
      this.recorder.abortRun('not_time_trial');
      return;
    }

    const snap = snapshot ?? readVehicleSnapshot(this.ctx);
    const checkpoint = this.buildCurrentStartCheckpoint(snap);
    this.recorder.beginRun({
      sessionMode: 'time_trial',
      driverDisplayName: 'Personal Best',
      track: checkpoint.track,
      ruleset: checkpoint.ruleset,
      buildMeta: checkpoint.vehicles[0].buildMeta,
      startCheckpoint: checkpoint,
    });
  }

  private getTrackVersionMeta(): ITrackVersionMeta {
    const track = this.ctx!.getActiveTrack();
    const ext = track as typeof track & ITrackSchemaV2Extensions;
    const geom = this.ctx!.getTrackGeometry() as
      | (ReturnType<IEngineContext['getTrackGeometry']> & {
          collisionHandle?: { geometryHash?: string };
        })
      | null;
    return {
      trackId: track.id,
      trackVersion: normalizeTrackVersion(ext.trackVersion),
      geometryHash: geom?.collisionHandle?.geometryHash ?? `${track.id}_${normalizeTrackVersion(ext.trackVersion)}`,
    };
  }

  private getRulesetKey(): IRulesetVersionKey {
    const snap = readVehicleSnapshot(this.ctx!);
    const cfg = this.ctx!.getBalanceConfig();
    return {
      physicsVersion: CURRENT_PHYSICS_VERSION,
      rulesetVersion: CURRENT_RULESET_VERSION,
      balanceVersionId: cfg.version_id,
      weatherKey: 'clear_dry',
      assistPreset: snap.assistPreset,
      transmissionMode: snap.transmissionMode,
    };
  }

  private getBuildVersionMeta(): ICarBuildVersionMeta {
    const compiled = this.ctx!.getCompiledVehicle();
    const cfg = this.ctx!.getBalanceConfig();
    const rawBuild = compiled.build as typeof compiled.build & {
      buildSchemaVersion?: number;
      buildRevision?: number;
    };
    return {
      buildId: compiled.build.id,
      chassisId: compiled.build.chassisId,
      buildSchemaVersion: normalizeBuildSchemaVersion(rawBuild.buildSchemaVersion),
      buildRevision: typeof rawBuild.buildRevision === 'number' ? rawBuild.buildRevision : 1,
      balanceVersionId: cfg.version_id,
    };
  }

  private buildCurrentStartCheckpoint(snap: IVehicleStateSnapshot): ISimulationCheckpoint {
    return {
      tick: snap.tick,
      prngSeed: 0x4d4f4455, // 'MODU' deterministic default seed
      sessionMode: this.sessionMode,
      track: this.getTrackVersionMeta(),
      ruleset: this.getRulesetKey(),
      vehicles: [
        {
          vehicleId: snap.vehicleId,
          slotIndex: snap.slotIndex,
          controllerKind: snap.controllerKind,
          buildMeta: this.getBuildVersionMeta(),
          position: { ...snap.position },
          rotation: { ...snap.rotation },
          linearVelocityWorld: { ...snap.linearVelocityWorld },
          angularVelocityWorld: { ...snap.angularVelocityWorld },
          fuelLiters: snap.fuelLiters,
          engineTempC: snap.engineTempC,
          tireTempsC: [
            snap.wheels[0].tireTempC,
            snap.wheels[1].tireTempC,
            snap.wheels[2].tireTempC,
            snap.wheels[3].tireTempC,
          ],
          tireWear: [
            snap.wheels[0].tireWear,
            snap.wheels[1].tireWear,
            snap.wheels[2].tireWear,
            snap.wheels[3].tireWear,
          ],
          brakeTempsC: [
            snap.wheels[0].brakeTempC,
            snap.wheels[1].brakeTempC,
            snap.wheels[2].brakeTempC,
            snap.wheels[3].brakeTempC,
          ],
          damageZones: [...snap.damageZones] as typeof snap.damageZones,
          lapNumber: snap.lapNumber,
          sectorIndex: snap.sectorIndex,
          checkpointMask: snap.checkpointMask,
          lapValid: snap.lapValid,
        },
      ],
    };
  }

  private rebuildGhostMesh(compiled: ICompiledVehicle): void {
    if (!this.ctx) return;
    if (this.ghostRig) {
      this.ctx.scene.remove(this.ghostRig.root);
      this.ghostRig.dispose();
      this.ghostRig = null;
    }
    this.ghostRig = buildGhostCarMesh(compiled);
    this.ctx.scene.add(this.ghostRig.root);
  }

  private hideGhostMesh(): void {
    if (this.ghostRig) {
      this.ghostRig.root.visible = false;
    }
  }

  private publishHud(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastHudPublishMs < HUD_PUBLISH_INTERVAL_MS) return;
    this.lastHudPublishMs = now;

    const loaded = this.player.getLoadedBundle();
    const isTrack = this.ctx?.getVisualMode() === 'track';
    const nextState: IGhostHudState = {
      sessionMode: this.sessionMode,
      active: Boolean(isTrack && this.sessionMode === 'time_trial'),
      ghostVisible: this.ghostVisible,
      hasGhost: Boolean(loaded),
      ghostSource: loaded ? this.ghostSource : null,
      ghostDriverName: loaded?.header.driverDisplayName ?? null,
      ghostBestLapMs: loaded?.header.lapTimeMs ?? null,
      liveDeltaMs: this.lastLiveDeltaMs,
      ghostFinished: Boolean(this.lastPose?.finished),
      isRecording: this.recorder.isRecording(),
      recordedTicks: this.recorder.getRecordedTickCount(),
      pbImproved: this.lastPbImproved,
      lastPbImproved: this.lastPbImproved,
      lastRecordedReplayId: this.lastRecordedReplayId,
    };

    publishGhostHudState(nextState);

    if (this.ctx) {
      (
        this.ctx.events as unknown as {
          emit: (event: string, payload: IGhostHudState) => void;
        }
      ).emit('ghost:state', nextState);
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('ghost:state', { detail: nextState }));
    }
  }
}

export const ghostRendererPlugin: IModulusPlugin = new GhostRendererController();

export {
  getGhostHudState,
  getSharedGhostStorage,
  setActiveFriendGhost,
  setGhostSessionMode,
  setGhostVisible,
  subscribeGhostHudState,
  type IGhostHudState,
} from './ghostBridge';
