import type { AssistPreset, TransmissionMode } from '../contracts/simulation';

export type SpeedUnit = 'mph' | 'kph';
export type ExtendedCameraPreset = 'cockpit' | 'hood' | 'chase' | 'orbit';
export type MotionPreset = 'reduced' | 'standard' | 'dynamic';
export type LabExperienceMode = 'beginner' | 'advanced';

export interface KeyBindingsConfig {
  throttle: string[];
  brake: string[];
  steerLeft: string[];
  steerRight: string[];
  handbrake: string[];
  gearUp: string[];
  gearDown: string[];
  reset: string[];
  camera: string[];
}

export interface PlayerSettings {
  speedUnit: SpeedUnit;
  defaultCamera: ExtendedCameraPreset;
  motionPreset: MotionPreset;
  masterVolume: number;
  engineVolume: number;
  tireSurfaceVolume: number;
  muted: boolean;
  transmissionMode: TransmissionMode;
  assistPreset: AssistPreset;
  showControlHints: boolean;
  autoDebriefOnLap: boolean;
  labMode: LabExperienceMode;
  keyBindings: KeyBindingsConfig;
}

export interface ResumableSession {
  trackId: string;
  buildId: string;
  buildName: string;
  trackName: string;
  lastPlayedAt: string;
  lastLapTimeMs: number | null;
}

export interface LocalLapRecord {
  id: string;
  timestamp: string;
  trackId: string;
  trackVersion: string;
  balanceVersionId: string;
  rulesetVersion: string;
  buildId: string;
  buildName: string;
  chassisId: string;
  lapNumber: number;
  lapTimeMs: number;
  sectorTimesMs: number[];
  sectorNames: string[];
  peakSpeedMs: number;
  lapValid: boolean;
  isAiAssisted: boolean;
}

export interface TrackPersonalBest {
  partitionKey: string;
  bestLapTimeMs: number | null;
  bestSectorTimesMs: Array<number | null>;
  attempts: LocalLapRecord[];
}

export const DEFAULT_KEY_BINDINGS: KeyBindingsConfig = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  gearUp: ['KeyE', 'ShiftLeft'],
  gearDown: ['KeyQ', 'ControlLeft'],
  reset: ['KeyR'],
  camera: ['KeyC'],
};

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  speedUnit: 'mph',
  defaultCamera: 'cockpit',
  motionPreset: 'standard',
  masterVolume: 0.7,
  engineVolume: 0.85,
  tireSurfaceVolume: 0.8,
  muted: false,
  transmissionMode: 'auto',
  assistPreset: 'beginner',
  showControlHints: true,
  autoDebriefOnLap: true,
  labMode: 'beginner',
  keyBindings: { ...DEFAULT_KEY_BINDINGS },
};

const SETTINGS_KEY = 'modulus_player_settings_v1';
const SESSION_KEY = 'modulus_resumable_session_v1';
const PBS_KEY = 'modulus_local_pbs_v1';

type Listener = (settings: PlayerSettings) => void;
const listeners = new Set<Listener>();

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadSettingsFromStorage(): PlayerSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_PLAYER_SETTINGS };
  const parsed = safeParseJson<Partial<PlayerSettings>>(window.localStorage.getItem(SETTINGS_KEY));
  if (!parsed) return { ...DEFAULT_PLAYER_SETTINGS };
  return {
    ...DEFAULT_PLAYER_SETTINGS,
    ...parsed,
    keyBindings: {
      ...DEFAULT_KEY_BINDINGS,
      ...(parsed.keyBindings ?? {}),
    },
  };
}

let cachedSettings: PlayerSettings = loadSettingsFromStorage();

export function getPlayerSettings(): PlayerSettings {
  return cachedSettings;
}

export function updatePlayerSettings(patch: Partial<PlayerSettings>): PlayerSettings {
  cachedSettings = {
    ...cachedSettings,
    ...patch,
    keyBindings: patch.keyBindings
      ? { ...cachedSettings.keyBindings, ...patch.keyBindings }
      : cachedSettings.keyBindings,
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(cachedSettings));
    } catch {
      // ignore quota errors
    }
    window.dispatchEvent(new CustomEvent('modulus:settings-changed', { detail: cachedSettings }));
  }
  for (const fn of listeners) {
    try {
      fn(cachedSettings);
    } catch {
      // ignore subscriber errors
    }
  }
  return cachedSettings;
}

export function resetKeyBindingsToDefaults(): PlayerSettings {
  return updatePlayerSettings({
    keyBindings: {
      throttle: [...DEFAULT_KEY_BINDINGS.throttle],
      brake: [...DEFAULT_KEY_BINDINGS.brake],
      steerLeft: [...DEFAULT_KEY_BINDINGS.steerLeft],
      steerRight: [...DEFAULT_KEY_BINDINGS.steerRight],
      handbrake: [...DEFAULT_KEY_BINDINGS.handbrake],
      gearUp: [...DEFAULT_KEY_BINDINGS.gearUp],
      gearDown: [...DEFAULT_KEY_BINDINGS.gearDown],
      reset: [...DEFAULT_KEY_BINDINGS.reset],
      camera: [...DEFAULT_KEY_BINDINGS.camera],
    },
  });
}

