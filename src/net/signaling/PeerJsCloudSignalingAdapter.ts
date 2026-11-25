import { generateUnpredictableId } from '../protocol';
import type {
  ISignalingAdapter,
  ISignalingSignal,
  SignalingConnectionState,
  SignalingSignalType,
} from '../types';

export interface IPeerJsCloudConfig {
  peerId?: string;
  host?: string;
  port?: number;
  path?: string;
  key?: string;
  secure?: boolean;
  heartbeatIntervalMs?: number;
  connectTimeoutMs?: number;
  clientVersion?: string;
}

const DEFAULT_PEERJS_HOST = '0.peerjs.com';
const DEFAULT_PEERJS_PORT = 443;
const DEFAULT_PEERJS_PATH = '/';
const DEFAULT_PEERJS_KEY = 'peerjs';
const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_CONNECT_TIMEOUT_MS = 12_000;
const DEFAULT_CLIENT_VERSION = '1.5.4';

interface RawPeerJsMessage {
  type?: string;
  src?: string;
  dst?: string;
  payload?: Record<string, unknown>;
}

/**
 * Signaling adapter for PeerJS Cloud (`0.peerjs.com`) using the standard PeerJS
 * WebSocket signaling protocol. Isolated behind ISignalingAdapter so gameplay
 * and WebRTC transport never couple to a specific broker.
 */
export class PeerJsCloudSignalingAdapter implements ISignalingAdapter {
  public readonly kind = 'peerjs-cloud';
  public readonly peerId: string;

  private readonly host: string;
  private readonly port: number;
  private readonly path: string;
  private readonly key: string;
  private readonly secure: boolean;
  private readonly heartbeatIntervalMs: number;
  private readonly connectTimeoutMs: number;
  private readonly clientVersion: string;
  private readonly token: string;

  private socket: WebSocket | null = null;
  private state: SignalingConnectionState = 'disconnected';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private signalListeners = new Set<(signal: ISignalingSignal) => void>();
  private stateListeners = new Set<(state: SignalingConnectionState, detail?: string) => void>();

  constructor(config: IPeerJsCloudConfig = {}) {
    // PeerJS Cloud uses alphanumeric/hyphen IDs without underscores
    this.peerId = config.peerId ?? generateUnpredictableId('modp', 10).replace(/_/g, '');
    this.host = config.host ?? DEFAULT_PEERJS_HOST;
    this.port = config.port ?? DEFAULT_PEERJS_PORT;
    this.path = config.path ?? DEFAULT_PEERJS_PATH;
    this.key = config.key ?? DEFAULT_PEERJS_KEY;
    this.secure = config.secure ?? true;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    this.connectTimeoutMs = config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.clientVersion = config.clientVersion ?? DEFAULT_CLIENT_VERSION;
    this.token = generateUnpredictableId('tok', 8).replace(/_/g, '');
  }

  public getState(): SignalingConnectionState {
    return this.state;
  }

  public getWebSocketUrl(): string {
    const protocol = this.secure ? 'wss://' : 'ws://';
    const normalizedPath = this.path.endsWith('/') ? this.path : `${this.path}/`;
    const portSuffix =
      (this.secure && this.port === 443) || (!this.secure && this.port === 80)
        ? ''
        : `:${this.port}`;
    const qs = new URLSearchParams({
      key: this.key,
      id: this.peerId,
      token: this.token,
      version: this.clientVersion,
    });
    return `${protocol}${this.host}${portSuffix}${normalizedPath}peerjs?${qs.toString()}`;
  }

  public connect(): Promise<string> {
    if (this.state === 'open' && this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.peerId);
    }

    this.disconnect();
    this.setState('connecting');

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const url = this.getWebSocketUrl();
      const ws = new WebSocket(url);
      this.socket = ws;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.setState('error', 'PeerJS Cloud signaling connect timeout');
          this.disconnect();
          reject(new Error(`PeerJS Cloud signaling timed out after ${this.connectTimeoutMs}ms`));
        }
      }, this.connectTimeoutMs);

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let msg: RawPeerJsMessage;
        try {
          msg = JSON.parse(event.data) as RawPeerJsMessage;
        } catch {
          return;
        }

        if (msg.type === 'OPEN') {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            this.setState('open');
            this.startHeartbeat();
            resolve(this.peerId);
          }
          return;
        }

        if (msg.type === 'ID-TAKEN' || msg.type === 'ERROR') {
          const errText =
            typeof msg.payload?.msg === 'string' ? msg.payload.msg : `PeerJS ${msg.type}`;
          this.setState('error', errText);
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error(errText));
          }
          return;
        }

        if (
          (msg.type === 'OFFER' ||
            msg.type === 'ANSWER' ||
            msg.type === 'CANDIDATE' ||
            msg.type === 'LEAVE') &&
          typeof msg.src === 'string'
        ) {
          const signal: ISignalingSignal = {
            type: msg.type,
            src: msg.src,
            dst: msg.dst ?? this.peerId,
            payload: msg.payload,
          };
          for (const listener of Array.from(this.signalListeners)) {
            listener(signal);
          }
        }
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.setState('error', 'PeerJS Cloud WebSocket error');
          reject(new Error('PeerJS Cloud WebSocket connection failed'));
        }
      };

      ws.onclose = (ev) => {
        this.stopHeartbeat();
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.setState('disconnected', `Closed (${ev.code})`);
          reject(new Error(`PeerJS Cloud signaling closed before OPEN (${ev.code})`));
          return;
        }
        if (this.socket === ws) {
          this.socket = null;
          this.setState('disconnected', ev.reason || `Closed (${ev.code})`);
        }
      };
    });
  }

  public send(dst: string, type: SignalingSignalType, payload?: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    // PeerJS Cloud attaches `src` server-side from the authenticated WebSocket client
    // and expects standard data-connection envelope fields on OFFER/ANSWER/CANDIDATE.
    const enrichedPayload: Record<string, unknown> = {
      type: 'data',
      connectionId: `dc_${this.peerId.slice(-8)}_${dst.slice(-8)}`,
      label: 'modulus-lobby',
      reliable: true,
      serialization: 'binary',
      ...(payload ?? {}),
    };
    this.socket.send(
      JSON.stringify({
        type,
        dst,
        payload: enrichedPayload,
      })
    );
  }

  public onSignal(handler: (signal: ISignalingSignal) => void): () => void {
    this.signalListeners.add(handler);
    return () => {
      this.signalListeners.delete(handler);
    };
  }

  public onStateChange(
    handler: (state: SignalingConnectionState, detail?: string) => void
  ): () => void {
    this.stateListeners.add(handler);
    return () => {
      this.stateListeners.delete(handler);
    };
  }

  public disconnect(): void {
    this.stopHeartbeat();
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Client disconnect');
      }
    }
    if (this.state !== 'disconnected') {
      this.setState('disconnected');
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'HEARTBEAT' }));
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private setState(next: SignalingConnectionState, detail?: string): void {
    this.state = next;
    for (const listener of Array.from(this.stateListeners)) {
      listener(next, detail);
    }
  }
}
