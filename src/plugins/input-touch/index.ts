import type {
  IEngineContext,
  IInputState,
  IModulusPlugin,
  IVehicleRuntimeState,
} from '../../core/types';
import { computeSpeedSteerAuthority } from '../input-keyboard/inputShaper';

type TouchZone = 'steer' | 'brake' | 'throttle' | 'handbrake';

interface ActiveTouch {
  id: number;
  zone: TouchZone;
  anchorNx: number;
  anchorNy: number;
  nx: number;
  ny: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function detectCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      return true;
    }
  } catch {
    // ignore
  }
  return 'ontouchstart' in window && navigator.maxTouchPoints > 0;
}

/**
 * Mobile PWA Touch Input Controller (`priority: 31`)
 * - Auto-activates on `pointer: coarse` devices and supports manual toggle via `'modulus:touch-mode'`.
 * - Binds `{ passive: false }` touch listeners on the canvas in `'track'` mode to prevent
 *   iOS Safari edge-swipes and pinch-zooming.
 */
class InputTouchController {
  private ctx: IEngineContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private enabled = false;
  private activeTouches = new Map<number, ActiveTouch>();

  private targetSteer = 0;
  private targetThrottle = 0;
  private targetBrake = 0;
  private targetHandbrake = 0;

  private smoothSteer = 0;
  private smoothThrottle = 0;
  private smoothBrake = 0;
  private smoothHandbrake = 0;

  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;
  private boundManualToggle: (e: Event) => void;

  constructor() {
    this.boundTouchStart = (e) => this.onTouchStart(e);
    this.boundTouchMove = (e) => this.onTouchMove(e);
    this.boundTouchEnd = (e) => this.onTouchEnd(e);
    this.boundManualToggle = (e) => this.onManualToggle(e);
  }

