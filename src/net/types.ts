/**
 * Private Friend Race & Direct WebRTC Lobby Contracts
 * Friend Race is strictly private and unranked; Time Trial owns personal bests & ghosts.
 */

export const MAX_FRIEND_ROOM_PARTICIPANTS = 4 as const;
export const DEFAULT_CLOUDFLARE_STUN_URL = 'stun:stun.cloudflare.com:3478' as const;

export type SignalingSignalType = 'OFFER' | 'ANSWER' | 'CANDIDATE' | 'LEAVE';

export type SignalingConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'error';

export interface ISignalingSignal {
  type: SignalingSignalType;
  src: string;
  dst: string;
  payload?: Record<string, unknown>;
}

export interface ISignalingAdapter {
  readonly kind: string;
  readonly peerId: string;
  getState(): SignalingConnectionState;
  connect(): Promise<string>;
  send(dst: string, type: SignalingSignalType, payload?: Record<string, unknown>): void;
  onSignal(handler: (signal: ISignalingSignal) => void): () => void;
  onStateChange(handler: (state: SignalingConnectionState, detail?: string) => void): () => void;
  disconnect(): void;
}

export type IceCandidateClass =
  | 'direct_host'
  | 'direct_srflx'
  | 'direct_prflx'
  | 'relayed_turn'
  | 'unknown';

export interface IDirectPathInspection {
  selectedPairId: string | null;
  pairState: string;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  icePathClass: IceCandidateClass;
  isDirect: boolean;
  isRelayed: boolean;
  currentRoundTripTimeMs: number | null;
}

export interface IPeerLinkMeasurement {
  fromPeerId: string;
  toPeerId: string;
  reachable: boolean;
  probesSent: number;
  probesReceived: number;
  packetLossPct: number;
  rttMedianMs: number;
  rttP95Ms: number;
  rttMaxMs: number;
  jitterMs: number;
  icePathClass: IceCandidateClass;
  isDirect: boolean;
  isRelayed: boolean;
  measuredAtMs: number;
}

export interface ILobbyMember {
  peerId: string;
  displayName: string;
  slotIndex: number; // 0..3
  joinedAtMs: number;
  ready: boolean;
  connected: boolean;
  /** Optional local 4-car physics benchmark median frame time (ms); lower is faster */
  benchMedianMs?: number;
}

export interface IHostCandidateScore {
  peerId: string;
  eligible: boolean;
  ineligibleReason?: string;
  reachablePeerCount: number;
  expectedPeerCount: number;
  directLinkCount: number;
  relayedLinkCount: number;
  worstLinkRttP95Ms: number;
  worstLinkLossPct: number;
  worstLinkJitterMs: number;
  /** Lower is steadier/better */
  steadiestWorstScore: number;
  benchMedianMs: number | null;
}

export interface IHostSelectionDecision {
  hostPeerId: string;
  backupHostPeerId: string | null;
  authorityEpoch: number;
  manualOverride: boolean;
  reason: string;
  rankings: IHostCandidateScore[];
}

export type LobbyPhase =
  | 'idle'
  | 'joining'
  | 'lobby'
  | 'probing'
  | 'host_interrupted'
  | 'recovered_ready'
  | 'countdown'
  | 'racing';

export interface IFriendRoomState {
  readonly mode: 'friend_race';
  readonly ranked: false;
  readonly eligibleForTimeTrialRecords: false;
  readonly maxParticipants: typeof MAX_FRIEND_ROOM_PARTICIPANTS;
  roomId: string;
  sessionId: string;
  trackId: string;
  phase: LobbyPhase;
  localPeerId: string;
  hostPeerId: string | null;
  backupHostPeerId: string | null;
  authorityEpoch: number;
  manualHostOverride: boolean;
  restartRaceOffered: boolean;
  members: ILobbyMember[];
  linkMatrix: Record<string, IPeerLinkMeasurement>;
  lastHostDecision: IHostSelectionDecision | null;
  staleHostMessagesIgnored: number;
  rejectedJoinAttempts: number;
}

export type LobbyMessage =
  | {
      type: 'lobby:join-request';
      roomId: string;
      peerId: string;
      displayName: string;
      protocolVersion: number;
    }
  | {
      type: 'lobby:join-accept';
      roomId: string;
      sessionId: string;
      authorityEpoch: number;
      hostPeerId: string;
      backupHostPeerId: string | null;
      trackId: string;
      members: ILobbyMember[];
    }
  | {
      type: 'lobby:join-reject';
      roomId: string;
      reason: 'room_full' | 'wrong_room' | 'rate_limited' | 'protocol_mismatch' | 'relay_not_allowed';
      detail?: string;
    }
  | {
      type: 'lobby:roster-sync';
      roomId: string;
      sessionId: string;
      authorityEpoch: number;
      hostPeerId: string;
      backupHostPeerId: string | null;
      manualHostOverride: boolean;
      trackId: string;
      phase: LobbyPhase;
      restartRaceOffered: boolean;
      members: ILobbyMember[];
      hostDecision?: IHostSelectionDecision | null;
    }
  | {
      type: 'lobby:probe-ping';
      roomId: string;
      probeId: string;
      seq: number;
      sentAtMs: number;
    }
  | {
      type: 'lobby:probe-pong';
      roomId: string;
      probeId: string;
      seq: number;
      sentAtMs: number;
    }
  | {
      type: 'lobby:link-report';
      roomId: string;
      fromPeerId: string;
      benchMedianMs?: number;
      links: IPeerLinkMeasurement[];
    }
  | {
      type: 'lobby:host-claim';
      roomId: string;
      sessionId: string;
      newHostPeerId: string;
      newBackupHostPeerId: string | null;
      authorityEpoch: number;
      previousHostPeerId: string | null;
      trackId: string;
      members: ILobbyMember[];
      restartRaceOffered: boolean;
    }
  | {
      type: 'lobby:host-override';
      roomId: string;
      authorityEpoch: number;
      requestedHostPeerId: string;
    }
  | {
      type: 'lobby:host-heartbeat';
      roomId: string;
      sessionId: string;
      hostPeerId: string;
      authorityEpoch: number;
      sentAtMs: number;
    }
  | {
      type: 'lobby:leave';
      roomId: string;
      peerId: string;
      reason?: string;
    };
