import { generateUnpredictableId } from '../protocol';
import type {
  ISignalingAdapter,
  ISignalingSignal,
  SignalingConnectionState,
  SignalingSignalType,
} from '../types';

/**
 * Same-origin BroadcastChannel signaling adapter implementing ISignalingAdapter.
 * Used only for offline local multi-tab regression testing when PeerJS Cloud
 * is intentionally disabled or unavailable. Production Friend Race defaults to
 * PeerJsCloudSignalingAdapter.
 */
export class BroadcastChannelSignalingAdapter implements ISignalingAdapter {
  public readonly kind = 'broadcast-channel-local';
  public readonly peerId: string;

  private readonly channelName: string;
  private channel: BroadcastChannel | null = null;
  private state: SignalingConnectionState = 'disconnected';
  private signalListeners = new Set<(signal: ISignalingSignal) => void>();
  private stateListeners = new Set<(state: SignalingConnectionState, detail?: string) => void>();

  constructor(channelName: string, peerId?: string) {
    this.channelName = channelName;
    this.peerId = peerId ?? generateUnpredictableId('modloc', 8);
  }

  public getState(): SignalingConnectionState {
    return this.state;
  }

  public async connect(): Promise<string> {
    this.disconnect();
    this.channel = new BroadcastChannel(this.channelName);
    this.channel.onmessage = (event) => {
      const msg = event.data as ISignalingSignal | undefined;
      if (!msg || msg.dst !== this.peerId || msg.src === this.peerId) return;
      for (const listener of Array.from(this.signalListeners)) {
        listener(msg);
      }
    };
    this.setState('open');
    return this.peerId;
  }

  public send(dst: string, type: SignalingSignalType, payload?: Record<string, unknown>): void {
    if (!this.channel) return;
    const signal: ISignalingSignal = {
      type,
      src: this.peerId,
      dst,
      payload,
    };
    this.channel.postMessage(signal);
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
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.state !== 'disconnected') {
      this.setState('disconnected');
    }
  }

  private setState(next: SignalingConnectionState, detail?: string): void {
    this.state = next;
    for (const listener of Array.from(this.stateListeners)) {
      listener(next, detail);
    }
  }
}
