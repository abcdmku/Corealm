import type { GameEvent, GameEventType, EntityId } from "../contracts.js";

const MAX_BUFFER = 512;

interface Waiter {
  sinceSeq: number;
  filter?: GameEventType[];
  resolve(value: { events: GameEvent[]; nextSeq: number }): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Monotonic event ring buffer with cursor reads and long-poll waiters.
 *
 * Cursor + long-poll is what lets a good agent avoid polling entirely, which is the whole point of
 * the agent-efficiency pillar. Events are queued during a tick and flushed at the end of it, so
 * causally related events (level.gained then the quest.updated it triggers) stay ordered.
 */
export class EventBus {
  private buffer: GameEvent[] = [];
  private pending: GameEvent[] = [];
  private waiters = new Set<Waiter>();
  private nextSeq = 1;
  /** Highest sequence number readers can actually observe in `buffer`. */
  private publishedSeq = 0;
  private listeners = new Set<(event: GameEvent) => void>();

  /** Queues an event. It becomes visible to readers at the next flush. */
  emit(type: GameEventType, data: Record<string, unknown> = {}, entityId?: EntityId, atMs = 0): void {
    const event: GameEvent = entityId
      ? { seq: this.nextSeq++, type, atMs, entityId, data }
      : { seq: this.nextSeq++, type, atMs, data };
    this.pending.push(event);
  }

  /** Publishes everything queued this tick. Called last in the update order, on purpose. */
  flush(): void {
    if (this.pending.length === 0) return;
    for (const event of this.pending) {
      this.buffer.push(event);
      this.publishedSeq = event.seq;
      for (const listener of this.listeners) listener(event);
    }
    this.pending.length = 0;
    if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    this.wakeWaiters();
  }

  /** Non-blocking drain from a cursor. */
  since(sinceSeq: number, filter?: GameEventType[]): { events: GameEvent[]; nextSeq: number } {
    const events = this.buffer.filter(
      (event) => event.seq > sinceSeq && (!filter || filter.length === 0 || filter.includes(event.type)),
    );
    // `nextSeq` must never include an event that is still pending. A caller commonly saves this
    // cursor and asks again after the tick flush; advancing it to an unpublished sequence would
    // make that event disappear from the caller's history.
    return { events, nextSeq: this.publishedSeq };
  }

  /** Long-poll. Resolves as soon as a matching event lands, or empty at timeout. */
  wait(sinceSeq: number, filter?: GameEventType[], timeoutMs = 30_000): Promise<{ events: GameEvent[]; nextSeq: number }> {
    const immediate = this.since(sinceSeq, filter);
    if (immediate.events.length > 0) return Promise.resolve(immediate);

    return new Promise((resolve) => {
      const waiter: Waiter = {
        sinceSeq,
        ...(filter ? { filter } : {}),
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          resolve({ events: [], nextSeq: this.publishedSeq });
        }, Math.max(0, Math.min(timeoutMs, 120_000))),
      };
      this.waiters.add(waiter);
    });
  }

  /** In-process subscription, used by render and UI. Not the agent path. */
  subscribe(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private wakeWaiters(): void {
    if (this.waiters.size === 0) return;
    for (const waiter of [...this.waiters]) {
      const result = this.since(waiter.sinceSeq, waiter.filter);
      if (result.events.length > 0) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.resolve(result);
      }
    }
  }

  currentSeq(): number {
    return this.publishedSeq;
  }

  reset(): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ events: [], nextSeq: 0 });
    }
    this.waiters.clear();
    this.buffer.length = 0;
    this.pending.length = 0;
    this.nextSeq = 1;
    this.publishedSeq = 0;
  }
}
