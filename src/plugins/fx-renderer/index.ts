import * as THREE from 'three';
import type {
  CameraPreset,
  IEngineContext,
  IModulusPlugin,
  IVehicleRuntimeState,
} from '../../core/types';
import {
  getCameraPresetSafe,
  getCockpitAnchors,
  readVehicleSnapshot,
} from '../../ui/engineBridge';
import { getPlayerSettings, type MotionPreset } from '../../ui/settingsStore';
import { buildSurfaceFxRig, type ISurfaceFxRig } from './particlesAndSkids';
import { buildDualEnvironmentRig, type IDualEnvironmentRig } from './studioAndSky';

class FxRendererController implements IModulusPlugin {
  public readonly id = 'fx-renderer';
  public readonly version = '1.0.0';
  public readonly priority = 90;

  private ctx: IEngineContext | null = null;
  private envRig: IDualEnvironmentRig | null = null;
  private surfaceFx: ISurfaceFxRig | null = null;
  private unsubs: Array<() => void> = [];

  // Interactive Damped Orbit Camera State
  private orbitYaw = 0.72;
  private orbitPitch = 0.27;
  private orbitDist = 5.4;
  private targetOrbitYaw = 0.72;
  private targetOrbitPitch = 0.27;
  private targetOrbitDist = 5.4;
  private lastInteractMs = 0;

  // Pointer & Pinch Tracking
  private activePointers = new Map<number, { x: number; y: number }>();
  private prevPinchDist: number | null = null;

  // Chase & Cockpit Camera State
  private chaseCamPos = new THREE.Vector3(0, 2.5, -6.5);
  private chaseLookAt = new THREE.Vector3(0, 0.8, 2);
  private smoothedFov = 64;
  private chaseInitialized = false;
  private lastRenderMs = 0;

  // Cockpit Dynamic Motion & Impact Shake State
  private motionPreset: MotionPreset = getPlayerSettings().motionPreset;
  private smoothedLookApexX = 0;
  private smoothedLongHeadZ = 0;
  private smoothedLatHeadX = 0;
  private impactShakeAmp = 0;
  private impactShakeTime = 0;
  private lastImpactSeq = -1;
  private lastForwardGear = 0;
  private shiftKick = 0;
  private shiftAge = 0;

  // Reusable scratch math objects
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly interpPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly currQuat = new THREE.Quaternion();
  private readonly interpQuat = new THREE.Quaternion();
  private readonly forwardVec = new THREE.Vector3();
  private readonly upVec = new THREE.Vector3();
  private readonly rightVec = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly localOffset = new THREE.Vector3();

  // Bound event listeners
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundWheel: (e: WheelEvent) => void;
  private boundSettingsChanged: () => void;

  constructor() {
    this.boundPointerDown = (e) => this.onPointerDown(e);
    this.boundPointerMove = (e) => this.onPointerMove(e);
    this.boundPointerUp = (e) => this.onPointerUp(e);
    this.boundWheel = (e) => this.onWheel(e);
    this.boundSettingsChanged = () => {
      this.motionPreset = getPlayerSettings().motionPreset;
    };
  }

  public init(ctx: IEngineContext): void {
    this.ctx = ctx;
    this.lastRenderMs = performance.now();
    this.lastInteractMs = this.lastRenderMs;

    this.envRig = buildDualEnvironmentRig(ctx.scene, ctx.getActiveTrack());
    this.surfaceFx = buildSurfaceFxRig(ctx.scene);
    this.applyVisualMode();

    const canvas = ctx.canvas;
    if (canvas) {
      canvas.addEventListener('pointerdown', this.boundPointerDown, { passive: true });
      window.addEventListener('pointermove', this.boundPointerMove, { passive: true });
      window.addEventListener('pointerup', this.boundPointerUp, { passive: true });
      window.addEventListener('pointercancel', this.boundPointerUp, { passive: true });
      canvas.addEventListener('wheel', this.boundWheel, { passive: false });
    }
    window.addEventListener('modulus:settings-changed', this.boundSettingsChanged);

    this.unsubs.push(
      ctx.events.on('mode:changed', () => {
        this.applyVisualMode();
        this.surfaceFx?.clear();
        this.chaseInitialized = false;
      }),
      ctx.events.on('track:selected', ({ schema }) => {
        if (this.envRig && this.ctx) {
          this.envRig.updateTrackTheme(schema, this.ctx.scene, this.ctx.getVisualMode());
          if (this.ctx.getVisualMode() === 'track') {
            this.ctx.camera.far = this.envRig.getRecommendedCameraFar(schema);
            this.ctx.camera.updateProjectionMatrix();
          }
        }
        this.surfaceFx?.clear();
        this.chaseInitialized = false;
      }),
      ctx.events.on('vehicle:reset', () => {
        this.surfaceFx?.clear();
        this.chaseInitialized = false;
        this.lastForwardGear = 0;
        this.shiftKick = 0;
      }),
      ctx.events.on('camera:preset', ({ preset }) => {
        this.onCameraPresetChanged(preset);
      })
    );
  }

