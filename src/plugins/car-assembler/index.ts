import * as THREE from 'three';
import type {
  ICompiledVehicle,
  IEngineContext,
  ILabOverlayOptions,
  IModulusPlugin,
  IVehicleRuntimeState,
  PartModuleCategory,
} from '../../core/types';
import { getCameraPresetSafe, readVehicleSnapshot } from '../../ui/engineBridge';
import { buildAssembledCar, type IAssembledCarRig } from './buildCarGeometry';
import { buildLabOverlays, type ILabOverlaysRig } from './buildLabOverlays';

const HIGHLIGHT_COLOR = new THREE.Color('#00F0FF');
const BRAKE_GLOW_COLOR = new THREE.Color('#FF4500');
const BRAKE_HOT_COLOR = new THREE.Color('#FFB020');

class CarAssemblerController implements IModulusPlugin {
  public readonly id = 'car-assembler';
  public readonly version = '1.0.0';
  public readonly priority = 80;

  private ctx: IEngineContext | null = null;
  private compiled: ICompiledVehicle | null = null;
  private carRig: IAssembledCarRig | null = null;
  private overlaysRig: ILabOverlaysRig | null = null;
  private unsubs: Array<() => void> = [];

  // Reusable scratch objects (zero per-frame GC allocation)
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly interpPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly currQuat = new THREE.Quaternion();
  private readonly interpQuat = new THREE.Quaternion();
  private readonly invCarQuat = new THREE.Quaternion();
  private readonly wheelWorldPrev = new THREE.Vector3();
  private readonly wheelWorldCurr = new THREE.Vector3();
  private readonly wheelLocal = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  private elapsedSec = 0;
  private lastRenderMs = 0;

  public init(ctx: IEngineContext): void {
    this.ctx = ctx;
    this.lastRenderMs = performance.now();
    this.rebuildVehicle(ctx.getCompiledVehicle());

    this.unsubs.push(
      ctx.events.on('lab:overlay-toggled', () => {
        this.syncLabOverlays();
      }),
      ctx.events.on('lab:highlight-module', () => {
        this.syncLabOverlays();
      }),
      ctx.events.on('mode:changed', () => {
        this.syncLabOverlays();
      })
    );
  }

  public onBuildCompiled(vehicle: ICompiledVehicle): void {
    this.rebuildVehicle(vehicle);
  }

  private rebuildVehicle(vehicle: ICompiledVehicle): void {
    if (!this.ctx) return;
    this.compiled = vehicle;

    if (this.overlaysRig && this.carRig) {
      this.carRig.root.remove(this.overlaysRig.group);
      this.overlaysRig.dispose();
      this.overlaysRig = null;
    }
    if (this.carRig) {
      this.ctx.scene.remove(this.carRig.root);
      this.carRig.dispose();
      this.carRig = null;
    }

    this.carRig = buildAssembledCar(vehicle);
    this.overlaysRig = buildLabOverlays(vehicle);
    this.carRig.root.add(this.overlaysRig.group);
    this.ctx.scene.add(this.carRig.root);

    this.syncLabOverlays();
  }

  private syncLabOverlays(): void {
    if (!this.ctx || !this.carRig || !this.overlaysRig) return;
    const isLab = this.ctx.getVisualMode() === 'lab';
    const opts: ILabOverlayOptions = this.ctx.getLabOverlayOptions();

    this.overlaysRig.group.visible = isLab;
    this.overlaysRig.applyOptions(opts);

    // X-Ray Wireframe mode on primary body shell panels (Lab mode only)
    const xrayActive = isLab && opts.wireframe;
    this.carRig.xrayLinesGroup.visible = xrayActive;
    for (const mat of this.carRig.bodyShellMaterials) {
      mat.transparent = xrayActive;
      mat.opacity = xrayActive ? 0.22 : 1.0;
      mat.depthWrite = !xrayActive;
      mat.needsUpdate = true;
    }
  }

