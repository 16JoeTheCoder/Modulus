import type {
  CameraPreset,
  IEngineContext,
  IInputState,
  IKeyBindings,
  IModulusPlugin,
  IVehicleRuntimeState,
} from '../../core/types';
import { DeterministicInputShaper } from './inputShaper';

const CAMERA_CYCLE: CameraPreset[] = ['cockpit', 'hood', 'chase', 'orbit'];

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

function anyHeld(held: Set<string>, codes: string[]): boolean {
  for (let i = 0; i < codes.length; i++) {
    if (held.has(codes[i])) return true;
  }
  return false;
}

function matchesCode(code: string, codes: string[]): boolean {
  return codes.includes(code);
}

/**
 * Keyboard input controller (`priority: 30`) with dynamic keybinding lookup from Engine,
 * deterministic fixed-step shaping (zero 1-tick input lag), and rising-edge brake detection
 * for standstill reverse-on-fresh-press.
 */
class InputKeyboardController {
  private ctx: IEngineContext | null = null;
  private heldKeys = new Set<string>();
  private shaper = new DeterministicInputShaper();
  private prevBrakeHeld = false;
  private unsubReset: (() => void) | null = null;

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
    this.unsubReset = ctx.events.on('vehicle:reset', () => {
      this.shaper.reset();
      this.prevBrakeHeld = false;
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.boundKeyDown);
      window.addEventListener('keyup', this.boundKeyUp);
      window.addEventListener('blur', this.boundBlur);
    }
  }

  public dispose(): void {
    this.unsubReset?.();
    this.unsubReset = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.boundKeyDown);
      window.removeEventListener('keyup', this.boundKeyUp);
      window.removeEventListener('blur', this.boundBlur);
    }
    this.heldKeys.clear();
    this.shaper.reset();
    this.prevBrakeHeld = false;
    this.ctx = null;
  }

  private onBlur(): void {
    this.heldKeys.clear();
    this.shaper.reset();
    this.prevBrakeHeld = false;
    this.ctx?.setHardwareInput('keyboard', {
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
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.ctx) return;
    if (isEditableElement(e.target) || isEditableElement(document.activeElement)) {
      return;
    }

    const code = e.code;
    const bindings: IKeyBindings = this.ctx.getKeyBindings();

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

    if (matchesCode(code, bindings.brake)) {
      this.ctx.setHardwareInput('keyboard', { brakeFreshPress: true });
    }
    if (matchesCode(code, bindings.gearUp)) {
      this.ctx.setHardwareInput('keyboard', { gearUp: true });
    } else if (matchesCode(code, bindings.gearDown)) {
      this.ctx.setHardwareInput('keyboard', { gearDown: true });
    } else if (matchesCode(code, bindings.reset)) {
      this.ctx.setHardwareInput('keyboard', { resetVehicle: true });
    } else if (matchesCode(code, bindings.camera)) {
      const current = this.ctx.getCameraPreset();
      const idx = CAMERA_CYCLE.indexOf(current);
      const next = CAMERA_CYCLE[(idx + 1) % CAMERA_CYCLE.length];
      this.ctx.setCameraPreset(next);
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.heldKeys.delete(e.code);
  }

  public step(dt: number, state: IVehicleRuntimeState, input: IInputState): void {
    if (!this.ctx) return;
    if (this.ctx.getVisualMode() !== 'track') {
      this.shaper.reset();
      this.prevBrakeHeld = false;
      return;
    }

    // Do not overwrite active AI or Touch input
    if (state.aiEnabled || input.inputSource === 'touch') {
      return;
    }

    const bindings = this.ctx.getKeyBindings();
    const throttleRaw = anyHeld(this.heldKeys, bindings.throttle) ? 1 : 0;
    const brakeHeld = anyHeld(this.heldKeys, bindings.brake);
    const brakeRaw = brakeHeld ? 1 : 0;
    const handbrakeRaw = anyHeld(this.heldKeys, bindings.handbrake) ? 1 : 0;

    const steerLeft = anyHeld(this.heldKeys, bindings.steerLeft) ? 1 : 0;
    const steerRight = anyHeld(this.heldKeys, bindings.steerRight) ? 1 : 0;
    const rawSteer = steerLeft - steerRight; // +1 = Left, -1 = Right

    const freshBrakePress = (brakeHeld && !this.prevBrakeHeld) || Boolean(input.brakeFreshPress);
    this.prevBrakeHeld = brakeHeld;

    const shaped = this.shaper.step(
      dt,
      {
        throttle: throttleRaw,
        brake: brakeRaw,
        steer: rawSteer,
        handbrake: handbrakeRaw,
      },
      state,
      state.assistPreset
    );

    // Record raw & shaped steering telemetry
    state.rawSteerInput = rawSteer;
    state.commandedSteer = shaped.steer;

    // Write directly into `input` for ZERO 1-tick lag AND mirror to Engine keyboard buffer
    input.throttle = shaped.throttle;
    input.brake = shaped.brake;
    input.steer = shaped.steer;
    input.handbrake = shaped.handbrake;
    input.clutch = 0;
    input.brakeFreshPress = freshBrakePress;
    input.inputSource = 'keyboard';

    this.ctx.setHardwareInput('keyboard', {
      throttle: shaped.throttle,
      brake: shaped.brake,
      steer: shaped.steer,
      handbrake: shaped.handbrake,
      clutch: 0,
      inputSource: 'keyboard',
    });
  }
}

const controller = new InputKeyboardController();

export const inputKeyboardPlugin: IModulusPlugin = {
  id: 'input-keyboard',
  version: '2.0.0',
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
