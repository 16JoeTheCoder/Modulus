import type {
  IFixedStepInputFrame,
  IVehicleStateSnapshot,
  SessionMode,
} from '../../contracts/simulation';
import type { IEngineContext } from '../../core/types';
import { GhostStorage, type ITimeTrialReplayBundle } from '../../replay';

export interface IGhostHudState {
  sessionMode: SessionMode;
  active: boolean;
  ghostVisible: boolean;
  hasGhost: boolean;
  ghostSource: 'personal_best' | 'friend' | null;
  ghostDriverName: string | null;
  ghostBestLapMs: number | null;
  liveDeltaMs: number | null;
  ghostFinished: boolean;
  isRecording: boolean;
  recordedTicks: number;
  pbImproved: boolean;
  lastPbImproved: boolean;
  lastRecordedReplayId: string | null;
}

export type GhostFixedStepListener = (
  tick: number,
  inputFrame: IFixedStepInputFrame,
  snapshot: IVehicleStateSnapshot
) => void;

/**
 * Optional fixed-step & sessionMode hooks requested from @physics (#42).
 * Feature-detected at runtime so ghost-renderer works cleanly before and after
 * Engine.ts exposes these hooks directly.
 */
export interface IPhysicsGhostHooks {
  onFixedStep?: (listener: GhostFixedStepListener) => () => void;
  getSessionMode?: () => SessionMode;
  setSessionMode?: (mode: SessionMode) => void;
}

const DEFAULT_GHOST_HUD_STATE: IGhostHudState = {
  sessionMode: 'practice',
  active: false,
  ghostVisible: true,
  hasGhost: false,
  ghostSource: null,
  ghostDriverName: null,
  ghostBestLapMs: null,
  liveDeltaMs: null,
  ghostFinished: false,
  isRecording: false,
  recordedTicks: 0,
  pbImproved: false,
  lastPbImproved: false,
  lastRecordedReplayId: null,
};

let currentHudState: IGhostHudState = { ...DEFAULT_GHOST_HUD_STATE };
const hudListeners = new Set<(state: IGhostHudState) => void>();
const modeListeners = new Set<(mode: SessionMode) => void>();
const visibilityListeners = new Set<(visible: boolean) => void>();
const friendGhostListeners = new Set<(bundle: ITimeTrialReplayBundle | null) => void>();
const sharedGhostStorage = new GhostStorage();

export function getSharedGhostStorage(): GhostStorage {
  return sharedGhostStorage;
}

export function getGhostHudState(): IGhostHudState {
  return { ...currentHudState };
}

export function publishGhostHudState(next: IGhostHudState): void {
  currentHudState = { ...next };
  for (const fn of Array.from(hudListeners)) {
    fn(currentHudState);
  }
}

export function subscribeGhostHudState(listener: (state: IGhostHudState) => void): () => void {
  hudListeners.add(listener);
  listener(getGhostHudState());
  return () => {
    hudListeners.delete(listener);
  };
}

export function setGhostSessionMode(mode: SessionMode, engine?: IEngineContext): void {
  if (engine) {
    const ext = engine as unknown as IPhysicsGhostHooks;
    if (typeof ext.setSessionMode === 'function') {
      ext.setSessionMode(mode);
    }
  }
  currentHudState = { ...currentHudState, sessionMode: mode };
  for (const fn of Array.from(modeListeners)) {
    fn(mode);
  }
  for (const fn of Array.from(hudListeners)) {
    fn(currentHudState);
  }
}

export function subscribeGhostSessionMode(listener: (mode: SessionMode) => void): () => void {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

export function setGhostVisible(visible: boolean): void {
  currentHudState = { ...currentHudState, ghostVisible: visible };
  for (const fn of Array.from(visibilityListeners)) {
    fn(visible);
  }
  for (const fn of Array.from(hudListeners)) {
    fn(currentHudState);
  }
}

export function subscribeGhostVisibility(listener: (visible: boolean) => void): () => void {
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
  };
}

export function setActiveFriendGhost(bundle: ITimeTrialReplayBundle | null): void {
  for (const fn of Array.from(friendGhostListeners)) {
    fn(bundle);
  }
}

export function subscribeFriendGhost(
  listener: (bundle: ITimeTrialReplayBundle | null) => void
): () => void {
  friendGhostListeners.add(listener);
  return () => {
    friendGhostListeners.delete(listener);
  };
}
