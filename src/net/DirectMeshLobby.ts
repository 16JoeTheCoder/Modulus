import {
  computeJitterMs,
  isHostAuthorityValid,
  makeLinkKey,
  percentile,
  selectHostAndBackup,
} from './hostSelection';
import {
  buildDirectOnlyRtcConfig,
  generateUnpredictableId,
  inspectPeerConnectionDirectPath,
  LOBBY_PROTOCOL_VERSION,
  parseLobbyMessage,
  PeerRateLimiter,
} from './protocol';
import { PeerJsCloudSignalingAdapter } from './signaling/PeerJsCloudSignalingAdapter';
import {
  DEFAULT_CLOUDFLARE_STUN_URL,
  MAX_FRIEND_ROOM_PARTICIPANTS,
  type IDirectPathInspection,
  type IFriendRoomState,
  type IHostSelectionDecision,
  type IPeerLinkMeasurement,
  type ISignalingAdapter,
  type ISignalingSignal,
  type LobbyMessage,
} from './types';

export interface IDirectMeshLobbyOptions {
  displayName: string;
  signaling?: ISignalingAdapter;
  stunUrls?: readonly string[];
  /** Optional local 4-car physics benchmark median frame time (ms) */
  benchMedianMs?: number;
  /** Interval for host heartbeats (ms) */
  heartbeatIntervalMs?: number;
  /** Time without host heartbeat before host_interrupted triggers (ms) */
  hostTimeoutMs?: number;
}

interface PeerLinkContext {
  remotePeerId: string;
  pc: RTCPeerConnection;
  reliable: RTCDataChannel | null;
  unreliable: RTCDataChannel | null;
  pendingIceCandidates: RTCIceCandidateInit[];
  remoteDescriptionSet: boolean;
  initiator: boolean;
  connected: boolean;
  directPath: IDirectPathInspection | null;
  openWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }>;
}

interface PendingProbeTracker {
  probeId: string;
  remotePeerId: string;
  probesSent: number;
  sentAtBySeq: Map<number, number>;
  rttsMs: number[];
}

export type LobbyStateListener = (state: IFriendRoomState) => void;
export type LobbyLogListener = (entry: { timeMs: number; level: 'info' | 'warn' | 'error'; text: string }) => void;

/**
 * Direct-only 4-peer WebRTC Private Lobby Controller for Friend Race.
 * - Uses PeerJS Cloud signaling behind ISignalingAdapter (swappable).
 * - Enforces Cloudflare STUN only with TURN strictly disabled ($0 relay).
 * - Friend Race is strictly private and unranked; Time Trial owns PBs and ghosts.
 * - Supports 6-link mesh probing, steadiest-worst-link host + backup election,
 *   pre-countdown host override, and between-race backup recovery with monotonic authorityEpoch.
 */
export class DirectMeshLobby {
  public readonly signaling: ISignalingAdapter;

  private readonly displayName: string;
  private readonly rtcConfig: RTCConfiguration;
  private readonly benchMedianMs?: number;
  private readonly heartbeatIntervalMs: number;
  private readonly hostTimeoutMs: number;
  private readonly rateLimiter = new PeerRateLimiter(60, 1000);

  private readonly peers = new Map<string, PeerLinkContext>();
  private readonly activeProbes = new Map<string, PendingProbeTracker>();
  private readonly stateListeners = new Set<LobbyStateListener>();
  private readonly logListeners = new Set<LobbyLogListener>();

