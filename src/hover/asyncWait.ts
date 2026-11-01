export type WaitResult<T> = { kind: 'value'; value: T } | { kind: 'cancelled' | 'timeout' | 'failed' };

/** Stop observing without pretending to cancel a command that VS Code cannot cancel. */
export async function waitFor<T>(source: PromiseLike<T>, signal: AbortSignal, timeoutMs: number): Promise<WaitResult<T>> {
  if (signal.aborted) return { kind: 'cancelled' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const value = Promise.resolve(source).then(value => ({ kind: 'value' as const, value }), () => ({ kind: 'failed' as const }));
  const stop = new Promise<WaitResult<T>>(resolve => {
    cancel = () => resolve({ kind: 'cancelled' });
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });
  try { return await Promise.race([value, stop]); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}