  private isOrbitInteractive(): boolean {
    if (!this.ctx) return false;
    return this.ctx.getVisualMode() === 'lab' || this.ctx.getCameraPreset() === 'orbit';
  }

  private onCameraPresetChanged(preset: CameraPreset): void {
    if (preset === 'chase') {
      this.chaseInitialized = false;
    } else if (preset === 'orbit') {
      this.targetOrbitDist = 6.2;
      this.targetOrbitPitch = 0.34;
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.isOrbitInteractive()) return;
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.lastInteractMs = performance.now();
    if (this.activePointers.size === 2) {
      this.prevPinchDist = this.getTwoPointerDistance();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.activePointers.has(e.pointerId)) return;
    const prev = this.activePointers.get(e.pointerId)!;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    this.lastInteractMs = performance.now();

    if (!this.isOrbitInteractive()) return;

    if (this.activePointers.size === 1) {
      this.targetOrbitYaw -= dx * 0.0068;
      this.targetOrbitPitch = Math.max(0.08, Math.min(1.36, this.targetOrbitPitch + dy * 0.0058));
    } else if (this.activePointers.size === 2) {
      const dist = this.getTwoPointerDistance();
      if (this.prevPinchDist !== null && dist > 0) {
        const delta = this.prevPinchDist - dist;
        this.targetOrbitDist = Math.max(3.1, Math.min(12.5, this.targetOrbitDist + delta * 0.015));
      }
      this.prevPinchDist = dist;
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.prevPinchDist = null;
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.isOrbitInteractive()) return;
    e.preventDefault();
    this.lastInteractMs = performance.now();
    this.targetOrbitDist = Math.max(
      3.1,
      Math.min(12.5, this.targetOrbitDist + e.deltaY * 0.0038)
    );
  }

  private getTwoPointerDistance(): number {
    const pts = Array.from(this.activePointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private applyVisualMode(): void {
    if (!this.ctx || !this.envRig) return;
    const mode = this.ctx.getVisualMode();
    this.envRig.setMode(mode, this.ctx.scene, this.ctx.getActiveTrack());
    if (this.surfaceFx) {
      this.surfaceFx.group.visible = mode === 'track';
    }
    if (mode === 'lab') {
      this.lastForwardGear = 0;
      this.shiftKick = 0;
      this.targetOrbitDist = 5.4;
      this.targetOrbitPitch = 0.27;
      this.smoothedFov = 46;
      this.ctx.camera.fov = 46;
      this.ctx.camera.far = 2400;
      this.ctx.camera.updateProjectionMatrix();
    } else {
      this.smoothedFov = 58;
      this.ctx.camera.fov = 58;
      this.ctx.camera.far = this.envRig.getRecommendedCameraFar(this.ctx.getActiveTrack());
      this.ctx.camera.updateProjectionMatrix();
    }
  }

  public onRender(alpha: number, state: IVehicleRuntimeState): void {
    if (!this.ctx || !this.envRig) return;

    const nowMs = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - this.lastRenderMs) / 1000));
    this.lastRenderMs = nowMs;

    const mode = this.ctx.getVisualMode();
    const cam = this.ctx.camera;
    const damp = 1 - Math.exp(-dt * 9.5);

