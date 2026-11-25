import type { IRulesetVersionKey, ITrackVersionMeta } from '../contracts/simulation';
import type { IStoredPersonalBest, ITimeTrialReplayBundle } from './types';

const GHOST_IDB_NAME = 'modulus_ghosts_db';
const GHOST_IDB_VERSION = 1;
const STORE_PERSONAL_BESTS = 'personal_bests';
const STORE_FRIEND_CACHE = 'friend_ghosts';

/**
 * Builds the canonical comparison partition key for Time Trial personal bests & ghosts.
 * Partitions strictly by trackId, trackVersion, physicsVersion, rulesetVersion,
 * balanceVersionId, weatherKey, assistPreset, and transmissionMode.
 */
export function makeReplayPartitionKey(
  track: Pick<ITrackVersionMeta, 'trackId' | 'trackVersion'>,
  ruleset: IRulesetVersionKey
): string {
  return [
    track.trackId,
    track.trackVersion,
    ruleset.physicsVersion,
    ruleset.rulesetVersion,
    ruleset.balanceVersionId,
    ruleset.weatherKey,
    ruleset.assistPreset,
    ruleset.transmissionMode,
  ].join('::');
}

/**
 * Local-first IndexedDB storage for Personal Best Time Trial replays and cached friend ghosts.
 * Falls back cleanly to in-memory storage when IndexedDB is unavailable (e.g. headless tests
 * or private browsing), preserving single-player ghost functionality when online services fail.
 */
export class GhostStorage {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private readonly memPersonalBests = new Map<string, IStoredPersonalBest>();
  private readonly memFriendCache = new Map<string, ITimeTrialReplayBundle>();

  private openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(GHOST_IDB_NAME, GHOST_IDB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_PERSONAL_BESTS)) {
            db.createObjectStore(STORE_PERSONAL_BESTS);
          }
          if (!db.objectStoreNames.contains(STORE_FRIEND_CACHE)) {
            db.createObjectStore(STORE_FRIEND_CACHE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  private async getRecord<T>(storeName: string, key: string): Promise<T | null> {
    const db = await this.openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async putRecord<T>(storeName: string, key: string, value: T): Promise<void> {
    const db = await this.openDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  public async getPersonalBest(partitionKey: string): Promise<IStoredPersonalBest | null> {
    const mem = this.memPersonalBests.get(partitionKey);
    if (mem) return mem;
    const stored = await this.getRecord<IStoredPersonalBest>(STORE_PERSONAL_BESTS, partitionKey);
    if (stored) {
      this.memPersonalBests.set(partitionKey, stored);
    }
    return stored;
  }

  /**
   * Stores a Time Trial replay as the local personal best ONLY if no PB exists for
   * its partition key or if the new lapTimeMs strictly improves the existing PB.
   */
  public async savePersonalBestIfFaster(
    bundle: ITimeTrialReplayBundle
  ): Promise<{ improved: boolean; partitionKey: string; previousBestMs: number | null }> {
    const partitionKey = makeReplayPartitionKey(bundle.header.track, bundle.header.ruleset);
    const existing = await this.getPersonalBest(partitionKey);
    const previousBestMs = existing?.bundle.header.lapTimeMs ?? null;

    if (previousBestMs !== null && bundle.header.lapTimeMs >= previousBestMs) {
      return { improved: false, partitionKey, previousBestMs };
    }

    const record: IStoredPersonalBest = {
      partitionKey,
      bundle,
      updatedAtIso: new Date().toISOString(),
    };
    this.memPersonalBests.set(partitionKey, record);
    await this.putRecord(STORE_PERSONAL_BESTS, partitionKey, record);
    return { improved: true, partitionKey, previousBestMs };
  }

  /**
   * Caches a downloaded friend replay locally so retries require zero extra network fetches.
   */
  public async cacheFriendGhost(replayId: string, bundle: ITimeTrialReplayBundle): Promise<void> {
    this.memFriendCache.set(replayId, bundle);
    await this.putRecord(STORE_FRIEND_CACHE, replayId, bundle);
  }

  public async getCachedFriendGhost(replayId: string): Promise<ITimeTrialReplayBundle | null> {
    const mem = this.memFriendCache.get(replayId);
    if (mem) return mem;
    const stored = await this.getRecord<ITimeTrialReplayBundle>(STORE_FRIEND_CACHE, replayId);
    if (stored) {
      this.memFriendCache.set(replayId, stored);
    }
    return stored;
  }
}
