import { z } from 'zod';
import {
  DEFAULT_CLOUDFLARE_STUN_URL,
  MAX_FRIEND_ROOM_PARTICIPANTS,
  type IceCandidateClass,
  type IDirectPathInspection,
  type LobbyMessage,
} from './types';

export const LOBBY_PROTOCOL_VERSION = 1 as const;
export const MAX_LOBBY_MESSAGE_BYTES = 8192 as const;

const PeerIdSchema = z.string().min(4).max(64).regex(/^[A-Za-z0-9_-]+$/);
const RoomIdSchema = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const DisplayNameSchema = z.string().min(1).max(32);

export const LobbyMemberSchema = z.object({
  peerId: PeerIdSchema,
  displayName: DisplayNameSchema,
  slotIndex: z.number().int().min(0).max(MAX_FRIEND_ROOM_PARTICIPANTS - 1),
  joinedAtMs: z.number().finite().nonnegative(),
  ready: z.boolean(),
  connected: z.boolean(),
  benchMedianMs: z.number().finite().nonnegative().max(1000).optional(),
});

export const PeerLinkMeasurementSchema = z.object({
  fromPeerId: PeerIdSchema,
  toPeerId: PeerIdSchema,
  reachable: z.boolean(),
  probesSent: z.number().int().min(0).max(1000),
  probesReceived: z.number().int().min(0).max(1000),
  packetLossPct: z.number().finite().min(0).max(100),
  rttMedianMs: z.number().finite().min(0).max(30_000),
  rttP95Ms: z.number().finite().min(0).max(30_000),
  rttMaxMs: z.number().finite().min(0).max(30_000),
  jitterMs: z.number().finite().min(0).max(30_000),
  icePathClass: z.enum([
    'direct_host',
    'direct_srflx',
    'direct_prflx',
    'relayed_turn',
    'unknown',
  ]),
  isDirect: z.boolean(),
  isRelayed: z.boolean(),
  measuredAtMs: z.number().finite().nonnegative(),
});

const HostCandidateScoreSchema = z.object({
  peerId: PeerIdSchema,
  eligible: z.boolean(),
  ineligibleReason: z.string().max(120).optional(),
  reachablePeerCount: z.number().int().min(0).max(MAX_FRIEND_ROOM_PARTICIPANTS),
  expectedPeerCount: z.number().int().min(0).max(MAX_FRIEND_ROOM_PARTICIPANTS),
  directLinkCount: z.number().int().min(0).max(MAX_FRIEND_ROOM_PARTICIPANTS),
  relayedLinkCount: z.number().int().min(0).max(MAX_FRIEND_ROOM_PARTICIPANTS),
  worstLinkRttP95Ms: z.number().finite().min(0),
  worstLinkLossPct: z.number().finite().min(0).max(100),
  worstLinkJitterMs: z.number().finite().min(0),
  steadiestWorstScore: z.number().finite().min(0),
  benchMedianMs: z.number().finite().nonnegative().nullable(),
});

const HostSelectionDecisionSchema = z.object({
  hostPeerId: PeerIdSchema,
  backupHostPeerId: PeerIdSchema.nullable(),
  authorityEpoch: z.number().int().min(1),
  manualOverride: z.boolean(),
  reason: z.string().max(200),
  rankings: z.array(HostCandidateScoreSchema).max(MAX_FRIEND_ROOM_PARTICIPANTS),
});

const LobbyPhaseSchema = z.enum([
  'idle',
  'joining',
  'lobby',
  'probing',
  'host_interrupted',
  'recovered_ready',
  'countdown',
  'racing',
]);