    if (mode === 'lab') {
      // Gentle showcase auto-turntable drift when user is idle
      if (this.activePointers.size === 0 && nowMs - this.lastInteractMs > 3800) {
        this.targetOrbitYaw += dt * 0.11;
      }

      this.orbitYaw += (this.targetOrbitYaw - this.orbitYaw) * damp;
      this.orbitPitch += (this.targetOrbitPitch - this.orbitPitch) * damp;
      this.orbitDist += (this.targetOrbitDist - this.orbitDist) * damp;

      const cosP = Math.cos(this.orbitPitch);
      const focusY = 0.56;
      cam.position.set(
        Math.sin(this.orbitYaw) * cosP * this.orbitDist,
        focusY + Math.sin(this.orbitPitch) * this.orbitDist,
        Math.cos(this.orbitYaw) * cosP * this.orbitDist
      );
      cam.up.set(0, 1, 0);
      cam.lookAt(0, focusY, 0);

      // Smooth Lab studio FOV (46 deg for flattering low-distortion hero proportion)
      if (Math.abs(cam.fov - 46) > 0.05) {
        cam.fov += (46 - cam.fov) * damp;
        cam.updateProjectionMatrix();
      }
      return;
    }

    // === TRACK MODE ===
    this.prevPos.set(state.prevPosition.x, state.prevPosition.y, state.prevPosition.z);
    this.currPos.set(state.position.x, state.position.y, state.position.z);
    this.interpPos.lerpVectors(this.prevPos, this.currPos, alpha);

    this.prevQuat.set(
      state.prevRotation.x,
      state.prevRotation.y,
      state.prevRotation.z,
      state.prevRotation.w
    );
    this.currQuat.set(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w);
    this.interpQuat.slerpQuaternions(this.prevQuat, this.currQuat, alpha);

    // Local basis: +Z forward, +Y up, -X right (+X left)
    this.forwardVec.set(0, 0, 1).applyQuaternion(this.interpQuat).normalize();
    this.upVec.set(0, 1, 0).applyQuaternion(this.interpQuat).normalize();
    this.rightVec.set(-1, 0, 0).applyQuaternion(this.interpQuat).normalize();

    const preset = getCameraPresetSafe(this.ctx);
    const snap = readVehicleSnapshot(this.ctx);
    const anchors = getCockpitAnchors(this.ctx.getCompiledVehicle());
    const motionScale =
      this.motionPreset === 'reduced' ? 0 : this.motionPreset === 'dynamic' ? 1.45 : 0.85;

    // Track impact camera shake trigger
    if (snap.lastImpact && snap.lastImpact.seq !== this.lastImpactSeq) {
      this.lastImpactSeq = snap.lastImpact.seq;
      this.impactShakeAmp = Math.min(0.06, snap.lastImpact.intensity01 * 0.045) * motionScale;
      this.impactShakeTime = 0;
    }
    if (this.impactShakeAmp > 0.0004) {
      this.impactShakeTime += dt;
      this.impactShakeAmp *= Math.exp(-dt * 12.0);
    } else {
      this.impactShakeAmp = 0;
    }

