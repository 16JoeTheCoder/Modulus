import { createStarterBuild, PARTS_BY_ID, CHASSIS_BY_ID, STARTER_OWNED_PART_IDS } from '../content';
import {
  DEFAULT_BALANCE_CONFIG,
  GlobalBalanceConfigSchema,
  type IAuthUser,
  type IGarageSyncResponse,
  type IGlobalBalanceConfig,
  type ILapFinishedPayload,
  type ILapLeaderboardEntry,
  type ITypedEventBus,
  type IVehicleBuildConfig,
} from './types';

const IDB_NAME = 'modulus_pwa_db';
const IDB_VERSION = 1;
const STORE_STATE = 'kv_state';

export interface ILocalPersistedGarage {
  activeBuild: IVehicleBuildConfig;
  savedBuilds: IVehicleBuildConfig[];
  ownedPartIds: string[];
  credits: number;
  selectedTrackId: string;
  updatedAt: string;
}

/**
 * IndexedDB Cold-Start Mirror + Batched Cloudflare D1/KV Sync Manager
 * - Zero polling: D1 writes occur ONLY on explicit mutations (`saveBuild`, `purchasePart`, `submitLap`).
 * - Instant iOS/Android PWA cold-start restoration via IndexedDB.
 */
export class StorageSync {
  private readonly events: ITypedEventBus;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private user: IAuthUser | null = null;
  private state: ILocalPersistedGarage;
  private balanceConfig: IGlobalBalanceConfig = DEFAULT_BALANCE_CONFIG;
  private idbSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(events: ITypedEventBus) {
    this.events = events;
    const starter = createStarterBuild();
    this.state = {
      activeBuild: starter,
      savedBuilds: [starter],
      ownedPartIds: [...STARTER_OWNED_PART_IDS],
      credits: DEFAULT_BALANCE_CONFIG.economy_bias.starting_credits,
      selectedTrackId: 'track_gp_circuit',
      updatedAt: new Date().toISOString(),
    };
  }