export const LobbyMessageSchema: z.ZodType<LobbyMessage> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('lobby:join-request'),
    roomId: RoomIdSchema,
    peerId: PeerIdSchema,
    displayName: DisplayNameSchema,
    protocolVersion: z.number().int().min(1).max(100),
  }),
  z.object({
    type: z.literal('lobby:join-accept'),
    roomId: RoomIdSchema,
    sessionId: RoomIdSchema,
    authorityEpoch: z.number().int().min(1),
    hostPeerId: PeerIdSchema,
    backupHostPeerId: PeerIdSchema.nullable(),
    trackId: z.string().min(1).max(80),
    members: z.array(LobbyMemberSchema).min(1).max(MAX_FRIEND_ROOM_PARTICIPANTS),
  }),
  z.object({
    type: z.literal('lobby:join-reject'),
    roomId: RoomIdSchema,
    reason: z.enum([
      'room_full',
      'wrong_room',
      'rate_limited',
      'protocol_mismatch',
      'relay_not_allowed',
    ]),
    detail: z.string().max(160).optional(),
  }),
  z.object({
    type: z.literal('lobby:roster-sync'),
    roomId: RoomIdSchema,
    sessionId: RoomIdSchema,
    authorityEpoch: z.number().int().min(1),
    hostPeerId: PeerIdSchema,
    backupHostPeerId: PeerIdSchema.nullable(),
    manualHostOverride: z.boolean(),
    trackId: z.string().min(1).max(80),
    phase: LobbyPhaseSchema,
    restartRaceOffered: z.boolean(),
    members: z.array(LobbyMemberSchema).min(1).max(MAX_FRIEND_ROOM_PARTICIPANTS),
    hostDecision: HostSelectionDecisionSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal('lobby:probe-ping'),
    roomId: RoomIdSchema,
    probeId: z.string().min(1).max(40),
    seq: z.number().int().min(0).max(10_000),
    sentAtMs: z.number().finite().nonnegative(),
  }),
  z.object({
    type: z.literal('lobby:probe-pong'),
    roomId: RoomIdSchema,
    probeId: z.string().min(1).max(40),
    seq: z.number().int().min(0).max(10_000),
    sentAtMs: z.number().finite().nonnegative(),
  }),
  z.object({
    type: z.literal('lobby:link-report'),
    roomId: RoomIdSchema,
    fromPeerId: PeerIdSchema,
    benchMedianMs: z.number().finite().nonnegative().max(1000).optional(),
    links: z.array(PeerLinkMeasurementSchema).max(MAX_FRIEND_ROOM_PARTICIPANTS),
  }),
  z.object({
    type: z.literal('lobby:host-claim'),
    roomId: RoomIdSchema,
    sessionId: RoomIdSchema,
    newHostPeerId: PeerIdSchema,
    newBackupHostPeerId: PeerIdSchema.nullable(),
    authorityEpoch: z.number().int().min(1),
    previousHostPeerId: PeerIdSchema.nullable(),
    trackId: z.string().min(1).max(80),
    members: z.array(LobbyMemberSchema).min(1).max(MAX_FRIEND_ROOM_PARTICIPANTS),
    restartRaceOffered: z.boolean(),
  }),
  z.object({
    type: z.literal('lobby:host-override'),
    roomId: RoomIdSchema,
    authorityEpoch: z.number().int().min(1),
    requestedHostPeerId: PeerIdSchema,
  }),
  z.object({
    type: z.literal('lobby:host-heartbeat'),
    roomId: RoomIdSchema,
    sessionId: RoomIdSchema,
    hostPeerId: PeerIdSchema,
    authorityEpoch: z.number().int().min(1),
    sentAtMs: z.number().finite().nonnegative(),
  }),
  z.object({
    type: z.literal('lobby:leave'),
    roomId: RoomIdSchema,
    peerId: PeerIdSchema,
    reason: z.string().max(120).optional(),
  }),
]);

export function parseLobbyMessage(raw: string): LobbyMessage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LOBBY_MESSAGE_BYTES) {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = LobbyMessageSchema.safeParse(decoded);
  return result.success ? result.data : null;
}

/**
 * Generates an unpredictable invite-only identifier using Web Crypto CSPRNG.
 * Used separately for roomId (invite token), sessionId (match identity), and peerId.
 */
export function generateUnpredictableId(prefix: string, byteLength = 12): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `${prefix}_${hex}`;
}

/**
 * Hard $0 relay safeguard: builds an RTCConfiguration using ONLY STUN servers
 * (defaults to Cloudflare STUN) and strictly forbids any TURN/TURNS URLs.
 */
export function buildDirectOnlyRtcConfig(
  stunUrls: readonly string[] = [DEFAULT_CLOUDFLARE_STUN_URL]
): RTCConfiguration {
  const validatedUrls: string[] = [];
  for (const url of stunUrls) {
    const normalized = url.trim().toLowerCase();
    if (normalized.startsWith('turn:') || normalized.startsWith('turns:')) {
      throw new Error(
        `TURN relay URLs are strictly disabled for direct-only Friend Race: "${url}"`
      );
    }
    if (!normalized.startsWith('stun:') && !normalized.startsWith('stuns:')) {
      throw new Error(`Invalid STUN server URL: "${url}"`);
    }
    validatedUrls.push(url.trim());
  }

  return {
    iceServers: validatedUrls.length > 0 ? [{ urls: validatedUrls }] : [],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
  };
}

