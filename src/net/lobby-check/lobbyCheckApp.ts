import {
  BroadcastChannelSignalingAdapter,
  DEFAULT_CLOUDFLARE_STUN_URL,
  DirectMeshLobby,
  PeerJsCloudSignalingAdapter,
  type IFriendRoomState,
  type LobbyMessage,
} from '../index';

declare global {
  interface Window {
    __MODULUS_LOBBY_CHECK__?: {
      createRoom: (displayName: string, signalingKind?: 'peerjs' | 'broadcast', channel?: string, benchMs?: number) => Promise<{
        roomId: string;
        sessionId: string;
        entryPeerId: string;
        signalingKind: string;
        rtcConfig: RTCConfiguration;
      }>;
      joinRoom: (
        displayName: string,
        roomId: string,
        entryPeerId: string,
        signalingKind?: 'peerjs' | 'broadcast',
        channel?: string,
        benchMs?: number
      ) => Promise<IFriendRoomState>;
      runLocalLinkProbes: (probeCount?: number) => Promise<unknown>;
      evaluateAndElectHost: (overridePeerId?: string | null) => unknown;
      requestHostOverride: (targetPeerId: string) => boolean;
      claimHostAsBackup: () => boolean;
      inspectAllDirectPaths: () => Promise<unknown>;
      getConnectedPeerIds: () => string[];
      getState: () => IFriendRoomState | null;
      injectStaleHostMessage: (fakeOldHostPeerId: string, staleEpoch: number) => void;
      simulateAbruptDisconnect: () => void;
      leave: () => void;
      getLogs: () => Array<{ timeMs: number; level: string; text: string }>;
    };
  }
}

const nameInput = document.getElementById('name') as HTMLInputElement | null;
const sigSelect = document.getElementById('signaling') as HTMLSelectElement | null;
const roomInput = document.getElementById('room-id') as HTMLInputElement | null;
const entryInput = document.getElementById('entry-peer') as HTMLInputElement | null;
const statePre = document.getElementById('state-json') as HTMLPreElement | null;
const logsPre = document.getElementById('logs') as HTMLPreElement | null;
const sigBadge = document.getElementById('sig-badge') as HTMLSpanElement | null;

let activeLobby: DirectMeshLobby | null = null;
const logEntries: Array<{ timeMs: number; level: string; text: string }> = [];

function renderLogs(): void {
  if (!logsPre) return;
  logsPre.textContent = logEntries
    .slice(-50)
    .map((e) => `[${new Date(e.timeMs).toISOString().slice(11, 23)}] [${e.level.toUpperCase()}] ${e.text}`)
    .join('\n');
}

function renderState(state: IFriendRoomState | null): void {
  if (!statePre) return;
  statePre.textContent = JSON.stringify(state, null, 2);
}

function createLobbyInstance(
  displayName: string,
  signalingKind: 'peerjs' | 'broadcast' = 'peerjs',
  channel = 'modulus-friend-lobby-local',
  benchMedianMs?: number
): DirectMeshLobby {
  activeLobby?.dispose();
  const signaling =
    signalingKind === 'broadcast'
      ? new BroadcastChannelSignalingAdapter(channel)
      : new PeerJsCloudSignalingAdapter();

  if (sigBadge) {
    sigBadge.textContent = `Signaling: ${signaling.kind}`;
  }

  const lobby = new DirectMeshLobby({
    displayName,
    signaling,
    stunUrls: [DEFAULT_CLOUDFLARE_STUN_URL],
    benchMedianMs,
    heartbeatIntervalMs: 800,
    hostTimeoutMs: 2600,
  });

  lobby.onStateChange((st) => renderState(st));
  lobby.onLog((entry) => {
    logEntries.push(entry);
    renderLogs();
  });

  activeLobby = lobby;
  return lobby;
}

