import { createHash } from 'node:crypto';
import { MemoryTranslationCache } from '../cache/memoryTranslationCache.js';
import { TranslationError, type Segment, type ServiceConfig, type Translations } from './contracts.js';
import type { Translator } from './chatCompletionsClient.js';
interface Subscriber { resolve: (value: Translations) => void; reject: (error: Error) => void; cleanup: () => void }
interface Task { key: string; segments: Segment[]; config: ServiceConfig; controller: AbortController; subscribers: Map<symbol, Subscriber>; queueTimer?: ReturnType<typeof setTimeout>; generation: number; started: boolean }
export class TranslationCoordinator {
  private tasks = new Map<string, Task>();
  private queue: Task[] = [];
  private active = 0;
  private generation = 0;
  private starts: number[] = [];
  private cooldownUntil = 0;
  private blocked = false;
  constructor(private translate: Translator, private cache: MemoryTranslationCache, private onActivity: (count: number) => void = () => {}, private onError: (code: string) => void = () => {}) {}
  acquire(segments: Segment[], config: ServiceConfig, signal: AbortSignal): Promise<Translations> {
    if (signal.aborted) return Promise.reject(new TranslationError('cancelled'));
    if (this.blocked) return Promise.reject(new TranslationError('configuration_blocked'));
    const key = createHash('sha256').update(JSON.stringify([segments, config.endpoint, config.model, config.revision, 'zh-CN', 'prompt1-codec1'])).digest('hex');
    const cached = this.cache.get(key); if (cached) return Promise.resolve(cached);
    let task = this.tasks.get(key);
    if (!task) {
      if (Date.now() < this.cooldownUntil) return Promise.reject(new TranslationError('cooldown'));
      if (this.active >= config.concurrent && this.queue.length >= config.queueSize) return Promise.reject(new TranslationError('queue_full'));
      task = { key, segments, config, controller: new AbortController(), subscribers: new Map(), generation: this.generation, started: false };
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
      current.subscribers.set(id, { resolve, reject, cleanup: () => signal.removeEventListener('abort', cancel) });
      signal.addEventListener('abort', cancel, { once: true });
    });
    this.drain(); return result;
  }
  reset(cache = this.cache, resetService = true): void {
    this.generation++; this.cache.clear(); this.cache = cache;
    if (resetService) { this.blocked = false; this.cooldownUntil = 0; }
    for (const task of [...this.tasks.values()]) this.cancelTask(task, 'cancelled');
  }
  private cancelTask(task: Task, code: string): void {
    clearTimeout(task.queueTimer); task.controller.abort();
    this.finish(task, undefined, new TranslationError(code));
    this.queue = this.queue.filter(item => item !== task);
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
      if (this.blocked || Date.now() < this.cooldownUntil || this.starts.length >= task.config.perMinute) { this.finish(task, undefined, new TranslationError('cooldown')); continue; }
      this.starts.push(Date.now()); this.active++; task.started = true; this.onActivity(this.active);
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
      if (task.generation === this.generation && !task.controller.signal.aborted && task.subscribers.size) { this.cache.set(task.key, value); this.finish(task, value); }
      else this.finish(task, undefined, new TranslationError('cancelled'));
    } catch (error) {
      const e = timedOut ? new TranslationError('timeout') : error instanceof TranslationError ? error : new TranslationError(task.controller.signal.aborted ? 'cancelled' : 'network');
      if (task.generation === this.generation && (!task.controller.signal.aborted || timedOut)) {
        if (['http_401', 'http_403', 'http_404', 'protocol', 'missing_key'].includes(e.code)) this.blocked = true;
        this.cooldownUntil = Date.now() + Math.max(e.cooldownMs, 5000); this.onError(e.code);
      }
      this.finish(task, undefined, e);
    } finally { clearTimeout(timer); this.active--; this.onActivity(this.active); this.drain(); }
  }
}