  public onRender(alpha: number, state: IVehicleRuntimeState): void {
    if (!this.ctx || !this.carRig || !this.compiled) return;

    const nowMs = performance.now();
    const dt = Math.min(0.05, Math.max(0, (nowMs - this.lastRenderMs) / 1000));
    this.lastRenderMs = nowMs;
    this.elapsedSec += dt;

    const mode = this.ctx.getVisualMode();
    const rig = this.carRig;
    const compiled = this.compiled;

    if (mode === 'lab') {
      // Ensure exterior canopy, roof & seat are visible in Garage / Lab showcase
      rig.cabinMesh.visible = true;
      rig.roofMesh.visible = true;
      rig.seatMesh.visible = true;
      rig.cockpitRig.steeringWheelPivot.rotation.z = 0;
      for (const ledMat of rig.cockpitRig.shiftLedMaterials) {
        ledMat.emissiveIntensity = 0;
      }
      rig.cockpitRig.lockupLedMaterial.emissiveIntensity = 0;

      // Park cleanly at studio pedestal (0, 0, 0) resting tires on floor y = 0
      rig.root.position.set(0, 0, 0);
      rig.root.quaternion.identity();

      // Reflect Ride Height slider adjustments visually in real time!
      const avgRideMm =
        (compiled.build.suspension.rideHeightFrontMm + compiled.build.suspension.rideHeightRearMm) * 0.5;
      const rideDeltaM = (avgRideMm - 75) / 1000;
      const rakeAngleRad =
        ((compiled.build.suspension.rideHeightRearMm - compiled.build.suspension.rideHeightFrontMm) /
          1000) /
        Math.max(1.5, compiled.wheelbaseM);

      rig.bodyGroup.position.set(0, rideDeltaM, 0);
      rig.bodyGroup.rotation.set(rakeAngleRad, 0, 0);

      // Rest all 4 wheels cleanly on y = 0 with static camber & toe
      const camberF = (compiled.build.suspension.camberFrontDeg * Math.PI) / 180;
      const camberR = (compiled.build.suspension.camberRearDeg * Math.PI) / 180;
      const toeF = (compiled.build.suspension.toeFrontDeg * Math.PI) / 180;
      const toeR = (compiled.build.suspension.toeRearDeg * Math.PI) / 180;

      for (let i = 0; i < 4; i++) {
        const wRig = rig.wheels[i];
        const wp = compiled.wheelPositionsLocal[i];
        const isFront = i < 2;
        const camber = isFront ? camberF : camberR;
        const toe = isFront ? toeF : toeR;

        wRig.suspensionGroup.position.set(wp.x, wRig.radiusM, wp.z);
        // Toe-in (+): front of wheel tilts inward -> Left wheel (+X) rotates negative around Y; Right wheel rotates positive
        wRig.knuckleGroup.rotation.set(0, wRig.isLeft ? -toe : toe, wRig.isLeft ? -camber : camber);
        wRig.spinGroup.rotation.set(0, 0, 0);
        wRig.rotorMaterial.emissiveIntensity = 0;
      }

      // Subtle Lab brake glow off, warm idle taillights
      rig.taillightMaterial.emissiveIntensity = 0.85;

      // Update Lab overlays + subsystem highlight pulse
      const opts = this.ctx.getLabOverlayOptions();
      this.overlaysRig?.updateAnimation(this.elapsedSec, opts.highlightedModule);
      this.applyModuleHighlight(opts.highlightedModule);
      return;
    }

    // === TRACK MODE ===
    this.applyModuleHighlight(null);
    rig.bodyGroup.position.set(0, 0, 0);
    rig.bodyGroup.rotation.set(0, 0, 0);

    // 1. Interpolate chassis transform (prev -> curr by alpha)
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

    rig.root.position.copy(this.interpPos);
    rig.root.quaternion.copy(this.interpQuat);
    this.invCarQuat.copy(this.interpQuat).invert();

    // 2. Articulate all 4 wheels (suspension compression, steer, camber, spin, brake rotor thermal glow)
    let totalBrakeTorque = 0;
    for (let i = 0; i < 4; i++) {
      const wState = state.wheels[i];
      const wRig = rig.wheels[i];
      const wp = compiled.wheelPositionsLocal[i];
      totalBrakeTorque += wState.brakeTorqueNm;

      // Compute wheel hub local Y from interpolated worldPosition (exact Rapier raycast match)
      this.wheelWorldPrev.set(
        wState.prevWorldPosition.x,
        wState.prevWorldPosition.y,
        wState.prevWorldPosition.z
      );
      this.wheelWorldCurr.set(
        wState.worldPosition.x,
        wState.worldPosition.y,
        wState.worldPosition.z
      );
      this.wheelLocal
        .lerpVectors(this.wheelWorldPrev, this.wheelWorldCurr, alpha)
        .sub(this.interpPos)
        .applyQuaternion(this.invCarQuat);

      // Guard against initial frame-0 uninitialized dummy worldPosition (0, 0.32, 0)
      const dx = this.wheelLocal.x - wp.x;
      const dz = this.wheelLocal.z - wp.z;
      let localHubY = wRig.radiusM + Math.max(-0.12, Math.min(0.14, wState.compressionM - 0.05));
      if (dx * dx + dz * dz < 1.2) {
        localHubY = Math.max(wRig.radiusM - 0.16, Math.min(wRig.radiusM + 0.18, this.wheelLocal.y));
      }

      wRig.suspensionGroup.position.set(wp.x, localHubY, wp.z);

      // Steer (+Y = left) & Camber (negative = top inward)
      const rotZ = wRig.isLeft ? -wState.camberAngleRad : wState.camberAngleRad;
      wRig.knuckleGroup.rotation.set(0, wState.steerAngleRad, rotZ);

      // Spin (+X = forward roll)
      wRig.spinGroup.rotation.set(wState.rotationAngleRad, 0, 0);

      // Glowing brake rotor disc when brakeTempC > 380°C!
      if (wState.brakeTempC > 380) {
        const heatT = Math.min(1, (wState.brakeTempC - 380) / 450);
        this.tmpColor.copy(BRAKE_GLOW_COLOR).lerp(BRAKE_HOT_COLOR, heatT * 0.65);
        wRig.rotorMaterial.emissive.copy(this.tmpColor);
        wRig.rotorMaterial.emissiveIntensity = heatT * 3.2;
      } else {
        wRig.rotorMaterial.emissiveIntensity = 0;
      }
    }

    // 3. Brake-reactive Taillights & Live Cockpit Instruments / Steering Wheel
    const input = this.ctx.getInputState();
    const isBraking = input.brake > 0.05 || totalBrakeTorque > 80;
    rig.taillightMaterial.emissiveIntensity = isBraking ? 3.4 : 0.75;

    const isCockpitCam = getCameraPresetSafe(this.ctx) === 'cockpit';
    rig.cabinMesh.visible = !isCockpitCam;
    rig.roofMesh.visible = !isCockpitCam;
    rig.seatMesh.visible = !isCockpitCam;

    const snap = readVehicleSnapshot(this.ctx);
    // Vehicle local +X is Left, +Z is Forward: turning Left (+steer) rotates top of wheel toward +X (-Z rotation)
    const wheelVisualAngle = Math.max(
      -2.7,
      Math.min(2.7, snap.commandedSteer * 2.1 + snap.frontWheelAngleRad * 1.4)
    );
    rig.cockpitRig.steeringWheelPivot.rotation.z = -wheelVisualAngle;

    // Live 10-LED RPM / Shift-Light bar (lights progressively from 55% to 97% redline)
    const rpmFrac = Math.max(0, Math.min(1, snap.engineRpm / Math.max(1000, snap.redlineRpm)));
    const shiftFlash = rpmFrac >= 0.93 ? (Math.sin(this.elapsedSec * 36) > 0 ? 2.6 : 0.3) : null;
    for (let i = 0; i < rig.cockpitRig.shiftLedMaterials.length; i++) {
      const thresh = 0.54 + (i / 9) * 0.41;
      if (shiftFlash !== null) {
        rig.cockpitRig.shiftLedMaterials[i].emissiveIntensity = shiftFlash;
      } else {
        rig.cockpitRig.shiftLedMaterials[i].emissiveIntensity = rpmFrac >= thresh ? 1.8 : 0.0;
      }
    }

    // Lockup & grip-scrub dash warning LED
    let maxLockup = 0;
    let maxScrub = 0;
    for (let i = 0; i < 4; i++) {
      if (snap.wheels[i].lockupIntensity > maxLockup) maxLockup = snap.wheels[i].lockupIntensity;
      if (snap.wheels[i].scrubIntensity > maxScrub) maxScrub = snap.wheels[i].scrubIntensity;
    }
    if (maxLockup > 0.25) {
      rig.cockpitRig.lockupLedMaterial.emissive.set('#F43F5E');
      rig.cockpitRig.lockupLedMaterial.emissiveIntensity = 1.4 + maxLockup * 1.6;
    } else if (maxScrub > 0.45) {
      rig.cockpitRig.lockupLedMaterial.emissive.set('#F59E0B');
      rig.cockpitRig.lockupLedMaterial.emissiveIntensity = maxScrub * 1.4;
    } else {
      rig.cockpitRig.lockupLedMaterial.emissiveIntensity = 0;
    }
    rig.cockpitRig.dashGlowMaterial.emissiveIntensity = 0.42 + snap.engineLoad * 0.35;
  }

