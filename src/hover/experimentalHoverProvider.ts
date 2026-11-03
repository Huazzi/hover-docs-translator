import * as vscode from 'vscode';
import type { ProviderDependencies } from './hoverDocumentProvider.js';
import { analyzeTakeover } from '../content/takeoverHoverContent.js';
import { RecursiveHoverReader } from './recursiveHoverReader.js';
import { waitFor } from './asyncWait.js';
import { resolveHoverDocument, notebookContains } from './hoverDocumentScope.js';

export const RECURSIVE_HOVER_COMMAND = 'vscode.experimental.executeHoverProvider_recursive';
type Dependencies = Omit<ProviderDependencies, 'discovery'> & {
  waitMs: () => number;
  sourceFailed: () => void;
  readSource?: (document: vscode.TextDocument, position: vscode.Position) => PromiseLike<vscode.Hover[]>;
};

/** Separate from the append provider: once exclusive, collected originals are our responsibility. */
export class ExperimentalHoverProvider implements vscode.HoverProvider, vscode.Disposable {
  private reader = new RecursiveHoverReader<vscode.Hover[]>();
  private active = new Map<AbortController, { documentUri: string; notebookUri?: string }>();
  private translating = 0;
  private disposed = false;
  private listeners: vscode.Disposable[];
  constructor(private deps: Dependencies) {
    const cancel = (uri: vscode.Uri) => { for (const [controller, key] of this.active) if (key.documentUri === uri.toString()) controller.abort(); };
    const cancelNotebook = (uri: vscode.Uri) => { for (const [controller, key] of this.active) if (key.notebookUri === uri.toString()) controller.abort(); };
    this.listeners = [
      vscode.workspace.onDidChangeTextDocument(event => cancel(event.document.uri)),
      vscode.workspace.onDidCloseTextDocument(document => cancel(document.uri)),
      vscode.workspace.onDidCloseNotebookDocument(notebook => cancelNotebook(notebook.uri)),
      vscode.workspace.onDidChangeNotebookDocument(event => {
        for (const change of event.contentChanges) for (const cell of change.removedCells) cancel(cell.document.uri);
      }),
      vscode.window.tabGroups.onDidChangeTabs(event => {
        for (const tab of event.closed) if (tab.input instanceof vscode.TabInputText) cancel(tab.input.uri);
        for (const tab of event.closed) if (tab.input instanceof vscode.TabInputNotebook) cancelNotebook(tab.input.uri);
      }),
    ];
  }
  cancelPending(): void { for (const controller of this.active.keys()) controller.abort(); }
  dispose(): void { this.disposed = true; this.cancelPending(); this.reader.dispose(); this.listeners.forEach(listener => listener.dispose()); }
  async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
    if (this.disposed || token.isCancellationRequested) return undefined;
    const scope = resolveHoverDocument(document); if (!scope) return undefined;
    const config = this.deps.settings(); const version = document.version;
    const activity = this.deps.activities?.begin({ uri: document.uri.toString(), version, line: position.line, character: position.character,
      revision: config?.revision ?? -1, modeGeneration: this.deps.modeGeneration ?? 0, notebookUri: scope.notebook?.uri.toString() });
    const controller = new AbortController(); this.active.set(controller, { documentUri: document.uri.toString(), notebookUri: scope.notebook?.uri.toString() });
    const subscription = token.onCancellationRequested(() => controller.abort());
    const valid = () => !this.disposed && !controller.signal.aborted && !document.isClosed && notebookContains(scope, document) && document.version === version && this.deps.settings()?.revision === config?.revision;
    const cleanup = () => { activity?.finish('cancelled'); subscription.dispose(); this.active.delete(controller); };
    let background = false;
    try {
      const key = JSON.stringify([document.uri.toString(), version, position.line, position.character]);
      const result = await this.reader.collect(key, () => this.deps.readSource
        ? this.deps.readSource(document, position)
        : vscode.commands.executeCommand<vscode.Hover[]>(RECURSIVE_HOVER_COMMAND, document.uri, position), controller.signal, config?.discoveryTimeoutMs ?? 5000);
      if (!valid()) return undefined;
      if (result.kind !== 'value') {
        activity?.finish(result.kind === 'cancelled' ? 'cancelled' : 'failed', { code: 'source_' + result.kind });
        if (result.kind !== 'cancelled') this.deps.sourceFailed();
        return undefined;
      }
      const sources = (result.value || []).filter(hover => !hover.range || hover.range.contains(position));
      const contents = sources.flatMap(hover => hover.contents);
      if (!contents.length) { activity?.finish('no_document'); return undefined; }
      // Use the intersection of applicable source ranges; do not extend a narrow source's validity.
      const range = sources.reduce<vscode.Range | undefined>((range, hover) => hover.range ? range?.intersection(hover.range) ?? hover.range : range, undefined)
        ?? document.getWordRangeAtPosition(position) ?? new vscode.Range(position, position);
      const original = new vscode.Hover(contents, range);
      if (!config?.enabled) return original;
      try {
        if (!await this.deps.permitted(config)) return valid() ? original : undefined;
        if (!valid()) return undefined;
        const analysis = analyzeTakeover(contents, config.maxChars); const prepared = analysis.document;
        if (!prepared) { activity?.finish(analysis.summary.unsafePreserved || analysis.summary.budgetPreserved ? 'preserved' : 'no_translatable_text', analysis.summary); return original; }
        if (this.translating >= config.concurrent + config.queueSize) { activity?.finish('failed', { code: 'queue_full' }); return original; }
        this.translating++;
        // This subscription remains owned by this provider after the UI deadline. It is still
        // cancelled on document edits/close, permission/service changes, mode switch and disposal.
        const work = this.deps.translations.acquire(prepared.segments, config, controller.signal, { observe: activity?.observe }).then(value => {
          if (!valid()) return undefined;
          activity?.stage('rendering');
          const translated = new vscode.Hover(prepared.render(value, config.paired), range);
          activity?.finish('completed', analysis.summary);
          return translated;
        }).catch(error => {
          if (valid()) {
            const code = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'translation_failed';
            activity?.finish(code === 'cancelled' ? 'cancelled' : 'failed', { code });
            if (code !== 'cancelled') this.deps.onError(code);
            return original;
          }
          return undefined;
        }).finally(() => { this.translating--; cleanup(); });
        const waited = await waitFor(work, controller.signal, this.deps.waitMs());
        if (!valid()) return undefined;
        if (waited.kind === 'value') return waited.value;
        if (waited.kind === 'timeout') {
          background = true;
          activity?.background();
          subscription.dispose(); // A hover closing after early return must not kill cache warming.
          return original;
        }
        return waited.kind === 'failed' ? original : undefined;
      } catch { if (valid()) { activity?.finish('failed', { code: 'translation_failed' }); this.deps.onError('translation_failed'); } return valid() ? original : undefined; }
    } catch { if (valid()) { activity?.finish('failed', { code: 'source_failed' }); this.deps.sourceFailed(); } return undefined; }
    finally { if (!background) cleanup(); }
  }
}