export function subscribePlayerSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getResumableSession(): ResumableSession | null {
  if (typeof window === 'undefined') return null;
  return safeParseJson<ResumableSession>(window.localStorage.getItem(SESSION_KEY));
}

export function saveResumableSession(session: ResumableSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore storage errors
  }
}

export function makePbPartitionKey(
  trackId: string,
  trackVersion: string,
  balanceVersionId: string,
  rulesetVersion: string
): string {
  return `${trackId}::${trackVersion}::${balanceVersionId}::${rulesetVersion}`;
}

function loadAllPbs(): Record<string, TrackPersonalBest> {
  if (typeof window === 'undefined') return {};
  return safeParseJson<Record<string, TrackPersonalBest>>(window.localStorage.getItem(PBS_KEY)) ?? {};
}

export function getTrackPersonalBest(partitionKey: string): TrackPersonalBest {
  const all = loadAllPbs();
  return (
    all[partitionKey] ?? {
      partitionKey,
      bestLapTimeMs: null,
      bestSectorTimesMs: [null, null, null],
      attempts: [],
    }
  );
}

export function recordLocalLapAttempt(
  record: LocalLapRecord
): {
  pbBefore: TrackPersonalBest;
  pbAfter: TrackPersonalBest;
  isNewBestLap: boolean;
  deltaToBestLapMs: number | null;
  deltaToPrevLapMs: number | null;
  sectorDeltasMs: Array<number | null>;
} {
  const partitionKey = makePbPartitionKey(
    record.trackId,
    record.trackVersion,
    record.balanceVersionId,
    record.rulesetVersion
  );
  const all = loadAllPbs();
  const existing = all[partitionKey] ?? {
    partitionKey,
    bestLapTimeMs: null,
    bestSectorTimesMs: [null, null, null],
    attempts: [],
  };

  const pbBefore: TrackPersonalBest = {
    partitionKey,
    bestLapTimeMs: existing.bestLapTimeMs,
    bestSectorTimesMs: [...existing.bestSectorTimesMs],
    attempts: [...existing.attempts],
  };

  const prevAttempt = existing.attempts[0] ?? null;
  const deltaToPrevLapMs = prevAttempt ? record.lapTimeMs - prevAttempt.lapTimeMs : null;
  const deltaToBestLapMs =
    existing.bestLapTimeMs !== null ? record.lapTimeMs - existing.bestLapTimeMs : null;

  const sectorCount = Math.max(3, record.sectorTimesMs.length);
  const nextBestSectors: Array<number | null> = Array.from({ length: sectorCount }, (_, i) => {
    const prev = existing.bestSectorTimesMs[i] ?? null;
    return prev;
  });

  const sectorDeltasMs: Array<number | null> = record.sectorTimesMs.map((ms, i) => {
    const best = nextBestSectors[i];
    if (ms <= 0 || best === null) return null;
    return ms - best;
  });

  const eligibleForPb = record.lapValid && !record.isAiAssisted;
  let isNewBestLap = false;
  let nextBestLapMs = existing.bestLapTimeMs;

  if (eligibleForPb && (nextBestLapMs === null || record.lapTimeMs < nextBestLapMs)) {
    nextBestLapMs = record.lapTimeMs;
    isNewBestLap = true;
  }

  if (eligibleForPb) {
    for (let i = 0; i < record.sectorTimesMs.length; i++) {
      const sMs = record.sectorTimesMs[i];
      if (sMs > 0 && (nextBestSectors[i] === null || sMs < nextBestSectors[i]!)) {
        nextBestSectors[i] = sMs;
      }
    }
  }

  const pbAfter: TrackPersonalBest = {
    partitionKey,
    bestLapTimeMs: nextBestLapMs,
    bestSectorTimesMs: nextBestSectors,
    attempts: [record, ...existing.attempts].slice(0, 12),
  };

  all[partitionKey] = pbAfter;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PBS_KEY, JSON.stringify(all));
    } catch {
      // ignore quota errors
    }
  }

  return {
    pbBefore,
    pbAfter,
    isNewBestLap,
    deltaToBestLapMs,
    deltaToPrevLapMs,
    sectorDeltasMs,
  };
}

export function formatSpeedValue(speedMs: number, unit: SpeedUnit): number {
  const safe = Math.max(0, speedMs);
  return unit === 'mph' ? Math.round(safe * 2.236936) : Math.round(safe * 3.6);
}

export function formatSpeedFromKph(speedKph: number, unit: SpeedUnit): number {
  const safe = Math.max(0, speedKph);
  return unit === 'mph' ? Math.round(safe * 0.621371) : Math.round(safe);
}

export function speedUnitLabel(unit: SpeedUnit): string {
  return unit === 'mph' ? 'MPH' : 'KM/H';
}

export function formatKeyCodeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'SPACE';
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'SHIFT';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'CTRL';
  return code.toUpperCase();
}