  private applyModuleHighlight(activeModule: PartModuleCategory | null): void {
    if (!this.carRig) return;
    const pulse = 0.28 + 0.32 * (0.5 + 0.5 * Math.sin(this.elapsedSec * 6.5));
    const cats = Object.keys(this.carRig.moduleMaterials) as PartModuleCategory[];
    for (const cat of cats) {
      const mats = this.carRig.moduleMaterials[cat];
      const isHighlighted = activeModule === cat;
      for (const mat of mats) {
        if (isHighlighted) {
          mat.emissive.copy(HIGHLIGHT_COLOR);
          mat.emissiveIntensity = pulse;
        } else {
          mat.emissive.setHex((mat.userData.baseEmissiveHex as number) ?? 0x000000);
          mat.emissiveIntensity = (mat.userData.baseEmissiveIntensity as number) ?? 0;
        }
      }
    }
  }

  public dispose(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];

    if (this.overlaysRig && this.carRig) {
      this.carRig.root.remove(this.overlaysRig.group);
      this.overlaysRig.dispose();
      this.overlaysRig = null;
    }
    if (this.carRig && this.ctx) {
      this.ctx.scene.remove(this.carRig.root);
      this.carRig.dispose();
      this.carRig = null;
    }
    this.compiled = null;
    this.ctx = null;
  }
}

export const carAssemblerPlugin: IModulusPlugin = new CarAssemblerController();
