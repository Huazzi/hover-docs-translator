import { waitFor, type WaitResult } from './asyncWait.js';

/** In-flight deduplication and a hard cap including timed-out, still-running commands. */
export class RecursiveHoverReader<T> {
  private pending = new Map<string, Promise<T>>();
  private disposed = false;
  constructor(private readonly capacity = 8) {}
  async collect(key: string, read: () => PromiseLike<T>, signal: AbortSignal, timeoutMs: number): Promise<WaitResult<T> | { kind: 'busy' }> {
    if (signal.aborted || this.disposed) return { kind: 'cancelled' };
    let source = this.pending.get(key);
    if (!source) {
      if (this.pending.size >= this.capacity) return { kind: 'busy' };
      source = Promise.resolve().then(read);
      this.pending.set(key, source);
      const done = () => { if (this.pending.get(key) === source) this.pending.delete(key); };
      void source.then(done, done);
    }
    return waitFor(source, signal, timeoutMs);
  }
  dispose(): void { this.disposed = true; }
}
