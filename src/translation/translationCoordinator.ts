import { createHash } from 'node:crypto';
import { MemoryTranslationCache } from '../cache/memoryTranslationCache.js';
import { TranslationError, type Segment, type ServiceConfig, type Translations } from './contracts.js';
import type { Translator } from './chatCompletionsClient.js';
import { TRANSLATION_VERSION } from './translationVersion.js';
export type WorkEvent = { kind: 'cache_hit' } | { kind: 'queued' | 'requesting'; shared: boolean };
export interface AcquireOptions { purpose?: 'document' | 'diagnostic'; observe?: (event: WorkEvent) => void }
export interface ServiceSnapshot {
  active: number; queued: number; blockedReason?: string;
  cooldownRemainingMs: number; rateRemainingMs?: number;
}
interface Subscriber { resolve: (value: Translations) => void; reject: (error: Error) => void; cleanup: () => void; observe?: AcquireOptions['observe']; shared: boolean }
interface Task { key: string; segments: Segment[]; config: ServiceConfig; purpose: 'document' | 'diagnostic'; controller: AbortController; subscribers: Map<symbol, Subscriber>; queueTimer?: ReturnType<typeof setTimeout>; generation: number; started: boolean }
function observe(callback: AcquireOptions['observe'], event: WorkEvent): void {
  try { callback?.(event); } catch { /* Observation never changes request outcomes. */ }
}
export class TranslationCoordinator {
  private tasks = new Map<string, Task>();
  private queue: Task[] = [];
  private active = 0;
  private generation = 0;
  private starts: number[] = [];
  private cooldownUntil = 0;
  private blockedReason?: string;
  constructor(private translate: Translator, private cache: MemoryTranslationCache, private onActivity: (count: number) => void = () => {}, private onError: (code: string) => void = () => {}) {}
  snapshot(config?: Pick<ServiceConfig, 'perMinute'>): ServiceSnapshot {
    const now = Date.now(); const starts = this.starts.filter(time => time > now - 60000);
    return { active: this.active, queued: this.queue.length, blockedReason: this.blockedReason,
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - now),
      rateRemainingMs: config ? starts.length >= config.perMinute
        ? Math.max(0, starts[starts.length - config.perMinute] + 60000 - now) : 0 : undefined };
  }
  private notify(): void { try { this.onActivity(this.active); } catch { /* observer only */ } }
  acquire(segments: Segment[], config: ServiceConfig, signal: AbortSignal, options: AcquireOptions = {}): Promise<Translations> {
    if (signal.aborted) return Promise.reject(new TranslationError('cancelled'));
    if (this.blockedReason) return Promise.reject(new TranslationError('configuration_blocked'));
    const purpose = options.purpose ?? 'document';
    const key = createHash('sha256').update(JSON.stringify([purpose, segments, config.endpoint, config.model, config.revision, 'zh-CN', TRANSLATION_VERSION])).digest('hex');
    const cached = purpose === 'document' ? this.cache.get(key) : undefined;
    if (cached) { observe(options.observe, { kind: 'cache_hit' }); return Promise.resolve(cached); }
    let task = this.tasks.get(key);
    const shared = !!task;
    if (!task) {
      if (Date.now() < this.cooldownUntil) return Promise.reject(new TranslationError('cooldown'));
      if (this.snapshot(config).rateRemainingMs) return Promise.reject(new TranslationError('rate_limited'));
      if (this.active >= config.concurrent && this.queue.length >= config.queueSize) return Promise.reject(new TranslationError('queue_full'));
      task = { key, segments, config, purpose, controller: new AbortController(), subscribers: new Map(), generation: this.generation, started: false };
      this.tasks.set(key, task); this.queue.push(task);
      const queued = task;
      task.queueTimer = setTimeout(() => this.cancelTask(queued, 'queue_timeout'), 3000);
    }
    const current = task;
    const result = new Promise<Translations>((resolve, reject) => {
      const id = Symbol();
      const cancel = () => {
        const subscriber = current.subscribers.get(id); if (!subscriber) return;
        subscriber.cleanup(); current.subscribers.delete(id); reject(new TranslationError('cancelled'));
        if (!current.subscribers.size) this.cancelTask(current, 'cancelled');
      };
      current.subscribers.set(id, { resolve, reject, cleanup: () => signal.removeEventListener('abort', cancel), observe: options.observe, shared });
      signal.addEventListener('abort', cancel, { once: true });
      observe(options.observe, { kind: current.started ? 'requesting' : 'queued', shared });
      if (signal.aborted) cancel();
    });
    this.notify(); this.drain(); return result;
  }
  reset(cache = this.cache, options: { releaseConfigurationBlock?: boolean } = {}): void {
    this.generation++; this.cache.clear(); this.cache = cache;
    if (options.releaseConfigurationBlock) this.blockedReason = undefined;
    for (const task of [...this.tasks.values()]) this.cancelTask(task, 'cancelled');
  }
  private cancelTask(task: Task, code: string): void {
    clearTimeout(task.queueTimer); task.controller.abort();
    this.finish(task, undefined, new TranslationError(code));
    this.queue = this.queue.filter(item => item !== task);
    this.notify();
  }
  private finish(task: Task, value?: Translations, error?: Error): void {
    if (this.tasks.get(task.key) === task) this.tasks.delete(task.key);
    for (const subscriber of task.subscribers.values()) { subscriber.cleanup(); if (value) subscriber.resolve(value); else subscriber.reject(error || new TranslationError('cancelled')); }
    task.subscribers.clear();
  }
  private drain(): void {
    while (this.queue.length) {
      const task = this.queue[0];
      if (this.active >= task.config.concurrent) break;
      this.queue.shift(); clearTimeout(task.queueTimer);
      if (!task.subscribers.size) continue;
      this.starts = this.starts.filter(time => time > Date.now() - 60000);
      const code = this.blockedReason ? 'configuration_blocked' : Date.now() < this.cooldownUntil ? 'cooldown' : this.starts.length >= task.config.perMinute ? 'rate_limited' : undefined;
      if (code) { this.finish(task, undefined, new TranslationError(code)); this.notify(); continue; }
      this.starts.push(Date.now()); this.active++; task.started = true;
      for (const sub of task.subscribers.values()) observe(sub.observe, { kind: 'requesting', shared: sub.shared });
      this.notify();
      void this.execute(task);
    }
  }
  private async execute(task: Task): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { timedOut = true; task.controller.abort(); reject(new TranslationError('timeout')); }, task.config.timeoutMs);
    });
    try {
      const value = await Promise.race([this.translate(task.segments, task.config, task.controller.signal), timeout]);
      if (task.generation === this.generation && !task.controller.signal.aborted && task.subscribers.size) { if (task.purpose === 'document') this.cache.set(task.key, value); this.finish(task, value); }
      else this.finish(task, undefined, new TranslationError('cancelled'));
    } catch (error) {
      const e = timedOut ? new TranslationError('timeout') : error instanceof TranslationError ? error : new TranslationError(task.controller.signal.aborted ? 'cancelled' : 'network');
      if (task.generation === this.generation && (!task.controller.signal.aborted || timedOut)) {
        if (['http_401', 'http_403', 'http_404', 'protocol', 'missing_key'].includes(e.code)) this.blockedReason = e.code;
        this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + Math.max(e.cooldownMs, 5000));
        try { this.onError(e.code); } catch { /* observer only */ }
      }
      this.finish(task, undefined, e);
    } finally { clearTimeout(timer); this.active--; this.notify(); this.drain(); }
  }
}