window.__MODULUS_LOBBY_CHECK__ = {
  async createRoom(displayName, signalingKind = 'peerjs', channel, benchMs) {
    const lobby = createLobbyInstance(displayName, signalingKind, channel, benchMs);
    const info = await lobby.createRoom('track_switchyard_sprint');
    if (roomInput) roomInput.value = info.roomId;
    if (entryInput) entryInput.value = info.entryPeerId;
    return {
      ...info,
      signalingKind: lobby.signaling.kind,
      rtcConfig: lobby.getRtcConfig(),
    };
  },
  async joinRoom(displayName, roomId, entryPeerId, signalingKind = 'peerjs', channel, benchMs) {
    const lobby = createLobbyInstance(displayName, signalingKind, channel, benchMs);
    if (roomInput) roomInput.value = roomId;
    if (entryInput) entryInput.value = entryPeerId;
    return lobby.joinRoom(roomId, entryPeerId, 18_000);
  },
  async runLocalLinkProbes(probeCount = 10) {
    if (!activeLobby) throw new Error('No active lobby');
    return activeLobby.runLocalLinkProbes(probeCount, 20, 220);
  },
  evaluateAndElectHost(overridePeerId = null) {
    if (!activeLobby) throw new Error('No active lobby');
    return activeLobby.evaluateAndElectHost(overridePeerId);
  },
  requestHostOverride(targetPeerId) {
    if (!activeLobby) throw new Error('No active lobby');
    return activeLobby.requestHostOverride(targetPeerId);
  },
  claimHostAsBackup() {
    if (!activeLobby) throw new Error('No active lobby');
    return activeLobby.claimHostAsBackup();
  },
  async inspectAllDirectPaths() {
    if (!activeLobby) throw new Error('No active lobby');
    return activeLobby.inspectAllDirectPaths();
  },
  getConnectedPeerIds() {
    return activeLobby ? activeLobby.getConnectedPeerIds() : [];
  },
  getState() {
    return activeLobby ? activeLobby.getState() : null;
  },
  injectStaleHostMessage(fakeOldHostPeerId, staleEpoch) {
    if (!activeLobby) throw new Error('No active lobby');
    const st = activeLobby.getState();
    const staleMsg: LobbyMessage = {
      type: 'lobby:roster-sync',
      roomId: st.roomId,
      sessionId: st.sessionId,
      authorityEpoch: staleEpoch,
      hostPeerId: fakeOldHostPeerId,
      backupHostPeerId: null,
      manualHostOverride: false,
      trackId: 'track_wrong_stale',
      phase: 'lobby',
      restartRaceOffered: false,
      members: st.members,
    };
    activeLobby.injectMessageForTest(fakeOldHostPeerId, staleMsg);
  },
  simulateAbruptDisconnect() {
    activeLobby?.simulateAbruptDisconnect();
  },
  leave() {
    activeLobby?.leave();
  },
  getLogs() {
    return [...logEntries];
  },
};

document.getElementById('btn-create')?.addEventListener('click', () => {
  const kind = (sigSelect?.value as 'peerjs' | 'broadcast') ?? 'peerjs';
  void window.__MODULUS_LOBBY_CHECK__?.createRoom(nameInput?.value || 'Host', kind);
});
document.getElementById('btn-join')?.addEventListener('click', () => {
  const kind = (sigSelect?.value as 'peerjs' | 'broadcast') ?? 'peerjs';
  void window.__MODULUS_LOBBY_CHECK__?.joinRoom(
    nameInput?.value || 'Guest',
    roomInput?.value.trim() || '',
    entryInput?.value.trim() || '',
    kind
  );
});
document.getElementById('btn-probe')?.addEventListener('click', () => {
  void window.__MODULUS_LOBBY_CHECK__?.runLocalLinkProbes(10);
});
document.getElementById('btn-elect')?.addEventListener('click', () => {
  window.__MODULUS_LOBBY_CHECK__?.evaluateAndElectHost(null);
});
document.getElementById('btn-claim')?.addEventListener('click', () => {
  window.__MODULUS_LOBBY_CHECK__?.claimHostAsBackup();
});
document.getElementById('btn-drop')?.addEventListener('click', () => {
  window.__MODULUS_LOBBY_CHECK__?.simulateAbruptDisconnect();
});
document.getElementById('btn-leave')?.addEventListener('click', () => {
  window.__MODULUS_LOBBY_CHECK__?.leave();
});
