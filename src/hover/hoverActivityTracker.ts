import type { WorkEvent } from '../translation/translationCoordinator.js';
export interface HoverTarget {
  uri: string; version: number; line: number; character: number;
  revision: number; modeGeneration: number; notebookUri?: string;
}
export type Stage = 'collecting' | 'queued' | 'requesting' | 'rendering';
export type Outcome = 'completed' | 'no_document' | 'no_translatable_text' | 'preserved' | 'failed' | 'cancelled';
export interface SafeDetail { code?: string; budgetPreserved?: number; unsafePreserved?: number }
export interface ActivitySnapshot extends SafeDetail {
  stage: Stage; outcome?: Outcome; background: boolean; cacheHit: boolean; shared: boolean;
  elapsedMs: number; durations: Partial<Record<Stage, number>>;
}
interface Entry {
  id: number; target: HoverTarget; value: ActivitySnapshot; started: number; stageAt: number;
}
export interface ActivityHandle {
  stage(value: Stage): void; observe(event: WorkEvent): void; background(): void;
  finish(outcome: Outcome, detail?: SafeDetail): void;
}
/** Observation only. Providers remain the owners of cancellation and background work. */
export class HoverActivityTracker {
  private sequence = 0;
  private active = new Map<number, Entry>();
  private selected?: Entry;
  private viewUri?: string;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(private changed: () => void = () => {}, private now = () => performance.now(), private recentMs = 5000) {}
  private notify(): void { try { this.changed(); } catch { /* non-critical UI */ } }
  setView(uri?: string): void {
    this.viewUri = uri; this.selected = undefined; clearTimeout(this.expiry); this.notify();
  }
  invalidate(uri?: string): void {
    for (const [id, entry] of this.active) if (!uri || entry.target.uri === uri || entry.target.notebookUri === uri) this.active.delete(id);
    if (!uri || this.selected?.target.uri === uri || this.selected?.target.notebookUri === uri) {
      this.selected = undefined; clearTimeout(this.expiry);
    }
    this.notify();
  }
  snapshot(): ActivitySnapshot | undefined {
    const entry = this.selected;
    if (!entry) return undefined;
    return { ...entry.value, durations: { ...entry.value.durations },
      elapsedMs: entry.value.outcome ? entry.value.elapsedMs : Math.round(this.now() - entry.started) };
  }
  pendingAt(target: HoverTarget): ActivitySnapshot | undefined {
    const entry = [...this.active.values()].reverse().find(e => e.target.uri === target.uri
      && e.target.version === target.version && e.target.line === target.line && e.target.character === target.character
      && e.target.revision === target.revision && e.target.modeGeneration === target.modeGeneration);
    if (!entry || this.viewUri !== target.uri) return undefined;
    this.selected = entry; clearTimeout(this.expiry); this.notify(); return this.snapshot();
  }
  begin(target: HoverTarget): ActivityHandle {
    const entry: Entry = { id: ++this.sequence, target, started: this.now(), stageAt: this.now(),
      value: { stage: 'collecting', background: false, cacheHit: false, shared: false, elapsedMs: 0, durations: {} } };
    this.active.set(entry.id, entry);
    if (this.viewUri === target.uri) { this.selected = entry; clearTimeout(this.expiry); }
    this.notify();
    const valid = () => this.active.get(entry.id) === entry;
    const stage = (value: Stage) => {
      if (!valid() || value === entry.value.stage) return;
      entry.value.durations[entry.value.stage] = Math.round(this.now() - entry.stageAt);
      entry.value.stage = value; entry.stageAt = this.now(); this.notify();
    };
    return {
      stage,
      observe: event => {
        if (!valid()) return;
        if (event.kind === 'cache_hit') entry.value.cacheHit = true;
        else { entry.value.shared = event.shared; stage(event.kind); }
        this.notify();
      },
      background: () => { if (valid()) { entry.value.background = true; this.notify(); } },
      finish: (outcome, detail = {}) => {
        if (!valid()) return;
        entry.value.durations[entry.value.stage] = Math.round(this.now() - entry.stageAt);
        entry.value = { ...entry.value, ...detail, outcome, elapsedMs: Math.round(this.now() - entry.started) };
        this.active.delete(entry.id);
        if (this.selected === entry) {
          if (outcome === 'cancelled') this.selected = undefined;
          else this.expiry = setTimeout(() => {
            if (this.selected === entry) { this.selected = undefined; this.notify(); }
          }, this.recentMs);
        }
        this.notify();
      },
    };
  }
  dispose(): void { clearTimeout(this.expiry); this.active.clear(); this.selected = undefined; }
}
