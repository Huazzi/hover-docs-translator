import * as vscode from 'vscode';
import { HoverDiscoveryCoordinator } from './hoverDiscoveryCoordinator.js';
import { extractMarkdown } from '../content/markdownCodec.js';
import { hoverMarkdown } from '../content/hoverMarkdownRenderer.js';
import type { Settings } from '../config/settingsService.js';
import type { TranslationCoordinator } from '../translation/translationCoordinator.js';
export interface ProviderDependencies {
  discovery: HoverDiscoveryCoordinator;
  translations: TranslationCoordinator;
  settings: () => Settings | undefined;
  permitted: (settings: Settings) => Promise<boolean>;
  onError: (code: string) => void;
}
export function createHoverProvider(deps: ProviderDependencies): vscode.HoverProvider {
  return { async provideHover(document, position, token) {
    if (deps.discovery.busy) return undefined;
    const config = deps.settings();
    if (!config?.enabled || token.isCancellationRequested || document.uri.scheme !== 'file' || !['python', 'javascript'].includes(document.languageId)) return undefined;
    const controller = new AbortController();
    const subscription = token.onCancellationRequested(() => controller.abort());
    const sameDocument = (changed: vscode.TextDocument) => changed.uri.toString() === document.uri.toString();
    const changed = vscode.workspace.onDidChangeTextDocument(event => { if (sameDocument(event.document)) controller.abort(); });
    const closed = vscode.workspace.onDidCloseTextDocument(doc => { if (sameDocument(doc)) controller.abort(); });
    // Closing a tab does not always immediately unload its TextDocument model.
    const tabs = vscode.window.tabGroups.onDidChangeTabs(event => {
      if (event.closed.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString())) controller.abort();
    });
    const version = document.version;
    const valid = () => !controller.signal.aborted && !document.isClosed && document.version === version && deps.settings()?.revision === config.revision;
    try {
      if (!await deps.permitted(config) || !valid()) return undefined;
      const collected = await deps.discovery.collect(() => vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position), controller.signal, config.discoveryTimeoutMs);
      if (collected.kind !== 'collected') { if (collected.kind === 'timeout') deps.onError('source_timeout'); return undefined; }
      if (!valid()) return undefined;
      const contents = (collected.value || []).filter(hover => !hover.range || hover.range.contains(position)).flatMap((hover, sourceId) => hover.contents.flatMap((content, contentIndex) => {
        if (typeof content === 'string') return [{ value: content, sourceId, contentIndex }];
        if ('language' in content) return []; // Legacy code MarkedString is never prose.
        return [{ value: content.value, sourceId, contentIndex }];
      }));
      const doc = extractMarkdown(contents, config.maxChars); if (!doc) return undefined;
      const value = await deps.translations.acquire(doc.segments, config, controller.signal);
      if (!valid()) return undefined;
      const markdown = new vscode.MarkdownString(hoverMarkdown(doc.render(value, config.paired), doc.partial));
      markdown.isTrusted = false; markdown.supportHtml = false;
      return new vscode.Hover(markdown, document.getWordRangeAtPosition(position) || new vscode.Range(position, position));
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'translation_failed';
      if (code !== 'cancelled') deps.onError(code);
      return undefined;
    } finally { subscription.dispose(); changed.dispose(); closed.dispose(); tabs.dispose(); }
  } };
}
