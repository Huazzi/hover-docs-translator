import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { HoverDiscoveryCoordinator } from '../../src/hover/hoverDiscoveryCoordinator.js';
import { createHoverProvider } from '../../src/hover/hoverDocumentProvider.js';
import { TranslationCoordinator } from '../../src/translation/translationCoordinator.js';
import { MemoryTranslationCache } from '../../src/cache/memoryTranslationCache.js';
import { readSettings, userSetting, type Settings } from '../../src/config/settingsService.js';
import { hoverText } from './renderer.js';
import { cancellationRegression } from './cancellation.js';
import { displayRegression, richLanguageSamples } from './display.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function run(): Promise<void> {
  await vscode.extensions.getExtension('local-hover-docs.hover-docs-translator')?.activate();
  const gate = new HoverDiscoveryCoordinator(); let captured: vscode.Hover[] = []; let calls = 0;
  const provider = vscode.languages.registerHoverProvider(['javascript', 'python'], {
    async provideHover(document, position) {
      calls++;
      if (gate.busy) return undefined;
      const result = await gate.collect(() => vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position), new AbortController().signal, 10000);
      if (result.kind !== 'collected') return undefined;
      captured = result.value;
      if (!captured.length) return undefined;
      await sleep(100);
      return new vscode.Hover('中文翻译：原型异步结果');
    },
  });
  try {
    for (const [file, line, col] of [['sample.js', 3, 1], ['sample.py', 6, 1], ['sample.js', 4, 7], ['sample.py', 7, 1]] as const) {
      const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, file);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      if (file.endsWith('.py')) {
        await vscode.extensions.getExtension('ms-python.python')?.activate();
        await vscode.extensions.getExtension('ms-python.vscode-pylance')?.activate();
      } else await vscode.extensions.getExtension('vscode.typescript-language-features')?.activate();
      let results: vscode.Hover[] = [];
      for (let attempt = 0; attempt < 30; attempt++) {
        calls = 0; captured = [];
        results = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, new vscode.Position(line, col));
        if (captured.some(h => h.contents.some(c => typeof c === 'string' ? /greeting|path|event/i.test(c) : 'value' in c && /greeting|path|event/i.test(c.value)))) break;
        await sleep(1000);
      }
      assert(captured.length > 0, `No source hover: ${file}:${line}`);
      assert(results.some(h => h.contents.some(c => typeof c === 'string' ? c.includes('中文翻译') : 'value' in c && c.value.includes('中文翻译'))), `No async translation: ${file}:${line}`);
      assert(calls <= 4, `Unbounded self callbacks: ${calls}`);
      console.log(`SPIKE PASS ${file}:${line} sourceHovers=${captured.length} providerCalls=${calls}`);
    }
  } finally { provider.dispose(); }
  const settings: Settings = { endpoint: 'https://example.com/v1/chat/completions', model: 'test', revision: 1, timeoutMs: 15000, concurrent: 2, queueSize: 8, perMinute: 20, enabled: true, paired: false, maxChars: 6000, discoveryTimeoutMs: 5000, cacheEntries: 500, cacheTtlMs: 86400000 };
  let cloudCalls = 0;
  const pool = new TranslationCoordinator(async segments => { cloudCalls++; await sleep(2000); return Object.fromEntries(segments.map(s => [s.id, '这是完整流程的中文译文。'])); }, new MemoryTranslationCache());
  const production = createHoverProvider({ discovery: new HoverDiscoveryCoordinator(), translations: pool, settings: () => settings, permitted: async () => true, onError: code => console.log('PROVIDER', code) });
  const registered = vscode.languages.registerHoverProvider(['javascript', 'python'], production);
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'sample.js'));
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(3, 1, 3, 1);
    await vscode.commands.executeCommand('editor.action.showHover');
    await sleep(350);
    const early = await hoverText();
    assert(early.includes('greeting'), `Early original missing: ${early}`);
    assert(!early.includes('完整流程'), 'Translation appeared before fake transport completed');
    await sleep(2200);
    const late = await hoverText();
    assert(late.includes('greeting') && late.includes('完整流程'), `Late combined hover missing: ${late}`);
    console.log('UI PASS English first; Chinese appended after delayed production provider');
    await vscode.commands.executeCommand('editor.action.hideHover');
    const results = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, new vscode.Position(3, 1));
    assert(results.some(h => h.contents.some(c => typeof c !== 'string' && 'value' in c && c.value.includes('完整流程'))));
    assert.equal(cloudCalls, 1, 'Repeat must use content cache');
    console.log('PIPELINE PASS AST + async translation + repeat cache');
    // Actual settings must ignore a workspace attempting to override a user's endpoint/model.
    const configuration = vscode.workspace.getConfiguration('hoverDocsTranslator');
    await configuration.update('apiBaseUrl', 'https://safe.example/v1', vscode.ConfigurationTarget.Global);
    await configuration.update('model', 'safe-model', vscode.ConfigurationTarget.Global);
    await assert.rejects(Promise.resolve(configuration.update('apiBaseUrl', 'https://evil.example/v1', vscode.ConfigurationTarget.Workspace)));
    assert.equal(userSetting('apiBaseUrl', ''), 'https://safe.example/v1');
    assert.equal(readSettings(1)?.endpoint, 'https://safe.example/v1/chat/completions');
    console.log('CONFIG PASS workspace cannot redirect user credentials');
  } finally { registered.dispose(); pool.reset(); }
  await cancellationRegression(settings);
  await displayRegression();
  await richLanguageSamples(settings);
}