  private openIdb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_STATE)) {
            db.createObjectStore(STORE_STATE);
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

  private async idbGet<T>(key: string): Promise<T | null> {
    const db = await this.openIdb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_STATE, 'readonly');
        const req = tx.objectStore(STORE_STATE).get(key);
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async idbPut<T>(key: string, value: T): Promise<void> {
    const db = await this.openIdb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_STATE, 'readwrite');
        tx.objectStore(STORE_STATE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  public async bootstrap(): Promise<{
    garage: ILocalPersistedGarage;
    balanceConfig: IGlobalBalanceConfig;
    user: IAuthUser | null;
  }> {
    // 1. Instant IndexedDB cold-start restore
    const cachedGarage = await this.idbGet<ILocalPersistedGarage>('garage');
    const cachedBalance = await this.idbGet<IGlobalBalanceConfig>('balance_config');

    if (cachedGarage && cachedGarage.activeBuild) {
      this.state = {
        ...this.state,
        ...cachedGarage,
        ownedPartIds: Array.from(new Set([...STARTER_OWNED_PART_IDS, ...(cachedGarage.ownedPartIds ?? [])])),
      };
    }
    if (cachedBalance) {
      const parsed = GlobalBalanceConfigSchema.safeParse(cachedBalance);
      if (parsed.success) {
        this.balanceConfig = parsed.data;
      }
    }

    this.events.emit('economy:updated', {
      credits: this.state.credits,
      ownedPartIds: this.state.ownedPartIds,
    });

    // 2. Non-blocking Edge KV config + 30-day session reconciliation
    void this.refreshEdgeState();

    return {
      garage: this.state,
      balanceConfig: this.balanceConfig,
      user: this.user,
    };
  }

  public async refreshEdgeState(): Promise<void> {
    try {
      const cfgRes = await fetch('/api/config/public', { credentials: 'include' });
      if (cfgRes.ok) {
        const raw = await cfgRes.json();
        const parsed = GlobalBalanceConfigSchema.safeParse(raw);
        if (parsed.success) {
          this.balanceConfig = parsed.data;
          await this.idbPut('balance_config', parsed.data);
          this.events.emit('config:updated', { config: parsed.data });
        }
      }
    } catch {
      // Offline PWA mode — continue using IndexedDB cached config
    }

    try {
      const garageRes = await fetch('/api/garage', { credentials: 'include' });
      if (garageRes.ok) {
        const data = (await garageRes.json()) as IGarageSyncResponse;
        this.reconcileCloudGarage(data);
      }
    } catch {
      // Offline or unauthenticated
    }
  }

  public reconcileCloudGarage(data: IGarageSyncResponse): void {
    this.user = data.user;
    const mergedOwned = Array.from(new Set([...STARTER_OWNED_PART_IDS, ...data.ownedPartIds]));
    const cloudBuilds = data.builds.map((b) => b.build);
    const activeRecord = data.builds.find((b) => b.isActive);

    this.state = {
      ...this.state,
      credits: data.user.credits,
      ownedPartIds: mergedOwned,
      savedBuilds: cloudBuilds.length > 0 ? cloudBuilds : this.state.savedBuilds,
      activeBuild: activeRecord?.build ?? cloudBuilds[0] ?? this.state.activeBuild,
      updatedAt: new Date().toISOString(),
    };

    void this.idbPut('garage', this.state);
    this.events.emit('auth:changed', { user: this.user });
    this.events.emit('economy:updated', {
      credits: this.state.credits,
      ownedPartIds: this.state.ownedPartIds,
    });
    this.events.emit('sync:status', {
      syncing: false,
      lastSyncedAt: this.state.updatedAt,
      error: null,
    });
  }

  public getUser(): IAuthUser | null {
    return this.user;
  }

  public setUser(user: IAuthUser | null): void {
    this.user = user;
    if (user) {
      this.state.credits = user.credits;
      this.events.emit('economy:updated', {
        credits: this.state.credits,
        ownedPartIds: this.state.ownedPartIds,
      });
    }
    this.events.emit('auth:changed', { user });
  }

  public getGarageState(): ILocalPersistedGarage {
    return this.state;
  }

  public getCredits(): number {
    return this.state.credits;
  }

  public isPartOwned(partOrChassisId: string): boolean {
    if (this.user?.unlockAll) return true;
    return this.state.ownedPartIds.includes(partOrChassisId);
  }

  /**
   * Mirrors active build & track selection to IndexedDB (debounced 180ms) for instant iOS cold-start recovery.
   * Does NOT hit Cloudflare D1 until explicit `saveBuildToCloud()`.
   */
  public mirrorLocalBuild(build: IVehicleBuildConfig, selectedTrackId?: string): void {
    this.state.activeBuild = build;
    if (selectedTrackId) {
      this.state.selectedTrackId = selectedTrackId;
    }
    const existingIdx = this.state.savedBuilds.findIndex((b) => b.id === build.id);
    if (existingIdx >= 0) {
      this.state.savedBuilds[existingIdx] = build;
    } else {
      this.state.savedBuilds.push(build);
    }
    this.state.updatedAt = new Date().toISOString();

    if (this.idbSaveTimer) clearTimeout(this.idbSaveTimer);
    this.idbSaveTimer = setTimeout(() => {
      void this.idbPut('garage', this.state);
    }, 180);
  }

  /**
   * Explicit Batched Mutation 1: Save Build to D1
   */
  public async saveBuildToCloud(build: IVehicleBuildConfig): Promise<boolean> {
    this.mirrorLocalBuild(build);
    await this.idbPut('garage', this.state);

    if (!this.user) return true;

    this.events.emit('sync:status', { syncing: true, lastSyncedAt: null, error: null });
    try {
      const res = await fetch('/api/garage/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ build, setActive: true }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const now = new Date().toISOString();
      this.events.emit('sync:status', { syncing: false, lastSyncedAt: now, error: null });
      return true;
    } catch (err) {
      this.events.emit('sync:status', {
        syncing: false,
        lastSyncedAt: null,
        error: err instanceof Error ? err.message : 'Sync error',
      });
      return false;
    }
  }

  /**
   * Explicit Batched Mutation 2: Buy Part or Chassis
   */
  public async purchaseItem(partOrChassisId: string): Promise<{ ok: boolean; error?: string }> {
    if (this.isPartOwned(partOrChassisId)) {
      return { ok: true };
    }

    const part = PARTS_BY_ID.get(partOrChassisId);
    const chassis = CHASSIS_BY_ID.get(partOrChassisId);
    const rawPrice = part?.price ?? chassis?.price ?? 0;
    const effectivePrice = Math.round(rawPrice * this.balanceConfig.economy_bias.part_price_mult);

    if (this.state.credits < effectivePrice) {
      return { ok: false, error: `Insufficient credits (Need ${effectivePrice.toLocaleString()} CR)` };
    }

    if (this.user) {
      this.events.emit('sync:status', { syncing: true, lastSyncedAt: null, error: null });
      try {
        const res = await fetch('/api/shop/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ partId: partOrChassisId }),
        });
        if (!res.ok) {
          const errJson = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errJson.error ?? `Purchase failed (${res.status})`);
        }
        const data = (await res.json()) as { credits: number; ownedPartIds: string[] };
        this.state.credits = data.credits;
        this.state.ownedPartIds = Array.from(new Set([...this.state.ownedPartIds, ...data.ownedPartIds]));
        await this.idbPut('garage', this.state);
        this.events.emit('economy:updated', {
          credits: this.state.credits,
          ownedPartIds: this.state.ownedPartIds,
        });
        this.events.emit('sync:status', {
          syncing: false,
          lastSyncedAt: new Date().toISOString(),
          error: null,
        });
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Purchase failed';
        this.events.emit('sync:status', { syncing: false, lastSyncedAt: null, error: message });
        return { ok: false, error: message };
      }
    }

    // Local guest purchase (mirrored to IndexedDB)
    this.state.credits -= effectivePrice;
    this.state.ownedPartIds.push(partOrChassisId);
    await this.idbPut('garage', this.state);
    this.events.emit('economy:updated', {
      credits: this.state.credits,
      ownedPartIds: this.state.ownedPartIds,
    });
    return { ok: true };
  }

  /**
   * Explicit Batched Mutation 3: Finish Lap & Partitioned Leaderboard Submit
   */
  public async recordCompletedLap(
    payload: ILapFinishedPayload,
    baseTrackRewardCredits: number
  ): Promise<{ creditsAwarded: number }> {
    const payoutMult = this.balanceConfig.economy_bias.payout_mult;
    const aiPenalty = payload.isAiAssisted ? 0.35 : 1.0;
    const localReward = payload.lapValid
      ? Math.max(250, Math.round(baseTrackRewardCredits * payoutMult * aiPenalty))
      : 0;

    if (!this.user) {
      this.state.credits += localReward;
      await this.idbPut('garage', this.state);
      this.events.emit('economy:updated', {
        credits: this.state.credits,
        ownedPartIds: this.state.ownedPartIds,
      });
      return { creditsAwarded: localReward };
    }

    if (!payload.lapValid) return { creditsAwarded: 0 };

    try {
      const res = await fetch('/api/laps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          trackId: payload.trackId,
          buildId: payload.buildId,
          chassisId: payload.chassisId,
          balanceVersionId: payload.balanceVersionId,
          lapTimeMs: Math.round(payload.lapTimeMs),
          sectorTimesMs: payload.sectorTimesMs.map((s) => Math.round(s)),
          peakSpeedKph: payload.peakSpeedKph,
          pwrRatio: payload.pwrRatio,
          isAiAssisted: payload.isAiAssisted,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { credits: number; creditsAwarded: number };
        this.state.credits = data.credits;
        await this.idbPut('garage', this.state);
        this.events.emit('economy:updated', {
          credits: this.state.credits,
          ownedPartIds: this.state.ownedPartIds,
        });
        return { creditsAwarded: data.creditsAwarded };
      }
    } catch {
      // Fallback credit award locally if offline
    }

    this.state.credits += localReward;
    await this.idbPut('garage', this.state);
    this.events.emit('economy:updated', {
      credits: this.state.credits,
      ownedPartIds: this.state.ownedPartIds,
    });
    return { creditsAwarded: localReward };
  }

  public async fetchLeaderboard(
    trackId: string,
    balanceVersionId?: string
  ): Promise<ILapLeaderboardEntry[]> {
    try {
      const qs = new URLSearchParams({ trackId });
      if (balanceVersionId) qs.set('version', balanceVersionId);
      const res = await fetch(`/api/laps?${qs.toString()}`, { credentials: 'include' });
      if (!res.ok) return [];
      const data = (await res.json()) as { records: ILapLeaderboardEntry[] };
      return data.records ?? [];
    } catch {
      return [];
    }
  }
}