  private unsubSignal: (() => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private hostWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastHostSeenMs = 0;
  private joinWaiter: {
    resolve: (state: IFriendRoomState) => void;
    reject: (err: Error) => void;
  } | null = null;

  private state: IFriendRoomState;

  constructor(options: IDirectMeshLobbyOptions) {
    this.displayName = options.displayName.trim().slice(0, 32) || 'Driver';
    this.signaling = options.signaling ?? new PeerJsCloudSignalingAdapter();
    this.rtcConfig = buildDirectOnlyRtcConfig(options.stunUrls ?? [DEFAULT_CLOUDFLARE_STUN_URL]);
    this.benchMedianMs = options.benchMedianMs;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 1000;
    this.hostTimeoutMs = options.hostTimeoutMs ?? 3500;

    this.state = {
      mode: 'friend_race',
      ranked: false,
      eligibleForTimeTrialRecords: false,
      maxParticipants: MAX_FRIEND_ROOM_PARTICIPANTS,
      roomId: '',
      sessionId: '',
      trackId: 'track_switchyard_sprint',
      phase: 'idle',
      localPeerId: this.signaling.peerId,
      hostPeerId: null,
      backupHostPeerId: null,
      authorityEpoch: 0,
      manualHostOverride: false,
      restartRaceOffered: false,
      members: [],
      linkMatrix: {},
      lastHostDecision: null,
      staleHostMessagesIgnored: 0,
      rejectedJoinAttempts: 0,
    };
  }

  public getState(): IFriendRoomState {
    return {
      ...this.state,
      members: this.state.members.map((m) => ({ ...m })),
      linkMatrix: { ...this.state.linkMatrix },
    };
  }

  public getRtcConfig(): RTCConfiguration {
    return this.rtcConfig;
  }

  public onStateChange(listener: LobbyStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public onLog(listener: LobbyLogListener): () => void {
    this.logListeners.add(listener);
    return () => {
      this.logListeners.delete(listener);
    };
  }

  private emitState(): void {
    const snap = this.getState();
    for (const listener of Array.from(this.stateListeners)) {
      listener(snap);
    }
  }

  private log(level: 'info' | 'warn' | 'error', text: string): void {
    const entry = { timeMs: Date.now(), level, text };
    for (const listener of Array.from(this.logListeners)) {
      listener(entry);
    }
  }

  private async ensureSignalingConnected(): Promise<string> {
    if (!this.unsubSignal) {
      this.unsubSignal = this.signaling.onSignal((sig) => {
        void this.handleSignalingSignal(sig);
      });
    }
    const peerId = await this.signaling.connect();
    this.state.localPeerId = peerId;
    return peerId;
  }

  /**
   * Creates a new invite-only private room with an unpredictable roomId and a
   * separate sessionId (decoupled from hostPeerId so host migration preserves sessionId).
   */
  public async createRoom(trackId = 'track_switchyard_sprint'): Promise<{
    roomId: string;
    sessionId: string;
    entryPeerId: string;
  }> {
    const localPeerId = await this.ensureSignalingConnected();
    const roomId = generateUnpredictableId('room', 12);
    const sessionId = generateUnpredictableId('sess', 12);

    this.state.roomId = roomId;
    this.state.sessionId = sessionId;
    this.state.trackId = trackId;
    this.state.phase = 'lobby';
    this.state.hostPeerId = localPeerId;
    this.state.backupHostPeerId = null;
    this.state.authorityEpoch = 1;
    this.state.manualHostOverride = false;
    this.state.restartRaceOffered = false;
    this.state.members = [
      {
        peerId: localPeerId,
        displayName: this.displayName,
        slotIndex: 0,
        joinedAtMs: Date.now(),
        ready: true,
        connected: true,
        benchMedianMs: this.benchMedianMs,
      },
    ];
    this.state.linkMatrix = {};
    this.state.lastHostDecision = null;
    this.lastHostSeenMs = Date.now();

    this.startTimers();
    this.log('info', `Created private room ${roomId} (session ${sessionId}, epoch 1)`);
    this.emitState();

    return { roomId, sessionId, entryPeerId: localPeerId };
  }

  /**
   * Joins an existing private invite room via an entryPeerId (host or active member).
   * Rejects cleanly if the room already has 4 participants.
   */
  public async joinRoom(
    roomId: string,
    entryPeerId: string,
    timeoutMs = 15_000
  ): Promise<IFriendRoomState> {
    const localPeerId = await this.ensureSignalingConnected();
    this.state.roomId = roomId;
    this.state.phase = 'joining';
    this.emitState();

    const ctx = this.getOrCreatePeerContext(entryPeerId, true);
    await this.initiateOffer(ctx);
    await this.waitForReliableChannel(ctx, timeoutMs);

    return new Promise<IFriendRoomState>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.joinWaiter) {
          this.joinWaiter = null;
          reject(new Error(`Timed out waiting for join-accept from ${entryPeerId}`));
        }
      }, timeoutMs);

