import * as vscode from 'vscode';
import { HoverDiscoveryCoordinator } from './hoverDiscoveryCoordinator.js';
import { extractMarkdown } from '../content/markdownCodec.js';
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
    const version = document.version;
    const valid = () => !controller.signal.aborted && !document.isClosed && document.version === version && deps.settings()?.revision === config.revision;
    try {
      if (!await deps.permitted(config) || !valid()) return undefined;
      const collected = await deps.discovery.collect(() => vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position), controller.signal, config.discoveryTimeoutMs);
      if (collected.kind !== 'collected') { if (collected.kind === 'timeout') deps.onError('source_timeout'); return undefined; }
      if (!valid()) return undefined;
      const contents = (collected.value || []).filter(hover => !hover.range || hover.range.contains(position)).flatMap(hover => hover.contents.flatMap(content => {
        if (typeof content === 'string') return [content];
        if ('language' in content) return []; // Legacy code MarkedString is never prose.
        return [content.value];
      }));
      const doc = extractMarkdown(contents, config.maxChars); if (!doc) return undefined;
      const value = await deps.translations.acquire(doc.segments, config, controller.signal);
      if (!valid()) return undefined;
      const markdown = new vscode.MarkdownString(`### 中文翻译${doc.partial ? '（部分翻译）' : ''}\n\n${doc.render(value, config.paired)}`);
      markdown.isTrusted = false; markdown.supportHtml = false;
      return new vscode.Hover(markdown, document.getWordRangeAtPosition(position) || new vscode.Range(position, position));
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'translation_failed';
      if (code !== 'cancelled') deps.onError(code);
      return undefined;
    } finally { subscription.dispose(); }
  } };
}
