import * as vscode from 'vscode';
import { readSettings, NAMESPACE, hoverMode, takeoverWaitMs, type Settings } from './config/settingsService.js';
import { CredentialStore } from './security/credentialStore.js';
import { ConsentStore } from './security/consentStore.js';
import { MemoryTranslationCache } from './cache/memoryTranslationCache.js';
import { createTranslator } from './translation/chatCompletionsClient.js';
import { TranslationCoordinator } from './translation/translationCoordinator.js';
import { HoverDiscoveryCoordinator } from './hover/hoverDiscoveryCoordinator.js';
import { createHoverProvider } from './hover/hoverDocumentProvider.js';
import { Diagnostics } from './ui/diagnostics.js';
import { registerCommands } from './ui/commands.js';
import { applyConfigurationChange } from './config/settingsChange.js';
import { HoverModeController } from './hover/hoverModeController.js';
import { ExperimentalHoverProvider } from './hover/experimentalHoverProvider.js';
import { hoverSelectors } from './hover/hoverDocumentScope.js';
export function activate(context: vscode.ExtensionContext): void {
  let revision = 0; let config: Settings | undefined;
  let modes: HoverModeController<vscode.HoverProvider> | undefined;
  const diagnostics = new Diagnostics(); const credentials = new CredentialStore(context.secrets); const consent = new ConsentStore(context.globalState);
  const discovery = new HoverDiscoveryCoordinator();
  const translations = new TranslationCoordinator(createTranslator(async endpoint => credentials.get(endpoint)), new MemoryTranslationCache(), count => diagnostics.active(count), code => diagnostics.error(code));
  const refresh = () => {
    modes?.cancelPending();
    revision++;
    try { config = readSettings(revision); } catch { config = undefined; diagnostics.error('invalid_configuration'); }
    translations.reset(new MemoryTranslationCache(config?.cacheEntries, config?.cacheTtlMs));
    diagnostics.state(vscode.env.remoteName ? '首版暂不支持远程窗口' : !config ? '请配置接口、模型和密钥' : !config.enabled ? '自动翻译已暂停' : !consent.has(config.endpoint) ? '请确认云端发送' : '自动翻译就绪');
  };
  refresh();
  const settings = () => config;
  const shared = { translations, settings, onError: (code: string) => diagnostics.error(code), permitted: async (current: Settings) => {
    if (vscode.env.remoteName || !vscode.workspace.isTrusted || !consent.has(current.endpoint)) return false;
    if (!await credentials.get(current.endpoint)) { diagnostics.state('请设置当前接口的 API Key'); return false; }
    return true;
  } };
  modes = new HoverModeController({
    // getCommands lists the internal backend, not the typed API alias used by executeCommand.
    available: async () => (await vscode.commands.getCommands(false)).includes('_executeHoverProvider_recursive'),
    create(mode, sourceFailed) {
      if (mode === 'experimentalTakeover') {
        const provider = new ExperimentalHoverProvider({ ...shared, sourceFailed, waitMs: takeoverWaitMs });
        return { provider, dispose: () => provider.dispose(), cancelPending: () => provider.cancelPending() };
      }
      const lifetime = new AbortController();
      return { provider: createHoverProvider({ ...shared, discovery, lifetime: lifetime.signal }), dispose: () => lifetime.abort() };
    },
    register(provider, exclusive) {
      // Runtime registration is the capability gate. Do not claim proposal support from the manifest.
      return vscode.languages.registerHoverProvider(hoverSelectors(exclusive), provider);
    },
    report: state => diagnostics.mode(state),
  });
  void modes.select(hoverMode());
  context.subscriptions.push(diagnostics, discovery, { dispose: () => translations.reset() }, modes);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration(NAMESPACE)) {
      applyConfigurationChange(config, () => readSettings(revision), next => { config = next; }, refresh);
      if (event.affectsConfiguration(`${NAMESPACE}.hoverMode`)) void modes!.select(hoverMode());
    }
  }), context.secrets.onDidChange(refresh), vscode.workspace.onDidGrantWorkspaceTrust(refresh));
  registerCommands(context, { settings, credentials, consent, invalidate: refresh, clearCache: () => { modes?.cancelPending(); translations.reset(undefined, false); }, diagnostics, modeState: () => modes!.current, retryMode: () => modes!.select(hoverMode(), true) });
}
