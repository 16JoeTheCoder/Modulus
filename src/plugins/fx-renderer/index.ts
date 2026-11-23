import * as THREE from 'three';
import type {
  CameraPreset,
  IEngineContext,
  IModulusPlugin,
  IVehicleRuntimeState,
} from '../../core/types';
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

  // Chase Camera State
  private chaseCamPos = new THREE.Vector3(0, 2.5, -6.5);
  private chaseLookAt = new THREE.Vector3(0, 0.8, 2);
  private smoothedFov = 58;
  private chaseInitialized = false;
  private lastRenderMs = 0;

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

  // Bound event listeners
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundWheel: (e: WheelEvent) => void;

  constructor() {
    this.boundPointerDown = (e) => this.onPointerDown(e);
    this.boundPointerMove = (e) => this.onPointerMove(e);
    this.boundPointerUp = (e) => this.onPointerUp(e);
    this.boundWheel = (e) => this.onWheel(e);
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

    this.unsubs.push(
      ctx.events.on('mode:changed', () => {
        this.applyVisualMode();
        this.surfaceFx?.clear();
        this.chaseInitialized = false;
      }),
      ctx.events.on('track:selected', ({ schema }) => {
        if (this.envRig && this.ctx) {
          this.envRig.updateTrackTheme(schema, this.ctx.scene, this.ctx.getVisualMode());
        }
        this.surfaceFx?.clear();
        this.chaseInitialized = false;
      }),
      ctx.events.on('vehicle:reset', () => {
        this.surfaceFx?.clear();
        this.chaseInitialized = false;
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
      this.targetOrbitDist = 5.4;
      this.targetOrbitPitch = 0.27;
      this.smoothedFov = 46;
      this.ctx.camera.fov = 46;
      this.ctx.camera.updateProjectionMatrix();
    } else {
      this.smoothedFov = 58;
      this.ctx.camera.fov = 58;
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

    const preset = this.ctx.getCameraPreset();

    if (preset === 'hood') {
      // Crisp motorsport bonnet-cockpit POV
      this.desiredPos
        .copy(this.interpPos)
        .addScaledVector(this.forwardVec, 0.52)
        .addScaledVector(this.upVec, 1.18);
      this.desiredLook
        .copy(this.interpPos)
        .addScaledVector(this.forwardVec, 18.0)
        .addScaledVector(this.upVec, 0.92);

      cam.position.copy(this.desiredPos);
      cam.up.copy(this.upVec).lerp(THREE.Object3D.DEFAULT_UP, 0.45).normalize();
      cam.lookAt(this.desiredLook);

      const targetFov = 62 + Math.min(12, (state.speedKph / 260) * 12);
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
      // Dynamic Chase Camera with speed-based FOV & G-force lateral swing/lean
      const speedNorm = Math.min(1, state.speedKph / 260);
      const longPull = Math.max(-0.45, Math.min(0.65, state.longitudinalG * 0.35));
      const latSwing = Math.max(-0.85, Math.min(0.85, state.lateralG * 0.42));

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
      // Subtle horizon roll into lateral cornering G
      const rollLean = Math.max(-0.045, Math.min(0.045, state.lateralG * 0.022));
      cam.up.set(
        this.rightVec.x * rollLean,
        1.0,
        this.rightVec.z * rollLean
      ).normalize();
      cam.lookAt(this.chaseLookAt);

      const targetFov = 58 + speedNorm * 16;
      this.smoothedFov += (targetFov - this.smoothedFov) * (1 - Math.exp(-dt * 6.0));
      cam.fov = this.smoothedFov;
      cam.updateProjectionMatrix();
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
