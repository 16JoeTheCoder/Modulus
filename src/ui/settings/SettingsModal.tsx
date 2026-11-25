import { useEffect, useState } from 'react';
import { Camera, Gamepad2, RotateCcw, Sliders, Volume2, VolumeX, X } from 'lucide-react';
import type { AssistPreset, TransmissionMode } from '../../contracts/simulation';
import {
  formatKeyCodeLabel,
  resetKeyBindingsToDefaults,
  updatePlayerSettings,
  type ExtendedCameraPreset,
  type KeyBindingsConfig,
  type MotionPreset,
  type PlayerSettings,
  type SpeedUnit,
} from '../settingsStore';

export interface ISettingsModalProps {
  open: boolean;
  settings: PlayerSettings;
  onClose: () => void;
}

type SettingsTab = 'camera' | 'motion' | 'audio' | 'controls';

const BIND_LABELS: Array<{ key: keyof KeyBindingsConfig; label: string }> = [
  { key: 'throttle', label: 'Accelerate' },
  { key: 'brake', label: 'Brake / Reverse (2× at stop)' },
  { key: 'steerLeft', label: 'Steer Left' },
  { key: 'steerRight', label: 'Steer Right' },
  { key: 'handbrake', label: 'Handbrake' },
  { key: 'gearUp', label: 'Shift Up' },
  { key: 'gearDown', label: 'Shift Down' },
  { key: 'camera', label: 'Cycle Camera' },
  { key: 'reset', label: 'Reset Car' },
];

