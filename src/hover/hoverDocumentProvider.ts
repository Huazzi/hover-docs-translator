import * as vscode from 'vscode';
import { HoverDiscoveryCoordinator } from './hoverDiscoveryCoordinator.js';
import { analyzeMarkdown } from '../content/markdownCodec.js';
import { hoverMarkdown } from '../content/hoverMarkdownRenderer.js';
import type { Settings } from '../config/settingsService.js';
import type { TranslationCoordinator } from '../translation/translationCoordinator.js';
import { resolveHoverDocument, notebookContains } from './hoverDocumentScope.js';
import type { HoverActivityTracker } from './hoverActivityTracker.js';
export interface ProviderDependencies {
  discovery: HoverDiscoveryCoordinator;
  translations: TranslationCoordinator;
  settings: () => Settings | undefined;
  permitted: (settings: Settings) => Promise<boolean>;
  onError: (code: string) => void;
  lifetime?: AbortSignal;
  activities?: HoverActivityTracker;
  modeGeneration?: number;
}
export function createHoverProvider(deps: ProviderDependencies): vscode.HoverProvider {
  return { async provideHover(document, position, token) {
    if (deps.discovery.busy || deps.lifetime?.aborted) return undefined;
    const config = deps.settings();
    const scope = resolveHoverDocument(document);
    if (!config?.enabled || token.isCancellationRequested || !scope) return undefined;
    const controller = new AbortController();
    const subscription = token.onCancellationRequested(() => controller.abort());
    const dispose = () => controller.abort();
    deps.lifetime?.addEventListener('abort', dispose, { once: true });
    const sameDocument = (changed: vscode.TextDocument) => changed.uri.toString() === document.uri.toString();
    const changed = vscode.workspace.onDidChangeTextDocument(event => { if (sameDocument(event.document)) controller.abort(); });
    const closed = vscode.workspace.onDidCloseTextDocument(doc => { if (sameDocument(doc)) controller.abort(); });
    const notebookClosed = vscode.workspace.onDidCloseNotebookDocument(notebook => { if (notebook === scope.notebook) controller.abort(); });
    const notebookChanged = vscode.workspace.onDidChangeNotebookDocument(event => {
      if (event.notebook === scope.notebook && event.contentChanges.some(change => change.removedCells.some(cell => sameDocument(cell.document)))) controller.abort();
    });
    // Closing a tab does not always immediately unload its TextDocument model.
    const tabs = vscode.window.tabGroups.onDidChangeTabs(event => {
      if (event.closed.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString())) controller.abort();
      if (scope.notebook && event.closed.some(tab => tab.input instanceof vscode.TabInputNotebook && tab.input.uri.toString() === scope.notebook!.uri.toString())) controller.abort();
    });
    const version = document.version;
    const activity = deps.activities?.begin({ uri: document.uri.toString(), version, line: position.line, character: position.character,
      revision: config.revision, modeGeneration: deps.modeGeneration ?? 0, notebookUri: scope.notebook?.uri.toString() });
    const valid = () => !controller.signal.aborted && !document.isClosed && notebookContains(scope, document) && document.version === version && deps.settings()?.revision === config.revision;
    try {
      if (!await deps.permitted(config) || !valid()) { activity?.finish('cancelled'); return undefined; }
      const collected = await deps.discovery.collect(() => vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position), controller.signal, config.discoveryTimeoutMs);
      if (collected.kind !== 'collected') {
        activity?.finish(collected.kind === 'cancelled' ? 'cancelled' : 'failed', { code: 'source_' + collected.kind });
        if (collected.kind === 'timeout') deps.onError('source_timeout'); return undefined;
      }
      if (!valid()) return undefined;
      const contents = (collected.value || []).filter(hover => !hover.range || hover.range.contains(position)).flatMap((hover, sourceId) => hover.contents.flatMap((content, contentIndex) => {
        if (typeof content === 'string') return [{ value: content, sourceId, contentIndex }];
        if ('language' in content) return []; // Legacy code MarkedString is never prose.
        return [{ value: content.value, sourceId, contentIndex }];
      }));
      const analysis = analyzeMarkdown(contents, config.maxChars); const doc = analysis.document;
      if (!doc) {
        activity?.finish(!contents.length ? 'no_document' : analysis.summary.budgetPreserved ? 'preserved' : 'no_translatable_text', analysis.summary);
        return undefined;
      }
      const value = await deps.translations.acquire(doc.segments, config, controller.signal, { observe: activity?.observe });
      if (!valid()) return undefined;
      activity?.stage('rendering');
      const markdown = new vscode.MarkdownString(hoverMarkdown(doc.render(value, config.paired), doc.partial));
      markdown.isTrusted = false; markdown.supportHtml = false;
      const result = new vscode.Hover(markdown, document.getWordRangeAtPosition(position) || new vscode.Range(position, position));
      activity?.finish('completed', analysis.summary);
      return result;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'translation_failed';
      activity?.finish(code === 'cancelled' || !valid() ? 'cancelled' : 'failed', { code });
      if (code !== 'cancelled' && valid()) deps.onError(code);
      return undefined;
    } finally { activity?.finish('cancelled'); subscription.dispose(); deps.lifetime?.removeEventListener('abort', dispose); changed.dispose(); closed.dispose(); notebookClosed.dispose(); notebookChanged.dispose(); tabs.dispose(); }
  } };
}