    if (preset === 'cockpit') {
      const eye = anchors.cockpitEyeLocal;
      const headDamp = 1 - Math.exp(-dt * 8.5);
      // Subtle braking head-nod & cornering head shift, strictly clamped so wheel/dash never block road
      const targetLongHead = Math.max(-0.045, Math.min(0.04, -snap.longitudinalG * 0.022)) * motionScale;
      const targetLatHead = Math.max(-0.04, Math.min(0.04, snap.lateralG * 0.018)) * motionScale;
      const targetLookApex =
        Math.max(-2.6, Math.min(2.6, snap.commandedSteer * 1.55 + snap.bodySlipAngleRad * 2.2)) *
        motionScale;

      this.smoothedLongHeadZ += (targetLongHead - this.smoothedLongHeadZ) * headDamp;
      this.smoothedLatHeadX += (targetLatHead - this.smoothedLatHeadX) * headDamp;
      this.smoothedLookApexX += (targetLookApex - this.smoothedLookApexX) * headDamp;

      const shakeX = Math.sin(this.impactShakeTime * 68) * this.impactShakeAmp;
      const shakeY = Math.cos(this.impactShakeTime * 82) * this.impactShakeAmp * 0.7;

      // Local (+X Left, +Y Up, +Z Forward) transformed directly by interpolated chassis quaternion
      this.localOffset
        .set(eye.x + this.smoothedLatHeadX + shakeX, eye.y + shakeY, eye.z + this.smoothedLongHeadZ)
        .applyQuaternion(this.interpQuat)
        .add(this.interpPos);
      cam.position.copy(this.localOffset);

      // Look down the road with subtle look-into-apex cue and gentle downward sightline over hood
      this.desiredLook
        .set(eye.x + this.smoothedLookApexX, eye.y - 0.16, eye.z + 24.0)
        .applyQuaternion(this.interpQuat)
        .add(this.interpPos);

      // Horizon-stabilized up vector (100% locked in Reduced motion; subtle chassis banking in Standard/Dynamic)
      const horizonLock = this.motionPreset === 'reduced' ? 0.85 : 0.55;
      cam.up.copy(this.upVec).lerp(THREE.Object3D.DEFAULT_UP, horizonLock).normalize();
      cam.lookAt(this.desiredLook);

      const speedNorm = Math.min(1, snap.speedMs / 55);
      const fovGain = this.motionPreset === 'reduced' ? 2.5 : this.motionPreset === 'dynamic' ? 10 : 6;
      const targetFov = 64 + speedNorm * fovGain;
      this.smoothedFov += (targetFov - this.smoothedFov) * damp;
      cam.fov = this.smoothedFov;
      cam.updateProjectionMatrix();
    } else if (preset === 'hood') {
      // Crisp motorsport bonnet-cockpit POV
      const hood = anchors.hoodCamLocal;
      this.localOffset
        .set(hood.x, hood.y, hood.z)
        .applyQuaternion(this.interpQuat)
        .add(this.interpPos);
      this.desiredLook
        .set(hood.x + snap.commandedSteer * 0.9 * motionScale, hood.y - 0.22, hood.z + 20.0)
        .applyQuaternion(this.interpQuat)
        .add(this.interpPos);

      cam.position.copy(this.localOffset);
      cam.up.copy(this.upVec).lerp(THREE.Object3D.DEFAULT_UP, 0.55).normalize();
      cam.lookAt(this.desiredLook);

      const speedNorm = Math.min(1, snap.speedMs / 65);
      const targetFov = 62 + speedNorm * (3 + 7 * motionScale);
      this.smoothedFov += (targetFov - this.smoothedFov) * damp;
      cam.fov = this.smoothedFov;
      cam.updateProjectionMatrix();
    } else if (preset === 'orbit') {
      this.orbitYaw += (this.targetOrbitYaw - this.orbitYaw) * damp;
      this.orbitPitch += (this.targetOrbitPitch - this.orbitPitch) * damp;
      this.orbitDist += (this.targetOrbitDist - this.orbitDist) * damp;

      const cosP = Math.cos(this.orbitPitch);
      cam.position.set(
        this.interpPos.x + Math.sin(this.orbitYaw) * cosP * this.orbitDist,
        this.interpPos.y + 0.75 + Math.sin(this.orbitPitch) * this.orbitDist,
        this.interpPos.z + Math.cos(this.orbitYaw) * cosP * this.orbitDist
      );
      cam.up.set(0, 1, 0);
      cam.lookAt(this.interpPos.x, this.interpPos.y + 0.65, this.interpPos.z);

      this.smoothedFov += (56 - this.smoothedFov) * damp;
      cam.fov = this.smoothedFov;
      cam.updateProjectionMatrix();
    } else {
      // Dynamic Chase Camera with speed-based FOV & motion-scaled G-force swing/lean
      const speedNorm = Math.min(1, state.speedKph / 260);
      const longPull = Math.max(-0.45, Math.min(0.65, state.longitudinalG * 0.35)) * motionScale;
      const latSwing = Math.max(-0.85, Math.min(0.85, state.lateralG * 0.42)) * motionScale;

      const followDist = 5.9 + speedNorm * 0.75 + longPull;
      const followHeight = 2.28 + speedNorm * 0.22;

      // Flatten forward direction gently so crests & banking feel smooth
      const flatFwdX = this.forwardVec.x;
      const flatFwdY = this.forwardVec.y * 0.35;
      const flatFwdZ = this.forwardVec.z;
      const flatLen = Math.hypot(flatFwdX, flatFwdY, flatFwdZ) || 1;

      this.desiredPos.set(
        this.interpPos.x - (flatFwdX / flatLen) * followDist + this.rightVec.x * latSwing,
        this.interpPos.y - (flatFwdY / flatLen) * followDist + followHeight,
        this.interpPos.z - (flatFwdZ / flatLen) * followDist + this.rightVec.z * latSwing
      );
      this.desiredLook.set(
        this.interpPos.x + this.forwardVec.x * 4.2,
        this.interpPos.y + 0.92 + this.forwardVec.y * 1.4,
        this.interpPos.z + this.forwardVec.z * 4.2
      );

      if (!this.chaseInitialized) {
        this.chaseCamPos.copy(this.desiredPos);
        this.chaseLookAt.copy(this.desiredLook);
        this.chaseInitialized = true;
      } else {
        const posAlpha = 1 - Math.exp(-dt * 11.5);
        const lookAlpha = 1 - Math.exp(-dt * 16.0);
        this.chaseCamPos.lerp(this.desiredPos, posAlpha);
        this.chaseLookAt.lerp(this.desiredLook, lookAlpha);
      }

      cam.position.copy(this.chaseCamPos);
      // Subtle horizon roll into lateral cornering G (zero in reduced motion)
      const rollLean = Math.max(-0.045, Math.min(0.045, state.lateralG * 0.022)) * motionScale;
      cam.up.set(
        this.rightVec.x * rollLean,
        1.0,
        this.rightVec.z * rollLean
      ).normalize();
      cam.lookAt(this.chaseLookAt);

      const targetFov = 58 + speedNorm * (4 + 10 * motionScale);
      this.smoothedFov += (targetFov - this.smoothedFov) * (1 - Math.exp(-dt * 6.0));
      cam.fov = this.smoothedFov;
      cam.updateProjectionMatrix();
    }