export function SettingsModal({ open, settings, onClose }: ISettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>('camera');
  const [rebindingAction, setRebindingAction] = useState<keyof KeyBindingsConfig | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (rebindingAction) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') {
          setRebindingAction(null);
          return;
        }
        const existing = settings.keyBindings[rebindingAction];
        const nextCodes = [e.code, ...existing.filter((c) => c !== e.code)].slice(0, 2);
        updatePlayerSettings({
          keyBindings: {
            ...settings.keyBindings,
            [rebindingAction]: nextCodes,
          },
        });
        setRebindingAction(null);
        return;
      }
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, rebindingAction, settings.keyBindings, onClose]);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-700/90 bg-[#0B0F17] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 4 Category Tabs */}
        <div className="grid grid-cols-4 gap-1 border-b border-slate-800 bg-[#080B10] p-1.5">
          {(
            [
              { id: 'camera', label: 'Camera', icon: Camera },
              { id: 'motion', label: 'Motion', icon: Sliders },
              { id: 'audio', label: 'Audio', icon: Volume2 },
              { id: 'controls', label: 'Controls', icon: Gamepad2 },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setRebindingAction(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/50'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {tab === 'camera' && (
            <>
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Default Driving View
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      { id: 'cockpit', label: 'Cockpit', hint: 'Default driver POV' },
                      { id: 'hood', label: 'Hood', hint: 'Bonnet sightline' },
                      { id: 'chase', label: 'Chase', hint: 'Behind car' },
                      { id: 'orbit', label: 'Orbit', hint: 'Free camera' },
                    ] as Array<{ id: ExtendedCameraPreset; label: string; hint: string }>
                  ).map((cam) => (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() => updatePlayerSettings({ defaultCamera: cam.id })}
                      className={`rounded-xl border p-2.5 text-left transition ${
                        settings.defaultCamera === cam.id
                          ? 'border-cyan-400 bg-cyan-500/15 text-white'
                          : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <div className="text-xs font-bold">{cam.label}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">{cam.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Speed Units
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'mph', label: 'MPH (Default)', desc: 'Miles per hour' },
                      { id: 'kph', label: 'KM/H', desc: 'Kilometers per hour' },
                    ] as Array<{ id: SpeedUnit; label: string; desc: string }>
                  ).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => updatePlayerSettings({ speedUnit: u.id })}
                      className={`rounded-xl border p-3 text-left transition ${
                        settings.speedUnit === u.id
                          ? 'border-cyan-400 bg-cyan-500/15 text-white'
                          : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <div className="font-mono text-xs font-bold">{u.label}</div>
                      <div className="text-[10px] text-slate-400">{u.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-2.5">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Open Debrief after Completing a Lap
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Pause and review sector splits & setup takeaways at Start/Finish
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoDebriefOnLap}
                  onChange={(e) => updatePlayerSettings({ autoDebriefOnLap: e.target.checked })}
                  className="h-4 w-4 accent-cyan-400"
                />
              </label>
            </>
          )}

          {tab === 'motion' && (
            <div className="space-y-2.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Camera Motion Preset
              </div>
              {(
                [
                  {
                    id: 'reduced',
                    title: 'Reduced Motion',
                    desc: 'Horizon-locked view, zero head bob or impact shake, minimal FOV shift.',
                  },
                  {
                    id: 'standard',
                    title: 'Standard (Recommended)',
                    desc: 'Subtle look-into-apex cue and gentle braking dive without obscuring the road.',
                  },
                  {
                    id: 'dynamic',
                    title: 'Dynamic Motorsport',
                    desc: 'Expressive G-force head shift, corner apex look, and tactile impact feedback.',
                  },
                ] as Array<{ id: MotionPreset; title: string; desc: string }>
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => updatePlayerSettings({ motionPreset: preset.id })}
                  className={`w-full rounded-xl border p-3.5 text-left transition ${
                    settings.motionPreset === preset.id
                      ? 'border-cyan-400 bg-cyan-500/15 text-white'
                      : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="text-xs font-bold">{preset.title}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{preset.desc}</div>
                </button>
              ))}
            </div>
          )}

          {tab === 'audio' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  {settings.muted ? (
                    <VolumeX className="h-4 w-4 text-rose-400" />
                  ) : (
                    <Volume2 className="h-4 w-4 text-cyan-400" />
                  )}
                  <span>Cockpit Audio Cues</span>
                </div>
                <button
                  type="button"
                  onClick={() => updatePlayerSettings({ muted: !settings.muted })}
                  className={`rounded-lg border px-3 py-1 text-xs font-bold transition ${
                    settings.muted
                      ? 'border-rose-500/50 bg-rose-500/15 text-rose-200'
                      : 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                  }`}
                >
                  {settings.muted ? 'Muted' : 'Active'}
                </button>
              </div>

              {(
                [
                  { key: 'masterVolume', label: 'Master Volume', hint: 'Overall cockpit mix' },
                  {
                    key: 'engineVolume',
                    label: 'Engine & Shifts',
                    hint: 'RPM tone, combustion load & shift cues',
                  },
                  {
                    key: 'tireSurfaceVolume',
                    label: 'Tires, Kerbs & Impacts',
                    hint: 'Early grip scrub, lockup chirp, kerb rumble',
                  },
                ] as const
              ).map((slider) => (
                <div key={slider.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-200">{slider.label}</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {Math.round(settings[slider.key] * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings[slider.key]}
                    onChange={(e) =>
                      updatePlayerSettings({ [slider.key]: parseFloat(e.target.value) })
                    }
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-cyan-400"
                  />
                  <div className="text-[10px] text-slate-500">{slider.hint}</div>
                </div>
              ))}
            </div>
          )}

          {tab === 'controls' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    Transmission
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['auto', 'manual'] as TransmissionMode[]).map((tm) => (
                      <button
                        key={tm}
                        type="button"
                        onClick={() => updatePlayerSettings({ transmissionMode: tm })}
                        className={`rounded-lg border py-1.5 text-xs font-bold uppercase transition ${
                          settings.transmissionMode === tm
                            ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                            : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        {tm}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    Assist Preset
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {(['beginner', 'sport', 'pro'] as AssistPreset[]).map((ap) => (
                      <button
                        key={ap}
                        type="button"
                        onClick={() => updatePlayerSettings({ assistPreset: ap })}
                        className={`rounded-lg border py-1.5 text-[11px] font-bold uppercase transition ${
                          settings.assistPreset === ap
                            ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                            : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        {ap}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
                <span className="text-xs font-medium text-slate-200">
                  Show On-Screen Key Hints while Driving
                </span>
                <input
                  type="checkbox"
                  checked={settings.showControlHints}
                  onChange={(e) => updatePlayerSettings({ showControlHints: e.target.checked })}
                  className="h-4 w-4 accent-cyan-400"
                />
              </label>

              {/* Key Remapping List */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    Key Bindings (Click to Remap)
                  </span>
                  <button
                    type="button"
                    onClick={() => resetKeyBindingsToDefaults()}
                    className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset Defaults
                  </button>
                </div>

                <div className="divide-y divide-slate-800/70 rounded-xl border border-slate-800 bg-slate-950/60">
                  {BIND_LABELS.map((item) => {
                    const listening = rebindingAction === item.key;
                    const codes = settings.keyBindings[item.key];
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between px-3 py-2 text-xs"
                      >
                        <span className="text-slate-300">{item.label}</span>
                        <button
                          type="button"
                          onClick={() => setRebindingAction(listening ? null : item.key)}
                          className={`rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold transition ${
                            listening
                              ? 'animate-pulse border-amber-400 bg-amber-500/20 text-amber-200'
                              : 'border-slate-700 bg-slate-900 text-cyan-200 hover:border-cyan-400'
                          }`}
                        >
                          {listening
                            ? 'Press any key...'
                            : codes.map(formatKeyCodeLabel).join(' / ')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-800 bg-[#090C12] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-cyan-400 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-slate-950 transition hover:bg-cyan-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
