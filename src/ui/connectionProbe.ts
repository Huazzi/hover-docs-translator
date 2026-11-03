import type { ServiceConfig } from '../translation/contracts.js';
import { TranslationError } from '../translation/contracts.js';
import type { TranslationCoordinator } from '../translation/translationCoordinator.js';
import { safeErrorCode } from './statusMessages.js';

export const PROBE_TEXT = 'Return ⟦HDT_0⟧ if no value is provided; otherwise return the supplied value.';
export interface ProbeResult { revision: number; outcome: 'passed' | 'failed' | 'cancelled'; code?: string; elapsedMs: number; finishedAt: number }
export class ConnectionProbe {
  private pending?: Promise<ProbeResult>;
  private controller?: AbortController;
  private epoch = 0;
  private last?: ProbeResult;
  private phase?: 'confirming' | 'running';
  constructor(private deps: {
    settings: () => ServiceConfig | undefined;
    preflight: (config: ServiceConfig) => Promise<string | undefined>;
    confirm: (config: ServiceConfig, text: string) => Promise<boolean>;
    pool: TranslationCoordinator;
    execute?: (run: () => Promise<unknown>, cancel: () => void) => Promise<unknown>;
    changed?: () => void;
  }) {}
  get state(): 'confirming' | 'running' | undefined { return this.phase; }
  get result(): ProbeResult | undefined {
    return this.last && this.last.revision === this.deps.settings()?.revision ? { ...this.last } : undefined;
  }
  private notify(): void { try { this.deps.changed?.(); } catch { /* UI only */ } }
  run(): Promise<ProbeResult> {
    if (this.pending) return this.pending;
    const controller = new AbortController(); this.controller = controller;
    const epoch = this.epoch;
    this.pending = Promise.resolve().then(() => this.perform(controller, epoch)).finally(() => {
      this.phase = undefined; this.controller = undefined; this.pending = undefined; this.notify();
    });
    return this.pending;
  }
  cancel(): void { this.epoch++; this.controller?.abort(); }
  private async perform(controller: AbortController, epoch: number): Promise<ProbeResult> {
    const config = this.deps.settings(); let start = performance.now();
    const valid = () => !controller.signal.aborted && epoch === this.epoch && !!config
      && this.deps.settings()?.revision === config.revision
      && this.deps.settings()?.endpoint === config.endpoint && this.deps.settings()?.model === config.model;
    const check = () => { if (!valid()) throw new TranslationError('cancelled'); };
    let outcome: ProbeResult['outcome'] = 'failed'; let code: string | undefined;
    try {
      if (!config) throw new TranslationError('missing_configuration');
      const issue = await this.deps.preflight(config); check();
      if (issue) throw new TranslationError(issue);
      const state = this.deps.pool.snapshot(config);
      if (state.blockedReason) throw new TranslationError('configuration_blocked');
      if (state.cooldownRemainingMs) throw new TranslationError('cooldown');
      if (state.rateRemainingMs) throw new TranslationError('rate_limited');
      this.phase = 'confirming'; this.notify();
      const confirmed = await this.deps.confirm(config, PROBE_TEXT); check();
      if (!confirmed) throw new TranslationError('cancelled');
      const currentIssue = await this.deps.preflight(config); check();
      if (currentIssue) throw new TranslationError(currentIssue);
      this.phase = 'running'; start = performance.now(); this.notify();
      const run = async () => { check(); await this.deps.pool.acquire([{ id: 'probe0', text: PROBE_TEXT }], config, controller.signal, { purpose: 'diagnostic' }); check(); };
      if (this.deps.execute) await this.deps.execute(run, () => controller.abort()); else await run();
      check(); outcome = 'passed';
    } catch (error) {
      code = safeErrorCode(error instanceof TranslationError ? error.code : 'network');
      if (code === 'cancelled' || controller.signal.aborted || epoch !== this.epoch) { outcome = 'cancelled'; code = 'cancelled'; }
    }
    const result: ProbeResult = { revision: config?.revision ?? -1, outcome, code, elapsedMs: Math.round(performance.now() - start), finishedAt: Date.now() };
    if (valid()) this.last = result;
    return result;
  }
}
