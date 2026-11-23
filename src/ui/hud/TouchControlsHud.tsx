import { ArrowDown, ArrowUp } from 'lucide-react';
import type { ModulusEngine } from '../../core/Engine';

interface TouchControlsHudProps {
  engine: ModulusEngine;
  visible: boolean;
  steer: number;
  throttle: number;
  brake: number;
  handbrake: number;
}

/**
 * Visual Mobile Touch Controls Overlay.
 * Steering, brake, throttle, and handbrake zones stay `pointer-events-none` so touch events
 * pass directly to `canvas` `{ passive: false }` handlers in `input-touch` (zero iOS edge-swipe/zoom).
 * Shift Up/Down buttons are interactive tap targets.
 */
export function TouchControlsHud({
  engine,
  visible,
  steer,
  throttle,
  brake,
  handbrake,
}: TouchControlsHudProps) {
  if (!visible) return null;

  // steer is +1 Left .. -1 Right -> map to 0% (left) .. 100% (right)
  const steerPct = ((1 - steer) * 0.5) * 100;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex items-end justify-between px-4"
      style={{
        paddingBottom: 'calc(var(--safe-bottom) + 8px)',
        paddingLeft: 'calc(var(--safe-left) + 16px)',
        paddingRight: 'calc(var(--safe-right) + 16px)',
      }}
    >
      {/* Left Zone: Proportional Steering Slider Visual */}
      <div className="flex flex-col items-start gap-2">
        <div className="w-44 rounded-2xl border border-cyan-400/35 bg-[#0A0C10]/65 p-3 backdrop-blur-sm">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] font-bold uppercase text-cyan-300">
            <span>◀ L</span>
            <span>STEER</span>
            <span>R ▶</span>
          </div>
          <div className="relative h-9 w-full rounded-xl border border-slate-700/80 bg-slate-900/80">
            <div className="absolute inset-y-1.5 left-1/2 w-0.5 -translate-x-1/2 bg-slate-600/80" />
            <div
              className="absolute top-1 bottom-1 w-7 -translate-x-1/2 rounded-lg bg-cyan-400/90 shadow-[0_0_14px_rgba(0,240,255,0.65)] transition-[left] duration-75"
              style={{ left: `${Math.max(12, Math.min(88, steerPct))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Right Zone: Shift Paddles + Handbrake / Brake / Throttle Pads */}
      <div className="flex flex-col items-end gap-2">
        {/* Tappable Gear Shift Buttons */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              engine.setHardwareInput('touch', { gearDown: true });
            }}
            className="flex h-10 w-12 items-center justify-center rounded-xl border border-slate-600/80 bg-[#0A0C10]/80 text-slate-200 active:border-cyan-400 active:bg-cyan-500/20"
            aria-label="Shift down"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              engine.setHardwareInput('touch', { gearUp: true });
            }}
            className="flex h-10 w-12 items-center justify-center rounded-xl border border-slate-600/80 bg-[#0A0C10]/80 text-slate-200 active:border-cyan-400 active:bg-cyan-500/20"
            aria-label="Shift up"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>

        {/* Handbrake Zone Indicator */}
        <div
          className={`flex h-9 w-40 items-center justify-center rounded-xl border font-mono text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm transition ${
            handbrake > 0.1
              ? 'border-amber-400 bg-amber-500/35 text-amber-100'
              : 'border-amber-500/35 bg-[#0A0C10]/60 text-amber-300/80'
          }`}
        >
          HANDBRAKE
        </div>

        {/* Brake & Throttle Analog Pads */}
        <div className="flex items-end gap-2.5">
          <div
            className="relative flex h-24 w-18 flex-col items-center justify-end overflow-hidden rounded-2xl border border-rose-500/50 bg-[#0A0C10]/65 pb-2 backdrop-blur-sm"
          >
            <div
              className="absolute inset-x-0 bottom-0 bg-rose-500/45 transition-[height] duration-75"
              style={{ height: `${Math.round(brake * 100)}%` }}
            />
            <span className="relative z-10 font-mono text-[10px] font-bold uppercase text-rose-200">
              BRK
            </span>
          </div>

          <div
            className="relative flex h-28 w-20 flex-col items-center justify-end overflow-hidden rounded-2xl border border-emerald-400/55 bg-[#0A0C10]/65 pb-2 backdrop-blur-sm"
          >
            <div
              className="absolute inset-x-0 bottom-0 bg-emerald-400/45 transition-[height] duration-75"
              style={{ height: `${Math.round(throttle * 100)}%` }}
            />
            <span className="relative z-10 font-mono text-[10px] font-bold uppercase text-emerald-200">
              GAS
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
