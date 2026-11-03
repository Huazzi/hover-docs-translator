import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { HoverActivityTracker } from '../../src/hover/hoverActivityTracker.js';
import { createHoverProvider } from '../../src/hover/hoverDocumentProvider.js';
import { ExperimentalHoverProvider } from '../../src/hover/experimentalHoverProvider.js';
import { HoverDiscoveryCoordinator } from '../../src/hover/hoverDiscoveryCoordinator.js';
import { hoverSelectors } from '../../src/hover/hoverDocumentScope.js';
import { TranslationCoordinator } from '../../src/translation/translationCoordinator.js';
import { MemoryTranslationCache } from '../../src/cache/memoryTranslationCache.js';
import { Diagnostics } from '../../src/ui/diagnostics.js';
import { experienceCommands } from '../../src/ui/experienceCommands.js';
import { ConnectionProbe } from '../../src/ui/connectionProbe.js';
import type { LocalDiagnosticSnapshot } from '../../src/ui/configurationDiagnostics.js';
import type { Settings } from '../../src/config/settingsService.js';
import { hoverText, captureVisibleHover, quickPickText } from './renderer.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 100; i++) { if (check()) return; await sleep(30); }
  throw new Error(label);
}
export async function experienceRegression(proposed: boolean): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'sample.js'));
  const editor = await vscode.window.showTextDocument(document); const position = new vscode.Position(3, 1);
  editor.selection = new vscode.Selection(position, position);
  const settings: Settings = { endpoint: 'https://example.com/chat/completions', model: 'test', revision: 1, timeoutMs: 5000, concurrent: 2, queueSize: 8, perMinute: 120, enabled: true, paired: false, maxChars: 6000, discoveryTimeoutMs: 5000, cacheEntries: 500, cacheTtlMs: 86400000 };
  let release!: () => void; let calls = 0;
  const diagnostics = new Diagnostics(); diagnostics.readiness(undefined);
  const tracker = new HoverActivityTracker(() => diagnostics.update(tracker.snapshot(), pool.snapshot(settings), false));
  const pool = new TranslationCoordinator(async segments => {
    calls++; await new Promise<void>(resolve => { release = resolve; });
    return Object.fromEntries(segments.map(s => [s.id, s.text.split(/(⟦HDT_[^⟧]*⟧)/g).map(part => part.startsWith('⟦HDT_') ? part : part.trim() ? '等待体验中文说明。' : part).join('')]));
  }, new MemoryTranslationCache());
  tracker.setView(document.uri.toString());
  const deps = { translations: pool, settings: () => settings, activities: tracker, modeGeneration: 1, permitted: async () => true, onError: (code: string) => assert.fail(code) };
  const provider = proposed ? new ExperimentalHoverProvider({ ...deps, waitMs: () => 80, sourceFailed: () => assert.fail('source') })
    : createHoverProvider({ ...deps, discovery: new HoverDiscoveryCoordinator() });
  const registration = vscode.languages.registerHoverProvider(hoverSelectors(proposed), provider);
  const snapshot: LocalDiagnosticSnapshot = {
    extensionVersion: 'fixture', vscodeVersion: vscode.version, platform: process.platform,
    configuration: { endpointConfigured: true, modelConfigured: true }, keyPresent: true, local: true, trusted: true, enabled: true, documentConsent: true,
    document: { language: 'javascript', kind: 'file' }, mode: { requested: 'stable', effective: 'stable' },
    discovery: 'idle', service: pool.snapshot(settings),
  };
  const probe = new ConnectionProbe({ settings: () => settings, pool, preflight: async () => undefined, confirm: async () => false });
  const commands = experienceCommands({ settings: () => settings, localSnapshot: async () => snapshot, activities: tracker, probe, modeGeneration: () => 1 });
  try {
    const registered = await vscode.commands.getCommands(true);
    for (const name of ['showCurrentHover', 'checkConfiguration', 'testConnection', 'copyDiagnosticSummary']) assert(registered.includes('hoverDocsTranslator.' + name), name);
    await vscode.commands.executeCommand('editor.action.hideHover');
    await commands.showCurrentHover();
    await until(() => calls === 1, 'manual caret command must start provider');
    assert.equal(tracker.snapshot()?.stage, 'requesting');
    if (proposed) {
      await until(() => !!tracker.snapshot()?.background, 'takeover must report background');
      assert((await hoverText()).includes('greeting'));
      await vscode.commands.executeCommand('editor.action.hideHover');
    }
    release(); await until(() => tracker.snapshot()?.outcome === 'completed', 'success activity');
    if (proposed) {
      await sleep(100); assert.equal(await hoverText(), '', 'background completion must not reopen hover');
      await commands.showCurrentHover();
    }
    let visible = '';
    for (let i = 0; i < 40; i++) { visible = await hoverText(); if (visible.includes('等待体验中文说明')) break; await sleep(100); }
    assert(visible.includes('等待体验中文说明'), visible); assert.equal(calls, 1);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, '..', '..', '.vscode-test', 'experience-' + proposed + '.png'), await captureVisibleHover());
    await vscode.commands.executeCommand('editor.action.hideHover');
    // A command paused in a local credential check cannot later target a changed caret.
    let resume!: (snapshot: LocalDiagnosticSnapshot) => void;
    const delayed = experienceCommands({ settings: () => settings, localSnapshot: () => new Promise(resolve => { resume = resolve; }), activities: tracker, probe, modeGeneration: () => 1 });
    const pending = delayed.showCurrentHover(); editor.selection = new vscode.Selection(0, 0, 0, 0);
    resume(snapshot); await pending; await sleep(100); assert.equal(await hoverText(), '');
    assert.equal(calls, 1);
    const localCheck = vscode.commands.executeCommand('hoverDocsTranslator.checkConfiguration');
    let checkText = '';
    for (let i = 0; i < 40; i++) { checkText = await quickPickText(); if (checkText.includes('API Key')) break; await sleep(50); }
    assert(checkText.includes('未发送网络请求'), checkText); assert(checkText.includes('API Key'), checkText);
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen'); await localCheck;
    assert.equal(calls, 1, 'Local inspection must not acquire document translation');
    console.log('EXPERIENCE PASS proposed=' + proposed + ': manual caret, stages, completion, cache, no reopening, stale command');
  } finally { registration.dispose(); if (provider instanceof ExperimentalHoverProvider) provider.dispose(); pool.reset(); tracker.dispose(); diagnostics.dispose(); }
}
