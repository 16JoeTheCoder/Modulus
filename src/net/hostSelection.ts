import type {
  IHostCandidateScore,
  IHostSelectionDecision,
  ILobbyMember,
  IPeerLinkMeasurement,
} from './types';

export interface IHostSelectionOptions {
  /** Maximum acceptable 4-car physics benchmark median frame time (ms) for hosting */
  maxHostBenchMedianMs?: number;
  /** Maximum acceptable worst-link packet loss (%) for primary eligibility */
  maxWorstLossPct?: number;
  /** Explicit host override requested before countdown */
  manualOverridePeerId?: string | null;
  /** Current session authority epoch; returned decision bumps or preserves as requested */
  authorityEpoch: number;
}

const DEFAULT_MAX_BENCH_MS = 16.0;
const DEFAULT_MAX_LOSS_PCT = 15.0;

export function makeLinkKey(fromPeerId: string, toPeerId: string): string {
  return `${fromPeerId}->${toPeerId}`;
}

export function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Math.round(sorted[idx] * 100) / 100;
}

export function computeJitterMs(rttSamples: readonly number[]): number {
  if (rttSamples.length < 2) return 0;
  let sumDiff = 0;
  for (let i = 1; i < rttSamples.length; i++) {
    sumDiff += Math.abs(rttSamples[i] - rttSamples[i - 1]);
  }
  return Math.round((sumDiff / (rttSamples.length - 1)) * 100) / 100;
}

/**
 * Evaluates all connected lobby members using the measured peer-to-peer link matrix
 * (up to 6 undirected links across 4 peers) and selects:
 * 1. Primary host: eligible candidate with the steadiest worst link (prefers direct paths
 *    over relayed paths and lowest worst-case p95 RTT + packet loss + jitter).
 * 2. Named backup host: 2nd-best eligible candidate for between-race handoff.
 * 3. Supports explicit pre-countdown manual host override when the overridden peer is eligible.
 */
