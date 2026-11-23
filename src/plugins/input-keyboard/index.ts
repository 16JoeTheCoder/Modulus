import type {
  CameraPreset,
  IEngineContext,
  IInputState,
  IModulusPlugin,
  IVehicleRuntimeState,
} from '../../core/types';

const CAMERA_CYCLE: CameraPreset[] = ['chase', 'hood', 'orbit'];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/**
 * Speed-sensitive WASD + Arrow keys keyboard input controller with progressive steering,
 * high-speed authority taper above 80 km/h, and subtle counter-steer alignment assist.
 */
class InputKeyboardController {
  private ctx: IEngineContext | null = null;
  private heldKeys = new Set<string>();

  private currentThrottle = 0;
  private currentBrake = 0;
  private currentSteer = 0;
  private currentHandbrake = 0;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundBlur: () => void;

  constructor() {
    this.boundKeyDown = (e) => this.onKeyDown(e);
    this.boundKeyUp = (e) => this.onKeyUp(e);
    this.boundBlur = () => this.onBlur();
  }

  public init(ctx: IEngineContext): void {
    this.ctx = ctx;
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.boundKeyDown);
      window.addEventListener('keyup', this.boundKeyUp);
      window.addEventListener('blur', this.boundBlur);
    }
  }

  public dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.boundKeyDown);
      window.removeEventListener('keyup', this.boundKeyUp);
      window.removeEventListener('blur', this.boundBlur);
    }
    this.heldKeys.clear();
    this.ctx = null;
  }

  private onBlur(): void {
    this.heldKeys.clear();
    this.currentThrottle = 0;
    this.currentBrake = 0;
    this.currentSteer = 0;
    this.currentHandbrake = 0;
    this.ctx?.setHardwareInput('keyboard', {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: 0,
      clutch: 0,
      gearUp: false,
      gearDown: false,
      resetVehicle: false,
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.ctx) return;
    if (isEditableElement(e.target) || isEditableElement(document.activeElement)) {
      return;
    }

    const code = e.code;

    // Prevent browser scroll on driving keys while in track mode
    if (
      this.ctx.getVisualMode() === 'track' &&
      (code === 'Space' ||
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight')
    ) {
      e.preventDefault();
    }

    this.heldKeys.add(code);

    if (e.repeat) return;
    if (this.ctx.getVisualMode() !== 'track') return;

    if (code === 'KeyE' || code === 'ShiftLeft') {
      this.ctx.setHardwareInput('keyboard', { gearUp: true });
    } else if (code === 'KeyQ' || code === 'ControlLeft') {
      this.ctx.setHardwareInput('keyboard', { gearDown: true });
    } else if (code === 'KeyR') {
      this.ctx.setHardwareInput('keyboard', { resetVehicle: true });
    } else if (code === 'KeyC') {
      const current = this.ctx.getCameraPreset();
      const idx = CAMERA_CYCLE.indexOf(current);
      const next = CAMERA_CYCLE[(idx + 1) % CAMERA_CYCLE.length];
      this.ctx.setCameraPreset(next);
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.heldKeys.delete(e.code);
  }

  public step(dt: number, state: IVehicleRuntimeState, _input: IInputState): void {
    if (!this.ctx) return;
    if (this.ctx.getVisualMode() !== 'track') {
      this.currentThrottle = 0;
      this.currentBrake = 0;
      this.currentSteer = 0;
      this.currentHandbrake = 0;
      return;
    }

    const throttleTarget =
      this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp') ? 1 : 0;
    const brakeTarget =
      this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown') ? 1 : 0;
    const handbrakeTarget = this.heldKeys.has('Space') ? 1 : 0;

    const steerLeft = this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft') ? 1 : 0;
    const steerRight = this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight') ? 1 : 0;
    const rawSteerDir = steerLeft - steerRight; // +1 = Left, -1 = Right

    // Smooth pedal ramping so keyboard inputs don't shock tire slip
    const pedalRate = (target: number, current: number) => (target > current ? 9.5 : 15.0);
    this.currentThrottle = moveTowards(
      this.currentThrottle,
      throttleTarget,
      pedalRate(throttleTarget, this.currentThrottle) * dt
    );
    this.currentBrake = moveTowards(
      this.currentBrake,
      brakeTarget,
      pedalRate(brakeTarget, this.currentBrake) * dt
    );
    this.currentHandbrake = moveTowards(
      this.currentHandbrake,
      handbrakeTarget,
      14.0 * dt
    );

    // Speed-dependent steering authority taper above 80 km/h
    const speedKph = Math.max(0, state.speedKph);
    const speedTaper =
      speedKph <= 80
        ? 1.0
        : clamp(1.0 - ((speedKph - 80) / 220) * 0.62, 0.34, 1.0);

    const targetSteer = rawSteerDir * speedTaper;

    // Progressive steering rate: faster recentering than turn-in
    const isReturning = rawSteerDir === 0 || Math.sign(targetSteer) !== Math.sign(this.currentSteer);
    const steerRate = isReturning
      ? 7.8
      : clamp(4.6 - (speedKph / 260) * 1.6, 2.6, 4.6);

    this.currentSteer = moveTowards(this.currentSteer, targetSteer, steerRate * dt);

    // Subtle counter-steer alignment assist from body lateral velocity / rear slip
    let counterSteer = 0;
    const fwd = state.forwardWorld;
    const right = state.rightWorld;
    const vel = state.linearVelocityWorld;
    const vForward = vel.x * fwd.x + vel.y * fwd.y + vel.z * fwd.z;
    const vRight = vel.x * right.x + vel.y * right.y + vel.z * right.z;

    if (vForward > 7.5) {
      const bodySlipRad = Math.atan2(vRight, vForward);
      // Sliding right (+vRight) means nose points left -> counter-steer right (-steer)
      const speedBlend = clamp((vForward - 7.5) / 14.0, 0, 1);
      const handbrakeScale = 1.0 - this.currentHandbrake * 0.65;
      counterSteer = clamp(-bodySlipRad * 0.42, -0.34, 0.34) * speedBlend * handbrakeScale;
    }

    const finalSteer = clamp(this.currentSteer + counterSteer, -1, 1);

    this.ctx.setHardwareInput('keyboard', {
      throttle: this.currentThrottle,
      brake: this.currentBrake,
      steer: finalSteer,
      handbrake: this.currentHandbrake,
      clutch: 0,
      inputSource: 'keyboard',
    });
  }
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

const controller = new InputKeyboardController();

export const inputKeyboardPlugin: IModulusPlugin = {
  id: 'input-keyboard',
  version: '1.0.0',
  priority: 30,
  init(ctx) {
    controller.init(ctx);
  },
  onPhysicsStep(dt, state, input) {
    controller.step(dt, state, input);
  },
  dispose() {
    controller.dispose();
  },
};