  public init(ctx: IEngineContext): void {
    this.ctx = ctx;
    this.enabled = detectCoarsePointer();
    this.canvas = ctx.canvas;

    if (this.canvas) {
      this.canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false });
      this.canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false });
      this.canvas.addEventListener('touchend', this.boundTouchEnd, { passive: false });
      this.canvas.addEventListener('touchcancel', this.boundTouchEnd, { passive: false });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('modulus:touch-mode', this.boundManualToggle);
    }
  }

  public dispose(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('touchstart', this.boundTouchStart);
      this.canvas.removeEventListener('touchmove', this.boundTouchMove);
      this.canvas.removeEventListener('touchend', this.boundTouchEnd);
      this.canvas.removeEventListener('touchcancel', this.boundTouchEnd);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('modulus:touch-mode', this.boundManualToggle);
    }
    this.activeTouches.clear();
    this.resetOutputs();
    this.canvas = null;
    this.ctx = null;
  }

  private onManualToggle(e: Event): void {
    const custom = e as CustomEvent<{ enabled?: boolean }>;
    if (typeof custom.detail?.enabled === 'boolean') {
      this.enabled = custom.detail.enabled;
      if (!this.enabled) {
        this.activeTouches.clear();
        this.resetOutputs();
      }
    }
  }

  private resetOutputs(): void {
    this.targetSteer = 0;
    this.targetThrottle = 0;
    this.targetBrake = 0;
    this.targetHandbrake = 0;
    this.smoothSteer = 0;
    this.smoothThrottle = 0;
    this.smoothBrake = 0;
    this.smoothHandbrake = 0;
    this.ctx?.setHardwareInput('touch', {
      steer: 0,
      throttle: 0,
      brake: 0,
      handbrake: 0,
      clutch: 0,
    });
  }

  private isTrackTouchActive(): boolean {
    return Boolean(this.ctx && this.canvas && this.enabled && this.ctx.getVisualMode() === 'track');
  }

  private getNormalizedCoords(touch: Touch): { nx: number; ny: number } {
    const rect = this.canvas!.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const nx = clamp((touch.clientX - rect.left) / width, 0, 1);
    const ny = clamp((touch.clientY - rect.top) / height, 0, 1);
    return { nx, ny };
  }

  private classifyZone(nx: number, ny: number): TouchZone | null {
    // Ignore top safe-area HUD bar
    if (ny < 0.36) return null;

    // Left lower zone: proportional virtual steering slider/wheel
    if (nx <= 0.46) {
      return 'steer';
    }

    // Right lower zones: Handbrake (upper), Brake (inner lower), Throttle (outer lower)
    if (nx >= 0.56) {
      if (ny < 0.56) {
        return 'handbrake';
      }
      if (nx < 0.78) {
        return 'brake';
      }
      return 'throttle';
    }

    return null;
  }

  private onTouchStart(e: TouchEvent): void {
    if (!this.isTrackTouchActive()) return;

    let handled = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const { nx, ny } = this.getNormalizedCoords(t);
      const zone = this.classifyZone(nx, ny);
      if (zone) {
        this.activeTouches.set(t.identifier, {
          id: t.identifier,
          zone,
          anchorNx: nx,
          anchorNy: ny,
          nx,
          ny,
        });
        handled = true;
      }
    }

    // Prevent pinch-zoom and iOS Safari edge-swipe gestures on active controls
    if (handled || e.touches.length > 1) {
      e.preventDefault();
    }
    this.recomputeTargets();
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.isTrackTouchActive()) return;

    let handled = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const tracked = this.activeTouches.get(t.identifier);
      if (tracked) {
        const { nx, ny } = this.getNormalizedCoords(t);
        tracked.nx = nx;
        tracked.ny = ny;
        handled = true;
      }
    }

    if (handled || e.touches.length > 1) {
      e.preventDefault();
    }
    this.recomputeTargets();
  }

  private onTouchEnd(e: TouchEvent): void {
    if (!this.isTrackTouchActive()) return;

    let handled = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (this.activeTouches.delete(t.identifier)) {
        handled = true;
      }
    }

    if (handled) {
      e.preventDefault();
    }
    this.recomputeTargets();
  }

  private recomputeTargets(): void {
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let handbrake = 0;

    for (const touch of this.activeTouches.values()) {
      if (touch.zone === 'steer') {
        // Dragging left (-delta) steers left (+1); dragging right (+delta) steers right (-1)
        const deltaX = touch.nx - touch.anchorNx;
        const deadzone = 0.015;
        const fullLockSpan = 0.14;
        if (Math.abs(deltaX) > deadzone) {
          const mag = clamp((Math.abs(deltaX) - deadzone) / (fullLockSpan - deadzone), 0, 1);
          // Slight nonlinear curve for fine center precision
          const shaped = Math.pow(mag, 1.15);
          steer = deltaX < 0 ? shaped : -shaped;
        }
      } else if (touch.zone === 'throttle') {
        // Base 0.78 on touch, sliding upward smoothly reaches 1.00
        const slideUp = clamp((touch.anchorNy - touch.ny) / 0.14, 0, 1);
        throttle = Math.max(throttle, clamp(0.82 + slideUp * 0.18, 0, 1));
      } else if (touch.zone === 'brake') {
        const slideUp = clamp((touch.anchorNy - touch.ny) / 0.14, 0, 1);
        brake = Math.max(brake, clamp(0.82 + slideUp * 0.18, 0, 1));
      } else if (touch.zone === 'handbrake') {
        handbrake = 1;
      }
    }

    this.targetSteer = steer;
    this.targetThrottle = throttle;
    this.targetBrake = brake;
    this.targetHandbrake = handbrake;
  }

  public step(dt: number, state: IVehicleRuntimeState, input: IInputState): void {
    if (!this.ctx) return;

    if (!this.enabled || this.ctx.getVisualMode() !== 'track') {
      if (this.activeTouches.size > 0) {
        this.activeTouches.clear();
        this.resetOutputs();
      }
      return;
    }

    if (state.aiEnabled) return;

    // Only write when touch has active contacts or is decaying back to zero
    const hasActive =
      this.activeTouches.size > 0 ||
      Math.abs(this.smoothSteer) > 0.002 ||
      this.smoothThrottle > 0.002 ||
      this.smoothBrake > 0.002 ||
      this.smoothHandbrake > 0.002;

    if (!hasActive) return;

    const speedTaper = computeSpeedSteerAuthority(state.speedMs);
    const steerGoal = this.targetSteer * speedTaper;
    const alphaSteer = clamp(dt * 16, 0, 1);
    const alphaPedal = clamp(dt * 18, 0, 1);

    const prevBrake = this.smoothBrake;
    this.smoothSteer += (steerGoal - this.smoothSteer) * alphaSteer;
    this.smoothThrottle += (this.targetThrottle - this.smoothThrottle) * alphaPedal;
    this.smoothBrake += (this.targetBrake - this.smoothBrake) * alphaPedal;
    this.smoothHandbrake += (this.targetHandbrake - this.smoothHandbrake) * alphaPedal;

    if (Math.abs(this.smoothSteer) < 0.002 && this.targetSteer === 0) this.smoothSteer = 0;
    if (this.smoothThrottle < 0.002 && this.targetThrottle === 0) this.smoothThrottle = 0;
    if (this.smoothBrake < 0.002 && this.targetBrake === 0) this.smoothBrake = 0;
    if (this.smoothHandbrake < 0.002 && this.targetHandbrake === 0) this.smoothHandbrake = 0;

    const steerOut = clamp(this.smoothSteer, -1, 1);
    const throttleOut = clamp(this.smoothThrottle, 0, 1);
    const brakeOut = clamp(this.smoothBrake, 0, 1);
    const handbrakeOut = clamp(this.smoothHandbrake, 0, 1);
    const freshBrake = prevBrake < 0.08 && this.targetBrake > 0.2;

    state.rawSteerInput = this.targetSteer;
    state.commandedSteer = steerOut;

    input.steer = steerOut;
    input.throttle = throttleOut;
    input.brake = brakeOut;
    input.handbrake = handbrakeOut;
    input.clutch = 0;
    if (freshBrake) input.brakeFreshPress = true;
    input.inputSource = 'touch';

    this.ctx.setHardwareInput('touch', {
      steer: steerOut,
      throttle: throttleOut,
      brake: brakeOut,
      handbrake: handbrakeOut,
      clutch: 0,
      inputSource: 'touch',
    });
  }
}

const touchController = new InputTouchController();

export const inputTouchPlugin: IModulusPlugin = {
  id: 'input-touch',
  version: '1.0.0',
  priority: 31,
  init(ctx) {
    touchController.init(ctx);
  },
  onPhysicsStep(dt, state, input) {
    touchController.step(dt, state, input);
  },
  dispose() {
    touchController.dispose();
  },
};
