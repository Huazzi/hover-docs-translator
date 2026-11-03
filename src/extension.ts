import * as vscode from 'vscode';
import { readSettings, userSetting, NAMESPACE, hoverMode, takeoverWaitMs, type Settings } from './config/settingsService.js';
import { CredentialStore } from './security/credentialStore.js';
import { ConsentStore } from './security/consentStore.js';
import { MemoryTranslationCache } from './cache/memoryTranslationCache.js';
import { createTranslator } from './translation/chatCompletionsClient.js';
import { TranslationCoordinator } from './translation/translationCoordinator.js';
import { HoverDiscoveryCoordinator } from './hover/hoverDiscoveryCoordinator.js';
import { createHoverProvider } from './hover/hoverDocumentProvider.js';
import { Diagnostics } from './ui/diagnostics.js';
import { registerCommands } from './ui/commands.js';
import { applyConfigurationChange, ServiceIdentity } from './config/settingsChange.js';
import { HoverModeController } from './hover/hoverModeController.js';
import { ExperimentalHoverProvider } from './hover/experimentalHoverProvider.js';
import { hoverSelectors, resolveHoverDocument } from './hover/hoverDocumentScope.js';
import { HoverActivityTracker } from './hover/hoverActivityTracker.js';
import { ConnectionProbe } from './ui/connectionProbe.js';
import { inspectConfiguration, type LocalDiagnosticSnapshot } from './ui/configurationDiagnostics.js';
import { experienceCommands } from './ui/experienceCommands.js';
import { TranslationError } from './translation/contracts.js';