export function selectHostAndBackup(
  members: readonly ILobbyMember[],
  linkMatrix: Readonly<Record<string, IPeerLinkMeasurement>>,
  options: IHostSelectionOptions
): IHostSelectionDecision | null {
  const activeMembers = members.filter((m) => m.connected);
  if (activeMembers.length === 0) return null;

  const maxBenchMs = options.maxHostBenchMedianMs ?? DEFAULT_MAX_BENCH_MS;
  const maxLossPct = options.maxWorstLossPct ?? DEFAULT_MAX_LOSS_PCT;
  const expectedPeers = Math.max(0, activeMembers.length - 1);

  const rankings: IHostCandidateScore[] = activeMembers.map((candidate) => {
    const others = activeMembers.filter((m) => m.peerId !== candidate.peerId);
    let reachablePeerCount = 0;
    let directLinkCount = 0;
    let relayedLinkCount = 0;
    let worstLinkRttP95Ms = 0;
    let worstLinkLossPct = 0;
    let worstLinkJitterMs = 0;

    for (const other of others) {
      const forward = linkMatrix[makeLinkKey(candidate.peerId, other.peerId)];
      const reverse = linkMatrix[makeLinkKey(other.peerId, candidate.peerId)];
      const sample = forward?.reachable ? forward : reverse?.reachable ? reverse : forward ?? reverse;

      if (sample && sample.reachable) {
        reachablePeerCount++;
        if (sample.isDirect) directLinkCount++;
        if (sample.isRelayed) relayedLinkCount++;
        worstLinkRttP95Ms = Math.max(worstLinkRttP95Ms, sample.rttP95Ms);
        worstLinkLossPct = Math.max(worstLinkLossPct, sample.packetLossPct);
        worstLinkJitterMs = Math.max(worstLinkJitterMs, sample.jitterMs);
      } else {
        worstLinkRttP95Ms = 9999;
        worstLinkLossPct = 100;
        worstLinkJitterMs = 9999;
      }
    }

    let eligible = true;
    let ineligibleReason: string | undefined;

    if (reachablePeerCount < expectedPeers) {
      eligible = false;
      ineligibleReason = `Reached ${reachablePeerCount}/${expectedPeers} peers`;
    } else if (relayedLinkCount > 0) {
      // Direct-only policy: TURN relay is disabled and rejected for hosting
      eligible = false;
      ineligibleReason = `${relayedLinkCount} relayed (TURN) link(s) detected`;
    } else if (worstLinkLossPct > maxLossPct) {
      eligible = false;
      ineligibleReason = `Worst-link packet loss ${worstLinkLossPct.toFixed(1)}% exceeds ${maxLossPct}%`;
    } else if (
      typeof candidate.benchMedianMs === 'number' &&
      candidate.benchMedianMs > maxBenchMs
    ) {
      eligible = false;
      ineligibleReason = `4-car physics bench ${candidate.benchMedianMs.toFixed(2)}ms exceeds ${maxBenchMs}ms`;
    }

    // Steadiest worst-link composite score (lower is better):
    // p95 RTT captures spikes; loss and jitter penalize unstable links heavily.
    const steadiestWorstScore =
      Math.round((worstLinkRttP95Ms + worstLinkLossPct * 25 + worstLinkJitterMs * 2) * 100) / 100;

    return {
      peerId: candidate.peerId,
      eligible,
      ineligibleReason,
      reachablePeerCount,
      expectedPeerCount: expectedPeers,
      directLinkCount,
      relayedLinkCount,
      worstLinkRttP95Ms,
      worstLinkLossPct,
      worstLinkJitterMs,
      steadiestWorstScore,
      benchMedianMs: candidate.benchMedianMs ?? null,
    };
  });

  rankings.sort((a, b) => {
    // 1. Eligible candidates first
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    // 2. More reachable peers first
    if (a.reachablePeerCount !== b.reachablePeerCount) {
      return b.reachablePeerCount - a.reachablePeerCount;
    }
    // 3. Direct paths preferred over relayed/unknown
    if (a.directLinkCount !== b.directLinkCount) {
      return b.directLinkCount - a.directLinkCount;
    }
    // 4. Steadiest worst link (lowest composite score)
    if (Math.abs(a.steadiestWorstScore - b.steadiestWorstScore) > 0.01) {
      return a.steadiestWorstScore - b.steadiestWorstScore;
    }
    // 5. Faster local physics benchmark if provided
    const benchA = a.benchMedianMs ?? Number.POSITIVE_INFINITY;
    const benchB = b.benchMedianMs ?? Number.POSITIVE_INFINITY;
    if (Math.abs(benchA - benchB) > 0.05) {
      return benchA - benchB;
    }
    // 6. Deterministic peerId tie-breaker
    return a.peerId.localeCompare(b.peerId);
  });

  const overrideTarget = options.manualOverridePeerId
    ? rankings.find((r) => r.peerId === options.manualOverridePeerId && r.eligible)
    : undefined;

  if (overrideTarget) {
    const backup = rankings.find((r) => r.peerId !== overrideTarget.peerId && r.eligible)
      ?? rankings.find((r) => r.peerId !== overrideTarget.peerId)
      ?? null;

    return {
      hostPeerId: overrideTarget.peerId,
      backupHostPeerId: backup?.peerId ?? null,
      authorityEpoch: options.authorityEpoch,
      manualOverride: true,
      reason: `Manual host override (${overrideTarget.peerId}; worst p95 ${overrideTarget.worstLinkRttP95Ms}ms, ${overrideTarget.directLinkCount}/${overrideTarget.expectedPeerCount} direct)`,
      rankings,
    };
  }

  const primary = rankings[0];
  const backup = rankings.length > 1 ? rankings[1] : null;

  return {
    hostPeerId: primary.peerId,
    backupHostPeerId: backup?.peerId ?? null,
    authorityEpoch: options.authorityEpoch,
    manualOverride: false,
    reason: primary.eligible
      ? `Steadiest worst link (score ${primary.steadiestWorstScore}, worst p95 ${primary.worstLinkRttP95Ms}ms, loss ${primary.worstLinkLossPct}%, ${primary.directLinkCount}/${primary.expectedPeerCount} direct)`
      : `Fallback host (${primary.ineligibleReason ?? 'no fully eligible candidate'})`,
    rankings,
  };
}

/**
 * Authority epoch guard: returns true only when an incoming host-authoritative
 * message carries an epoch >= the current session authority epoch (and strictly
 * rejects stale messages from a previous host after recovery).
 */
export function isHostAuthorityValid(
  currentEpoch: number,
  currentHostPeerId: string | null,
  incomingEpoch: number,
  incomingHostPeerId: string
): boolean {
  if (!Number.isInteger(incomingEpoch) || incomingEpoch < 1) return false;
  if (incomingEpoch < currentEpoch) return false;
  if (incomingEpoch === currentEpoch && currentHostPeerId && incomingHostPeerId !== currentHostPeerId) {
    return false;
  }
  return true;
}
