import type { EngineEventMap, ITypedEventBus } from './types';

type Handler<T> = (payload: T) => void;

export class EventBus implements ITypedEventBus {
  private listeners = new Map<keyof EngineEventMap, Set<Handler<unknown>>>();

  public on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const wrapped = handler as Handler<unknown>;
    set.add(wrapped);
    return () => {
      set?.delete(wrapped);
    };
  }

  public once<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void
  ): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  public emit<K extends keyof EngineEventMap>(event: K, payload: EngineEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[Modulus EventBus] Error in listener for "${String(event)}":`, err);
      }
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