export function activate(context: vscode.ExtensionContext): void {
  let revision = 0; let config: Settings | undefined; let modeGeneration = 0; let disposed = false;
  let modes: HoverModeController<vscode.HoverProvider> | undefined;
  let translations: TranslationCoordinator; let probe: ConnectionProbe;
  const diagnostics = new Diagnostics(); const credentials = new CredentialStore(context.secrets);
  const consent = new ConsentStore(context.globalState); const identity = new ServiceIdentity();
  const discovery = new HoverDiscoveryCoordinator();
  const paint = () => {
    if (!disposed && translations) diagnostics.update(activities.snapshot(), translations.snapshot(config), probe?.state === 'running');
  };
  const activities = new HoverActivityTracker(paint);
  const updateView = () => activities.setView(vscode.window.activeTextEditor?.document.uri.toString());
  translations = new TranslationCoordinator(createTranslator(async endpoint => credentials.get(endpoint)), new MemoryTranslationCache(), paint, code => diagnostics.error(code));
  const settings = () => config;
  const preflight = async (current: { endpoint: string }) => {
    if (vscode.env.remoteName || !vscode.workspace.isTrusted) return 'unsupported_environment';
    return await credentials.get(current.endpoint) ? undefined : 'missing_key';
  };
  probe = new ConnectionProbe({
    settings, preflight, pool: translations, changed: paint,
    confirm: async (current, text) => (await vscode.window.showInformationMessage(
      '请求地址：' + current.endpoint + '\n模型：' + current.model
      + '\n\n仅发送以下固定文段及翻译指令（标记代表 None）：\n' + text
      + '\n\n最多一次 API 请求，可能产生费用。不发送项目文档，也不会启用自动文档发送。',
      { modal: true }, '发送一次测试')) === '发送一次测试',
    execute: async (run, cancel) => vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification, title: '悬浮翻译：测试固定样本', cancellable: true,
    }, async (_progress, token) => {
      const listener = token.onCancellationRequested(cancel);
      try { if (token.isCancellationRequested) cancel(); await run(); } finally { listener.dispose(); }
    }),
  });
  const refresh = (credentialChange = false) => {
    modes?.cancelPending(); probe.cancel(); activities.invalidate(); revision++;
    let invalid = false;
    try { config = readSettings(revision); } catch { config = undefined; invalid = true; }
    const changed = identity.update(config);
    translations.reset(new MemoryTranslationCache(config?.cacheEntries, config?.cacheTtlMs), { releaseConfigurationBlock: changed || credentialChange });
    const current = config; const epoch = revision;
    diagnostics.readiness(vscode.env.remoteName || !vscode.workspace.isTrusted ? 'unsupported_environment'
      : !current ? invalid ? 'invalid_configuration' : 'missing_configuration'
        : !consent.has(current.endpoint) && current.enabled ? 'consent_required' : undefined, current?.enabled);
    if (current) void preflight(current).then(issue => {
      if (disposed || epoch !== revision) return;
      diagnostics.readiness(issue ?? (current.enabled && !consent.has(current.endpoint) ? 'consent_required' : undefined), current.enabled);
    }).catch(() => { if (!disposed && epoch === revision) diagnostics.readiness('missing_key', current.enabled); });
    paint();
  };
  refresh(); updateView();
  const shared = { translations, settings, activities, onError: (code: string) => diagnostics.error(code),
    permitted: async (current: Settings) => {
      if (!consent.has(current.endpoint)) return false;
      const issue = await preflight(current);
      if (issue && config?.revision === current.revision) diagnostics.readiness(issue, current.enabled);
      return !issue;
    } };
  modes = new HoverModeController({
    available: async () => (await vscode.commands.getCommands(false)).includes('_executeHoverProvider_recursive'),
    create(mode, sourceFailed) {
      const generation = ++modeGeneration; activities.invalidate();
      if (mode === 'experimentalTakeover') {
        const provider = new ExperimentalHoverProvider({ ...shared, modeGeneration: generation, sourceFailed, waitMs: takeoverWaitMs });
        return { provider, dispose: () => provider.dispose(), cancelPending: () => provider.cancelPending() };
      }
      const lifetime = new AbortController();
      return { provider: createHoverProvider({ ...shared, modeGeneration: generation, discovery, lifetime: lifetime.signal }), dispose: () => lifetime.abort() };
    },
    register: (provider, exclusive) => vscode.languages.registerHoverProvider(hoverSelectors(exclusive), provider),
    report: state => diagnostics.mode(state),
  });
  void modes.select(hoverMode());
  const localSnapshot = async (): Promise<LocalDiagnosticSnapshot> => {
    const epoch = revision; const current = config;
    const inspection = inspectConfiguration(userSetting('apiBaseUrl', ''), userSetting('model', ''));
    const keyPresent = inspection.endpoint ? !!await credentials.get(inspection.endpoint) : false;
    if (epoch !== revision || disposed) throw new TranslationError('stale');
    const document = vscode.window.activeTextEditor?.document;
    const scope = document && resolveHoverDocument(document);
    return {
      extensionVersion: context.extension.packageJSON.version, vscodeVersion: vscode.version, platform: process.platform,
      configuration: { endpointConfigured: inspection.endpointConfigured, modelConfigured: inspection.modelConfigured, issue: inspection.issue },
      keyPresent, local: !vscode.env.remoteName, trusted: vscode.workspace.isTrusted, enabled: userSetting('enabled', true),
      documentConsent: inspection.endpoint ? consent.has(inspection.endpoint) : false,
      document: { language: document?.languageId ?? '', kind: !document ? 'none' : !scope ? 'unsupported' : scope.notebook ? 'notebook' : 'file' },
      mode: modes!.current, discovery: discovery.state, service: translations.snapshot(current), activity: activities.snapshot(), probe: probe.result,
    };
  };
  const timer = setInterval(paint, 1000);
  context.subscriptions.push(diagnostics, discovery, activities, modes, { dispose() {
    disposed = true; clearInterval(timer); probe.cancel(); translations.reset();
  } });
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateView),
    vscode.window.onDidChangeTextEditorSelection(event => { if (event.textEditor === vscode.window.activeTextEditor) updateView(); }),
    vscode.workspace.onDidChangeTextDocument(event => activities.invalidate(event.document.uri.toString())),
    vscode.workspace.onDidCloseTextDocument(document => activities.invalidate(document.uri.toString())),
    vscode.workspace.onDidCloseNotebookDocument(notebook => activities.invalidate(notebook.uri.toString())),
    vscode.window.tabGroups.onDidChangeTabs(event => {
      for (const tab of event.closed) if (tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputNotebook) activities.invalidate(tab.input.uri.toString());
    }),
    vscode.workspace.onDidChangeNotebookDocument(event => {
      for (const change of event.contentChanges) for (const cell of change.removedCells) activities.invalidate(cell.document.uri.toString());
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(NAMESPACE)) {
        applyConfigurationChange(config, () => readSettings(revision), next => { config = next; }, () => refresh());
        if (event.affectsConfiguration(NAMESPACE + '.hoverMode')) void modes!.select(hoverMode());
      }
    }),
    context.secrets.onDidChange(event => { if (config && credentials.matches(config.endpoint, event.key)) refresh(true); }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => refresh()),
  );
  registerCommands(context, {
    settings, credentials, consent, invalidate: refresh,
    clearCache: () => { modes?.cancelPending(); probe.cancel(); activities.invalidate(); translations.reset(); },
    diagnostics, modeState: () => modes!.current, retryMode: () => modes!.select(hoverMode(), true),
    experience: experienceCommands({ settings, localSnapshot, activities, probe, modeGeneration: () => modeGeneration }),
  });
}