    if (snap.gear > 0 && this.lastForwardGear > 0 && snap.gear !== this.lastForwardGear) {
      this.shiftKick = Math.sign(snap.gear - this.lastForwardGear);
      this.shiftAge = 0;
    }
    this.lastForwardGear = Math.max(0, snap.gear);
    if (this.shiftKick !== 0) {
      this.shiftAge += dt;
      const age = Math.min(1, this.shiftAge / 0.19);
      const kick = this.shiftKick * Math.sin(age * Math.PI * 2.25) * (1 - age) ** 2 * motionScale;
      cam.translateZ(kick * 0.055);
      cam.translateY(Math.abs(kick) * 0.016);
      cam.rotateX(kick * 0.018);
      if (age === 1) this.shiftKick = 0;
    }

    // Update car-following directional sun shadow frustum & camera-centered sky dome
    this.envRig.updateTrackFollow(this.interpPos, cam.position);

    // Update skidmark ribbons, tire smoke puffs, and exhaust backfire flashes
    this.surfaceFx?.update(
      dt,
      state,
      this.ctx.getInputState(),
      this.ctx.getCompiledVehicle(),
      this.interpPos,
      this.interpQuat
    );
  }

  public dispose(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];

    const canvas = this.ctx?.canvas;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.boundPointerDown);
      canvas.removeEventListener('wheel', this.boundWheel);
    }
    window.removeEventListener('pointermove', this.boundPointerMove);
    window.removeEventListener('pointerup', this.boundPointerUp);
    window.removeEventListener('pointercancel', this.boundPointerUp);
    window.removeEventListener('modulus:settings-changed', this.boundSettingsChanged);

    if (this.ctx) {
      this.envRig?.dispose(this.ctx.scene);
      this.surfaceFx?.dispose(this.ctx.scene);
    }
    this.envRig = null;
    this.surfaceFx = null;
    this.ctx = null;
  }
}

export const fxRendererPlugin: IModulusPlugin = new FxRendererController();
