export type Discovery<T> = { kind: 'collected'; value: T } | { kind: 'busy' | 'cancelled' | 'timeout' | 'failed' };

/** The lease covers the actual source command, even after its consumer stops waiting. */
export class HoverDiscoveryCoordinator {
  private occupied = false;
  private draining = false;
  private disposed = false;
  get state(): 'idle' | 'collecting' | 'draining' { return !this.occupied ? 'idle' : this.draining ? 'draining' : 'collecting'; }
  get busy(): boolean { return this.occupied || this.disposed; }

  async collect<T>(read: () => PromiseLike<T>, signal: AbortSignal, timeoutMs: number): Promise<Discovery<T>> {
    if (this.busy) return { kind: 'busy' };
    if (signal.aborted) return { kind: 'cancelled' };
    this.occupied = true;
    // Attach rejection handling immediately; a late rejection must still release the lease.
    const source: Promise<Discovery<T>> = Promise.resolve().then(read).then(
      value => ({ kind: 'collected' as const, value }), () => ({ kind: 'failed' as const }),
    ).finally(() => { this.occupied = false; this.draining = false; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: () => void = () => {};
    const stop = new Promise<Discovery<T>>(resolve => {
      cancel = () => { this.draining = true; resolve({ kind: 'cancelled' }); };
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => { this.draining = true; resolve({ kind: 'timeout' }); }, timeoutMs);
    });
    try { return await Promise.race([source, stop]); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }
  dispose(): void { this.disposed = true; }
}