export function classifyIceCandidatePair(
  localType: string | null,
  remoteType: string | null
): IceCandidateClass {
  const l = localType?.toLowerCase() ?? '';
  const r = remoteType?.toLowerCase() ?? '';
  if (l === 'relay' || r === 'relay') return 'relayed_turn';
  if (l === 'srflx' || r === 'srflx') return 'direct_srflx';
  if (l === 'prflx' || r === 'prflx') return 'direct_prflx';
  if (l === 'host' && r === 'host') return 'direct_host';
  if (l === 'host' || r === 'host') return 'direct_host';
  return 'unknown';
}

interface RawRtcStatRecord {
  id?: string;
  type?: string;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
  currentRoundTripTime?: number;
}

/**
 * Inspects RTCPeerConnection.getStats() to verify whether the active ICE candidate
 * pair is a direct path (host / srflx / prflx) or relayed (TURN).
 */
export async function inspectPeerConnectionDirectPath(
  pc: RTCPeerConnection
): Promise<IDirectPathInspection> {
  const stats = await pc.getStats();
  const candidates = new Map<string, RawRtcStatRecord>();
  const pairs: RawRtcStatRecord[] = [];
  let transportSelectedPairId: string | null = null;

  stats.forEach((report) => {
    const rec = report as unknown as RawRtcStatRecord;
    if (rec.type === 'local-candidate' || rec.type === 'remote-candidate') {
      if (rec.id) candidates.set(rec.id, rec);
    } else if (rec.type === 'candidate-pair') {
      pairs.push(rec);
    } else if (rec.type === 'transport' && rec.selectedCandidatePairId) {
      transportSelectedPairId = rec.selectedCandidatePairId;
    }
  });

  let selectedPair: RawRtcStatRecord | undefined;
  if (transportSelectedPairId) {
    selectedPair = pairs.find((p) => p.id === transportSelectedPairId);
  }
  if (!selectedPair) {
    selectedPair =
      pairs.find((p) => p.state === 'succeeded' && (p.nominated || p.selected)) ??
      pairs.find((p) => p.state === 'succeeded');
  }

  if (!selectedPair) {
    return {
      selectedPairId: null,
      pairState: 'none',
      localCandidateType: null,
      remoteCandidateType: null,
      icePathClass: 'unknown',
      isDirect: false,
      isRelayed: false,
      currentRoundTripTimeMs: null,
    };
  }

  const localCand = selectedPair.localCandidateId
    ? candidates.get(selectedPair.localCandidateId)
    : undefined;
  const remoteCand = selectedPair.remoteCandidateId
    ? candidates.get(selectedPair.remoteCandidateId)
    : undefined;

  const localType = localCand?.candidateType ?? null;
  const remoteType = remoteCand?.candidateType ?? null;
  const icePathClass = classifyIceCandidatePair(localType, remoteType);
  const isRelayed = icePathClass === 'relayed_turn';
  const isDirect =
    icePathClass === 'direct_host' ||
    icePathClass === 'direct_srflx' ||
    icePathClass === 'direct_prflx';

  return {
    selectedPairId: selectedPair.id ?? null,
    pairState: selectedPair.state ?? 'unknown',
    localCandidateType: localType,
    remoteCandidateType: remoteType,
    icePathClass,
    isDirect,
    isRelayed,
    currentRoundTripTimeMs:
      typeof selectedPair.currentRoundTripTime === 'number'
        ? Math.round(selectedPair.currentRoundTripTime * 1000 * 100) / 100
        : null,
  };
}

/**
 * Simple sliding-window rate limiter for inbound join/probe/control messages per peer.
 */
export class PeerRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly maxEvents: number;
  private readonly windowMs: number;

  constructor(maxEvents = 40, windowMs = 1000) {
    this.maxEvents = maxEvents;
    this.windowMs = windowMs;
  }

  public allow(key: string, nowMs = Date.now()): boolean {
    const cutoff = nowMs - this.windowMs;
    let stamps = this.buckets.get(key);
    if (!stamps) {
      stamps = [];
      this.buckets.set(key, stamps);
    }
    while (stamps.length > 0 && stamps[0] <= cutoff) {
      stamps.shift();
    }
    if (stamps.length >= this.maxEvents) {
      return false;
    }
    stamps.push(nowMs);
    return true;
  }

  public clear(key?: string): void {
    if (key) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
    }
  }
}