      this.joinWaiter = {
        resolve: (acceptedState) => {
          clearTimeout(timer);
          resolve(acceptedState);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };

      this.sendToPeer(entryPeerId, {
        type: 'lobby:join-request',
        roomId,
        peerId: localPeerId,
        displayName: this.displayName,
        protocolVersion: LOBBY_PROTOCOL_VERSION,
      });
    });
  }

  /**
   * Probes every connected peer link from this node (application-level RTT, p95,
   * jitter, packet loss over the unreliable channel + RTCPeerConnection.getStats()
   * direct-vs-relay check), shares the link report with the mesh, and triggers host
   * election if this node is the current host.
   */
  public async runLocalLinkProbes(
    probeCount = 10,
    intervalMs = 25,
    settleWaitMs = 220
  ): Promise<IPeerLinkMeasurement[]> {
    const otherMembers = this.state.members.filter(
      (m) => m.connected && m.peerId !== this.state.localPeerId
    );
    const results: IPeerLinkMeasurement[] = [];

    const tasks = otherMembers.map((member) =>
      this.probeSinglePeer(member.peerId, probeCount, intervalMs, settleWaitMs)
    );
    const measurements = await Promise.all(tasks);
    for (const m of measurements) {
      results.push(m);
      this.state.linkMatrix[makeLinkKey(m.fromPeerId, m.toPeerId)] = m;
    }

    const report: LobbyMessage = {
      type: 'lobby:link-report',
      roomId: this.state.roomId,
      fromPeerId: this.state.localPeerId,
      benchMedianMs: this.benchMedianMs,
      links: results,
    };
    this.broadcastReliable(report);

    this.emitState();
    return results;
  }

  /**
   * Runs host + backup election on the currently collected mesh link matrix
   * (up to 6 peer links for 4 peers). Only the current host commits and broadcasts
   * the authoritative decision.
   */
  public evaluateAndElectHost(manualOverridePeerId?: string | null): IHostSelectionDecision | null {
    if (this.state.hostPeerId !== this.state.localPeerId) {
      return null;
    }

    const decision = selectHostAndBackup(this.state.members, this.state.linkMatrix, {
      authorityEpoch: this.state.authorityEpoch,
      manualOverridePeerId: manualOverridePeerId ?? null,
    });

    if (!decision) return null;

    const hostChanged = decision.hostPeerId !== this.state.hostPeerId;
    const nextEpoch = hostChanged ? this.state.authorityEpoch + 1 : this.state.authorityEpoch;
    const finalized: IHostSelectionDecision = {
      ...decision,
      authorityEpoch: nextEpoch,
    };

    this.state.hostPeerId = finalized.hostPeerId;
    this.state.backupHostPeerId = finalized.backupHostPeerId;
    this.state.authorityEpoch = nextEpoch;
    this.state.manualHostOverride = finalized.manualOverride;
    this.state.lastHostDecision = finalized;
    this.state.phase = 'lobby';

    this.log(
      'info',
      `Host elected: ${finalized.hostPeerId} (backup: ${finalized.backupHostPeerId ?? 'none'}, epoch ${nextEpoch}) — ${finalized.reason}`
    );

    // Outgoing host must still broadcast the finalized roster/handoff to all peers
    this.broadcastRosterSync(true);
    this.emitState();
    return finalized;
  }

  /**
   * Explicit pre-countdown host override. Any member can request it; the active host
   * validates eligibility and bumps authorityEpoch if the host changes.
   */
  public requestHostOverride(targetPeerId: string): boolean {
    if (this.state.phase === 'racing' || this.state.phase === 'countdown') {
      return false;
    }
    if (this.state.hostPeerId === this.state.localPeerId) {
      const decision = this.evaluateAndElectHost(targetPeerId);
      return decision?.hostPeerId === targetPeerId;
    }
    if (this.state.hostPeerId) {
      this.sendToPeer(this.state.hostPeerId, {
        type: 'lobby:host-override',
        roomId: this.state.roomId,
        authorityEpoch: this.state.authorityEpoch,
        requestedHostPeerId: targetPeerId,
      });
      return true;
    }
    return false;
  }

  /**
   * Between-race host recovery: lets the designated backup host claim authority when
   * the current host drops, bumping authorityEpoch so clients reject stale messages
   * from the old host and offering "Restart race" with preserved membership + track.
   */
  public claimHostAsBackup(): boolean {
    const isDesignatedBackup = this.state.backupHostPeerId === this.state.localPeerId;
    const hostDisconnected =
      !this.state.hostPeerId ||
      this.state.phase === 'host_interrupted' ||
      !this.isPeerConnected(this.state.hostPeerId);

    if (!isDesignatedBackup && !hostDisconnected) {
      return false;
    }

    const previousHost = this.state.hostPeerId;
    const nextEpoch = this.state.authorityEpoch + 1;

    // Remove or mark previous host disconnected while keeping remaining members + track + sessionId
    const remainingMembers = this.state.members
      .filter((m) => m.peerId !== previousHost && (m.peerId === this.state.localPeerId || this.isPeerConnected(m.peerId)))
      .map((m) => ({ ...m, connected: true }));

    const nextBackup =
      remainingMembers.find((m) => m.peerId !== this.state.localPeerId)?.peerId ?? null;

    this.state.hostPeerId = this.state.localPeerId;
    this.state.backupHostPeerId = nextBackup;
    this.state.authorityEpoch = nextEpoch;
    this.state.members = remainingMembers;
    this.state.restartRaceOffered = true;
    this.state.phase = 'recovered_ready';
    this.lastHostSeenMs = Date.now();

    const claimMsg: LobbyMessage = {
      type: 'lobby:host-claim',
      roomId: this.state.roomId,
      sessionId: this.state.sessionId,
      newHostPeerId: this.state.localPeerId,
      newBackupHostPeerId: nextBackup,
      authorityEpoch: nextEpoch,
      previousHostPeerId: previousHost,
      trackId: this.state.trackId,
      members: remainingMembers,
      restartRaceOffered: true,
    };

    this.broadcastReliable(claimMsg);
    this.broadcastRosterSync();
    this.log(
      'warn',
      `Backup ${this.state.localPeerId} claimed lobby authority (epoch ${nextEpoch}); Restart Race offered`
    );
    this.emitState();
    return true;
  }

  /**
   * Utility for testing stale-authority rejection: injects or sends a message with an
   * explicit epoch (e.g., an old host returning with a lower authorityEpoch).
   */
  public injectMessageForTest(fromPeerId: string, message: LobbyMessage): void {
    this.handleLobbyMessage(fromPeerId, message);
  }

  public getConnectedPeerIds(): string[] {
    const out: string[] = [];
    for (const [peerId, ctx] of this.peers) {
      if (ctx.connected && ctx.reliable?.readyState === 'open') {
        out.push(peerId);
      }
    }
    return out;
  }

  public async inspectAllDirectPaths(): Promise<Record<string, IDirectPathInspection>> {
    const out: Record<string, IDirectPathInspection> = {};
    for (const [peerId, ctx] of this.peers) {
      if (ctx.pc.connectionState !== 'closed') {
        const info = await inspectPeerConnectionDirectPath(ctx.pc);
        ctx.directPath = info;
        out[peerId] = info;
      }
    }
    return out;
  }

  public isPeerConnected(peerId: string): boolean {
    if (peerId === this.state.localPeerId) return true;
    const ctx = this.peers.get(peerId);
    return Boolean(ctx && ctx.connected && ctx.reliable?.readyState === 'open');
  }

  /**
   * Cleanly leaves the room and tears down all WebRTC peer connections + signaling.
   */
  public leave(reason = 'User left'): void {
    if (this.state.roomId) {
      this.broadcastReliable({
        type: 'lobby:leave',
        roomId: this.state.roomId,
        peerId: this.state.localPeerId,
        reason,
      });
    }
    this.dispose();
  }

  /**
   * Abruptly severs all peer connections & signaling WITHOUT sending lobby:leave,
   * used to simulate a sudden host crash / network drop in recovery tests.
   */
  public simulateAbruptDisconnect(): void {
    this.dispose();
  }

  public dispose(): void {
    this.stopTimers();
    this.unsubSignal?.();
    this.unsubSignal = null;

    for (const ctx of this.peers.values()) {
      this.closePeerContext(ctx);
    }
    this.peers.clear();
    this.activeProbes.clear();
    this.rateLimiter.clear();
    this.signaling.disconnect();
    this.state.phase = 'idle';
    this.emitState();
  }

  // --- Internal WebRTC Mesh & Signaling ---

  private getOrCreatePeerContext(remotePeerId: string, initiator: boolean): PeerLinkContext {
    const existing = this.peers.get(remotePeerId);
    if (existing && existing.pc.connectionState !== 'closed' && existing.pc.connectionState !== 'failed') {
      return existing;
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    const ctx: PeerLinkContext = {
      remotePeerId,
      pc,
      reliable: null,
      unreliable: null,
      pendingIceCandidates: [],
      remoteDescriptionSet: false,
      initiator,
      connected: false,
      directPath: null,
      openWaiters: [],
    };
    this.peers.set(remotePeerId, ctx);

    pc.onicecandidate = (event) => {
      if (!event.candidate || !event.candidate.candidate) return;
      this.signaling.send(remotePeerId, 'CANDIDATE', {
        candidate: event.candidate.toJSON(),
        roomId: this.state.roomId,
      });
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      if (iceState === 'connected' || iceState === 'completed') {
        ctx.connected = true;
        void inspectPeerConnectionDirectPath(pc).then((info) => {
          ctx.directPath = info;
          if (info.isRelayed) {
            this.log('error', `Relayed TURN candidate detected on ${remotePeerId}; direct-only policy violated`);
            this.closePeerContext(ctx);
            this.peers.delete(remotePeerId);
          }
        });
      } else if (iceState === 'failed' || iceState === 'closed' || iceState === 'disconnected') {
        if (iceState !== 'disconnected') {
          this.handlePeerDisconnected(remotePeerId);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.handlePeerDisconnected(remotePeerId);
      }
    };

    if (initiator) {
      const reliable = pc.createDataChannel('modulus-reliable', { ordered: true });
      const unreliable = pc.createDataChannel('modulus-unreliable', {
        ordered: false,
        maxRetransmits: 0,
      });
      this.attachDataChannel(ctx, reliable, true);
      this.attachDataChannel(ctx, unreliable, false);
    } else {
      pc.ondatachannel = (event) => {
        const ch = event.channel;
        if (ch.label === 'modulus-unreliable') {
          this.attachDataChannel(ctx, ch, false);
        } else {
          this.attachDataChannel(ctx, ch, true);
        }
      };
    }

    return ctx;
  }

  private attachDataChannel(ctx: PeerLinkContext, channel: RTCDataChannel, isReliable: boolean): void {
    if (isReliable) {
      ctx.reliable = channel;
    } else {
      ctx.unreliable = channel;
    }

    channel.onopen = () => {
      if (isReliable) {
        ctx.connected = true;
        const waiters = ctx.openWaiters.splice(0, ctx.openWaiters.length);
        for (const w of waiters) w.resolve();
        this.emitState();
      }
    };

    channel.onclose = () => {
      if (isReliable) {
        this.handlePeerDisconnected(ctx.remotePeerId);
      }
    };

    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      if (!this.rateLimiter.allow(ctx.remotePeerId)) {
        return;
      }
      const msg = parseLobbyMessage(event.data);
      if (!msg) return;
      this.handleLobbyMessage(ctx.remotePeerId, msg);
    };
  }

  private async initiateOffer(ctx: PeerLinkContext): Promise<void> {
    if (ctx.pc.signalingState !== 'stable') return;
    const offer = await ctx.pc.createOffer();
    await ctx.pc.setLocalDescription(offer);
    this.signaling.send(ctx.remotePeerId, 'OFFER', {
      sdp: { type: offer.type, sdp: offer.sdp },
      roomId: this.state.roomId,
      connectionId: `dc_${this.state.localPeerId}_${ctx.remotePeerId}`,
      type: 'data',
    });
  }

  private async handleSignalingSignal(signal: ISignalingSignal): Promise<void> {
    const payload = signal.payload ?? {};
    const remotePeerId = signal.src;
    if (!remotePeerId || remotePeerId === this.state.localPeerId) return;

    if (signal.type === 'OFFER') {
      const sdp = payload.sdp as RTCSessionDescriptionInit | undefined;
      if (!sdp?.sdp || sdp.type !== 'offer') return;

      // Glare handling: if we already initiated an offer, polite peer (lexicographically larger ID) yields
      const existing = this.peers.get(remotePeerId);
      if (existing && existing.pc.signalingState !== 'stable') {
        const isPolite = this.state.localPeerId.localeCompare(remotePeerId) > 0;
        if (!isPolite) {
          return;
        }
        this.closePeerContext(existing);
        this.peers.delete(remotePeerId);
      }

      const ctx = this.getOrCreatePeerContext(remotePeerId, false);
      await ctx.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      ctx.remoteDescriptionSet = true;
      await this.flushPendingIceCandidates(ctx);

      const answer = await ctx.pc.createAnswer();
      await ctx.pc.setLocalDescription(answer);
      this.signaling.send(remotePeerId, 'ANSWER', {
        sdp: { type: answer.type, sdp: answer.sdp },
        roomId: this.state.roomId,
        connectionId: payload.connectionId ?? `dc_${remotePeerId}_${this.state.localPeerId}`,
        type: 'data',
      });
      return;
    }

    if (signal.type === 'ANSWER') {
      const sdp = payload.sdp as RTCSessionDescriptionInit | undefined;
      if (!sdp?.sdp || sdp.type !== 'answer') return;
      const ctx = this.peers.get(remotePeerId);
      if (!ctx || ctx.pc.signalingState !== 'have-local-offer') return;
      await ctx.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      ctx.remoteDescriptionSet = true;
      await this.flushPendingIceCandidates(ctx);
      return;
    }

    if (signal.type === 'CANDIDATE') {
      const cand = payload.candidate as RTCIceCandidateInit | undefined;
      if (!cand?.candidate) return;
      const ctx = this.peers.get(remotePeerId);
      if (!ctx) return;
      if (ctx.remoteDescriptionSet) {
        try {
          await ctx.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {
          // Ignore stale/duplicate ICE candidates
        }
      } else {
        ctx.pendingIceCandidates.push(cand);
      }
      return;
    }

    if (signal.type === 'LEAVE') {
      this.handlePeerDisconnected(remotePeerId);
    }
  }

  private async flushPendingIceCandidates(ctx: PeerLinkContext): Promise<void> {
    const queued = ctx.pendingIceCandidates.splice(0, ctx.pendingIceCandidates.length);
    for (const cand of queued) {
      try {
        await ctx.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        // Ignore stale candidates
      }
    }
  }

  private waitForReliableChannel(ctx: PeerLinkContext, timeoutMs: number): Promise<void> {
    if (ctx.reliable?.readyState === 'open') {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`WebRTC data channel to ${ctx.remotePeerId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      ctx.openWaiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  private ensureFullMeshConnections(): void {
    for (const member of this.state.members) {
      if (!member.connected || member.peerId === this.state.localPeerId) continue;
      if (this.peers.has(member.peerId)) continue;

      // Deterministic glare avoidance: lexicographically smaller peerId initiates the mesh link
      const shouldInitiate = this.state.localPeerId.localeCompare(member.peerId) < 0;
      if (shouldInitiate) {
        const ctx = this.getOrCreatePeerContext(member.peerId, true);
        void this.initiateOffer(ctx);
      }
    }
  }

  // --- Lobby Message Handling ---

  private handleLobbyMessage(fromPeerId: string, msg: LobbyMessage): void {
    if (msg.type === 'lobby:join-request') {
      this.handleJoinRequest(fromPeerId, msg);
      return;
    }

    if (msg.roomId !== this.state.roomId) {
      return;
    }

    switch (msg.type) {
      case 'lobby:join-accept': {
        this.state.sessionId = msg.sessionId;
        this.state.hostPeerId = msg.hostPeerId;
        this.state.backupHostPeerId = msg.backupHostPeerId;
        this.state.authorityEpoch = msg.authorityEpoch;
        this.state.trackId = msg.trackId;
        this.state.members = msg.members;
        this.state.phase = 'lobby';
        this.lastHostSeenMs = Date.now();
        this.startTimers();
        this.ensureFullMeshConnections();
        this.emitState();
        if (this.joinWaiter) {
          const waiter = this.joinWaiter;
          this.joinWaiter = null;
          waiter.resolve(this.getState());
        }
        break;
      }

      case 'lobby:join-reject': {
        this.state.phase = 'idle';
        this.emitState();
        if (this.joinWaiter) {
          const waiter = this.joinWaiter;
          this.joinWaiter = null;
          waiter.reject(new Error(`Join rejected (${msg.reason})${msg.detail ? `: ${msg.detail}` : ''}`));
        }
        this.dispose();
        break;
      }

      case 'lobby:roster-sync': {
        if (
          !isHostAuthorityValid(
            this.state.authorityEpoch,
            this.state.hostPeerId,
            msg.authorityEpoch,
            msg.hostPeerId
          )
        ) {
          this.state.staleHostMessagesIgnored++;
          this.log(
            'warn',
            `Ignored stale roster-sync from ${fromPeerId} (epoch ${msg.authorityEpoch} < ${this.state.authorityEpoch})`
          );
          this.emitState();
          return;
        }
        this.state.sessionId = msg.sessionId;
        this.state.authorityEpoch = msg.authorityEpoch;
        this.state.hostPeerId = msg.hostPeerId;
        this.state.backupHostPeerId = msg.backupHostPeerId;
        this.state.manualHostOverride = msg.manualHostOverride;
        this.state.trackId = msg.trackId;
        this.state.phase = msg.phase;
        this.state.restartRaceOffered = msg.restartRaceOffered;
        this.state.members = msg.members;
        if (msg.hostDecision !== undefined) {
          this.state.lastHostDecision = msg.hostDecision ?? null;
        }
        this.lastHostSeenMs = Date.now();
        this.ensureFullMeshConnections();
        this.emitState();
        break;
      }

      case 'lobby:host-claim': {
        if (msg.authorityEpoch <= this.state.authorityEpoch) {
          this.state.staleHostMessagesIgnored++;
          this.emitState();
          return;
        }
        this.state.sessionId = msg.sessionId;
        this.state.hostPeerId = msg.newHostPeerId;
        this.state.backupHostPeerId = msg.newBackupHostPeerId;
        this.state.authorityEpoch = msg.authorityEpoch;
        this.state.trackId = msg.trackId;
        this.state.members = msg.members;
        this.state.restartRaceOffered = msg.restartRaceOffered;
        this.state.phase = 'recovered_ready';
        this.lastHostSeenMs = Date.now();
        this.log(
          'info',
          `Accepted new host ${msg.newHostPeerId} at epoch ${msg.authorityEpoch} (previous: ${msg.previousHostPeerId ?? 'none'})`
        );
        this.emitState();
        break;
      }

      case 'lobby:host-heartbeat': {
        if (
          !isHostAuthorityValid(
            this.state.authorityEpoch,
            this.state.hostPeerId,
            msg.authorityEpoch,
            msg.hostPeerId
          )
        ) {
          this.state.staleHostMessagesIgnored++;
          this.emitState();
          return;
        }
        this.lastHostSeenMs = Date.now();
        break;
      }

      case 'lobby:host-override': {
        if (this.state.hostPeerId === this.state.localPeerId) {
          this.evaluateAndElectHost(msg.requestedHostPeerId);
        }
        break;
      }

      case 'lobby:probe-ping': {
        this.sendToPeer(
          fromPeerId,
          {
            type: 'lobby:probe-pong',
            roomId: this.state.roomId,
            probeId: msg.probeId,
            seq: msg.seq,
            sentAtMs: msg.sentAtMs,
          },
          true
        );
        break;
      }

      case 'lobby:probe-pong': {
        const tracker = this.activeProbes.get(msg.probeId);
        if (!tracker || tracker.remotePeerId !== fromPeerId) return;
        const sentAt = tracker.sentAtBySeq.get(msg.seq);
        if (sentAt !== undefined) {
          const rtt = Math.max(0, performance.now() - sentAt);
          tracker.rttsMs.push(rtt);
          tracker.sentAtBySeq.delete(msg.seq);
        }
        break;
      }

      case 'lobby:link-report': {
        if (msg.fromPeerId !== fromPeerId) return;
        for (const link of msg.links) {
          if (link.fromPeerId !== fromPeerId) continue;
          this.state.linkMatrix[makeLinkKey(link.fromPeerId, link.toPeerId)] = link;
        }
        if (typeof msg.benchMedianMs === 'number') {
          const member = this.state.members.find((m) => m.peerId === fromPeerId);
          if (member) member.benchMedianMs = msg.benchMedianMs;
        }
        this.emitState();
        break;
      }

      case 'lobby:leave': {
        if (msg.peerId === fromPeerId) {
          this.handlePeerDisconnected(fromPeerId);
        }
        break;
      }
    }
  }

  private handleJoinRequest(
    fromPeerId: string,
    msg: Extract<LobbyMessage, { type: 'lobby:join-request' }>
  ): void {
    if (this.state.hostPeerId !== this.state.localPeerId) {
      return;
    }

    if (msg.roomId !== this.state.roomId) {
      this.state.rejectedJoinAttempts++;
      this.sendToPeer(fromPeerId, {
        type: 'lobby:join-reject',
        roomId: msg.roomId,
        reason: 'wrong_room',
      });
      this.closePeerByIdSoon(fromPeerId);
      this.emitState();
      return;
    }

    if (msg.protocolVersion !== LOBBY_PROTOCOL_VERSION) {
      this.state.rejectedJoinAttempts++;
      this.sendToPeer(fromPeerId, {
        type: 'lobby:join-reject',
        roomId: this.state.roomId,
        reason: 'protocol_mismatch',
      });
      this.closePeerByIdSoon(fromPeerId);
      this.emitState();
      return;
    }

    const existing = this.state.members.find((m) => m.peerId === fromPeerId);
    if (!existing && this.state.members.length >= MAX_FRIEND_ROOM_PARTICIPANTS) {
      this.state.rejectedJoinAttempts++;
      this.log('warn', `Rejected ${fromPeerId} (${msg.displayName}): room full (4/4)`);
      this.sendToPeer(fromPeerId, {
        type: 'lobby:join-reject',
        roomId: this.state.roomId,
        reason: 'room_full',
        detail: `Private Friend Race is capped at ${MAX_FRIEND_ROOM_PARTICIPANTS} participants`,
      });
      this.closePeerByIdSoon(fromPeerId);
      this.emitState();
      return;
    }

    if (!existing) {
      const usedSlots = new Set(this.state.members.map((m) => m.slotIndex));
      let nextSlot = 0;
      while (usedSlots.has(nextSlot) && nextSlot < MAX_FRIEND_ROOM_PARTICIPANTS) {
        nextSlot++;
      }
      this.state.members.push({
        peerId: fromPeerId,
        displayName: msg.displayName,
        slotIndex: nextSlot,
        joinedAtMs: Date.now(),
        ready: true,
        connected: true,
      });
    } else {
      existing.connected = true;
      existing.displayName = msg.displayName;
    }

    if (!this.state.backupHostPeerId) {
      const backupCandidate = this.state.members.find((m) => m.peerId !== this.state.hostPeerId);
      this.state.backupHostPeerId = backupCandidate?.peerId ?? null;
    }

    this.sendToPeer(fromPeerId, {
      type: 'lobby:join-accept',
      roomId: this.state.roomId,
      sessionId: this.state.sessionId,
      authorityEpoch: this.state.authorityEpoch,
      hostPeerId: this.state.hostPeerId,
      backupHostPeerId: this.state.backupHostPeerId,
      trackId: this.state.trackId,
      members: this.state.members,
    });

    this.broadcastRosterSync();
    this.emitState();
  }

  private async probeSinglePeer(
    remotePeerId: string,
    probeCount: number,
    intervalMs: number,
    settleWaitMs: number
  ): Promise<IPeerLinkMeasurement> {
    const ctx = this.peers.get(remotePeerId);
    if (!ctx || !ctx.connected || ctx.reliable?.readyState !== 'open') {
      return {
        fromPeerId: this.state.localPeerId,
        toPeerId: remotePeerId,
        reachable: false,
        probesSent: probeCount,
        probesReceived: 0,
        packetLossPct: 100,
        rttMedianMs: 9999,
        rttP95Ms: 9999,
        rttMaxMs: 9999,
        jitterMs: 9999,
        icePathClass: 'unknown',
        isDirect: false,
        isRelayed: false,
        measuredAtMs: Date.now(),
      };
    }

    const probeId = generateUnpredictableId('prb', 6);
    const tracker: PendingProbeTracker = {
      probeId,
      remotePeerId,
      probesSent: probeCount,
      sentAtBySeq: new Map(),
      rttsMs: [],
    };
    this.activeProbes.set(probeId, tracker);

    for (let seq = 0; seq < probeCount; seq++) {
      const nowPerf = performance.now();
      tracker.sentAtBySeq.set(seq, nowPerf);
      this.sendToPeer(
        remotePeerId,
        {
          type: 'lobby:probe-ping',
          roomId: this.state.roomId,
          probeId,
          seq,
          sentAtMs: Date.now(),
        },
        true
      );
      if (seq + 1 < probeCount) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }

    await new Promise((r) => setTimeout(r, settleWaitMs));
    this.activeProbes.delete(probeId);

    const pathInfo = await inspectPeerConnectionDirectPath(ctx.pc);
    ctx.directPath = pathInfo;

    const received = tracker.rttsMs.length;
    const lossPct = Math.round(((probeCount - received) / Math.max(1, probeCount)) * 10000) / 100;
    const reachable = received > 0;

    return {
      fromPeerId: this.state.localPeerId,
      toPeerId: remotePeerId,
      reachable,
      probesSent: probeCount,
      probesReceived: received,
      packetLossPct: lossPct,
      rttMedianMs: reachable ? percentile(tracker.rttsMs, 0.5) : 9999,
      rttP95Ms: reachable ? percentile(tracker.rttsMs, 0.95) : 9999,
      rttMaxMs: reachable ? Math.round(Math.max(...tracker.rttsMs) * 100) / 100 : 9999,
      jitterMs: reachable ? computeJitterMs(tracker.rttsMs) : 9999,
      icePathClass: pathInfo.icePathClass,
      isDirect: pathInfo.isDirect,
      isRelayed: pathInfo.isRelayed,
      measuredAtMs: Date.now(),
    };
  }

  private handlePeerDisconnected(remotePeerId: string): void {
    const ctx = this.peers.get(remotePeerId);
    if (ctx) {
      this.closePeerContext(ctx);
      this.peers.delete(remotePeerId);
    }

    const member = this.state.members.find((m) => m.peerId === remotePeerId);
    if (!member) return;

    if (this.state.hostPeerId === this.state.localPeerId) {
      // Host removes disconnected guest and re-syncs roster
      this.state.members = this.state.members.filter((m) => m.peerId !== remotePeerId);
      if (this.state.backupHostPeerId === remotePeerId) {
        const nextBackup = this.state.members.find((m) => m.peerId !== this.state.localPeerId);
        this.state.backupHostPeerId = nextBackup?.peerId ?? null;
      }
      this.broadcastRosterSync();
      this.emitState();
      return;
    }

    // Guest or backup observed the host dropping
    if (remotePeerId === this.state.hostPeerId) {
      member.connected = false;
      this.state.phase = 'host_interrupted';
      this.log('warn', `Host ${remotePeerId} disconnected — lobby paused for backup recovery`);
      this.emitState();
    } else {
      member.connected = false;
      this.emitState();
    }
  }

  private broadcastRosterSync(allowOutgoingHandoff = false): void {
    if (!allowOutgoingHandoff && this.state.hostPeerId !== this.state.localPeerId) return;
    if (!this.state.hostPeerId) return;
    this.broadcastReliable({
      type: 'lobby:roster-sync',
      roomId: this.state.roomId,
      sessionId: this.state.sessionId,
      authorityEpoch: this.state.authorityEpoch,
      hostPeerId: this.state.hostPeerId,
      backupHostPeerId: this.state.backupHostPeerId,
      manualHostOverride: this.state.manualHostOverride,
      trackId: this.state.trackId,
      phase: this.state.phase,
      restartRaceOffered: this.state.restartRaceOffered,
      members: this.state.members,
      hostDecision: this.state.lastHostDecision,
    });
  }

  private broadcastReliable(msg: LobbyMessage): void {
    for (const peerId of this.peers.keys()) {
      this.sendToPeer(peerId, msg, false);
    }
  }

  private sendToPeer(remotePeerId: string, msg: LobbyMessage, preferUnreliable = false): void {
    const ctx = this.peers.get(remotePeerId);
    if (!ctx) return;
    const channel =
      preferUnreliable && ctx.unreliable?.readyState === 'open'
        ? ctx.unreliable
        : ctx.reliable;
    if (!channel || channel.readyState !== 'open') return;
    try {
      channel.send(JSON.stringify(msg));
    } catch {
      // Ignore send on closing channel
    }
  }

  private closePeerByIdSoon(remotePeerId: string): void {
    setTimeout(() => {
      const ctx = this.peers.get(remotePeerId);
      if (ctx) {
        this.closePeerContext(ctx);
        this.peers.delete(remotePeerId);
      }
    }, 150);
  }

  private closePeerContext(ctx: PeerLinkContext): void {
    const waiters = ctx.openWaiters.splice(0, ctx.openWaiters.length);
    for (const w of waiters) {
      w.reject(new Error(`Peer connection to ${ctx.remotePeerId} closed`));
    }
    ctx.connected = false;
    try {
      ctx.reliable?.close();
    } catch {
      // ignore
    }
    try {
      ctx.unreliable?.close();
    } catch {
      // ignore
    }
    try {
      ctx.pc.close();
    } catch {
      // ignore
    }
  }

  private startTimers(): void {
    this.stopTimers();
    this.heartbeatTimer = setInterval(() => {
      if (this.state.hostPeerId === this.state.localPeerId && this.state.roomId) {
        this.broadcastReliable({
          type: 'lobby:host-heartbeat',
          roomId: this.state.roomId,
          sessionId: this.state.sessionId,
          hostPeerId: this.state.localPeerId,
          authorityEpoch: this.state.authorityEpoch,
          sentAtMs: Date.now(),
        });
      }
    }, this.heartbeatIntervalMs);

    this.hostWatchdogTimer = setInterval(() => {
      if (
        this.state.hostPeerId &&
        this.state.hostPeerId !== this.state.localPeerId &&
        this.state.phase !== 'host_interrupted' &&
        this.state.phase !== 'idle' &&
        Date.now() - this.lastHostSeenMs > this.hostTimeoutMs
      ) {
        this.state.phase = 'host_interrupted';
        this.log('warn', `Host ${this.state.hostPeerId} heartbeat timed out`);
        this.emitState();
      }
    }, Math.max(500, Math.floor(this.hostTimeoutMs / 3)));
  }

  private stopTimers(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.hostWatchdogTimer !== null) {
      clearInterval(this.hostWatchdogTimer);
      this.hostWatchdogTimer = null;
    }
  }
}
