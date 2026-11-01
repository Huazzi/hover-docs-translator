export type HoverMode = 'stable' | 'experimentalTakeover';
export interface OwnedProvider<P> { provider: P; dispose(): void; cancelPending?(): void }
export interface ModeState { requested: HoverMode; effective: HoverMode; reason?: string }

/** Owns exactly one registration. A failed experimental path stays latched until retry. */
export class HoverModeController<P> {
  private registration?: { dispose(): void };
  private owner?: OwnedProvider<P>;
  private generation = 0;
  private disposed = false;
  private state: ModeState = { requested: 'stable', effective: 'stable' };
  constructor(private deps: {
    available: () => Promise<boolean>;
    create: (mode: HoverMode, fail: () => void) => OwnedProvider<P>;
    register: (provider: P, exclusive: boolean) => { dispose(): void };
    report: (state: ModeState) => void;
  }) {}
  get current(): Readonly<ModeState> { return this.state; }
  async select(requested: HoverMode, retry = false): Promise<void> {
    if (this.disposed || (this.registration && this.state.requested === requested && !retry)) return;
    const generation = ++this.generation;
    this.state = { requested, effective: 'stable' };
    this.install('stable'); // Drop exclusive ownership immediately, including on async retries.
    if (requested === 'stable') { this.deps.report(this.state); return; }
    let available = false;
    try { available = await this.deps.available(); } catch { /* guarded fallback */ }
    if (this.disposed || generation !== this.generation) return;
    if (!available) { this.state.reason = 'takeover_command_unavailable'; this.deps.report(this.state); return; }
    try { this.install('experimentalTakeover'); this.state.effective = 'experimentalTakeover'; }
    catch { this.install('stable'); this.state.reason = 'takeover_proposal_unavailable'; }
    this.deps.report(this.state);
  }
  private install(mode: HoverMode): void {
    this.registration?.dispose(); this.registration = undefined;
    this.owner?.dispose(); this.owner = undefined;
    const owner = this.deps.create(mode, () => this.fail());
    try { this.registration = this.deps.register(owner.provider, mode === 'experimentalTakeover'); this.owner = owner; }
    catch (error) { owner.dispose(); throw error; }
  }
  private fail(): void {
    if (this.disposed || this.state.effective !== 'experimentalTakeover') return;
    ++this.generation;
    this.install('stable');
    this.state = { requested: this.state.requested, effective: 'stable', reason: 'takeover_source_failed' };
    this.deps.report(this.state);
  }
  cancelPending(): void { this.owner?.cancelPending?.(); }
  dispose(): void { this.disposed = true; ++this.generation; this.registration?.dispose(); this.owner?.dispose(); }
}
