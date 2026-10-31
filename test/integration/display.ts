import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { createHoverProvider } from '../../src/hover/hoverDocumentProvider.js';
import { HoverDiscoveryCoordinator } from '../../src/hover/hoverDiscoveryCoordinator.js';
import { TranslationCoordinator } from '../../src/translation/translationCoordinator.js';
import { MemoryTranslationCache } from '../../src/cache/memoryTranslationCache.js';
import { applyConfigurationChange } from '../../src/config/settingsChange.js';
import { readSettings, type Settings } from '../../src/config/settingsService.js';
import { hoverPresentation, captureVisibleHover } from './renderer.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => boolean, label: string) { for (let i = 0; i < 100; i++) { if (test()) return; await sleep(50); } throw new Error(`Timeout: ${label}`); }
const text = (hover: vscode.Hover | undefined | null) => hover?.contents.map(c => typeof c === 'string' ? c : 'value' in c ? c.value : '').join('\n') || '';
const richSource = '# Description\n\nRead **carefully** and use `value`.\n\n## Parameters\n\n- `value`: The input value.\n\n## Returns\n\n| Name | Meaning |\n| --- | --- |\n| result | Parsed value |\n\n```js\nparse(value)\n```';

export async function displayRegression(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('hoverDocsTranslator');
  await configuration.update('displayMode', 'translationOnly', vscode.ConfigurationTarget.Global);
  let current = readSettings(10)!; assert(current);
  let calls = 0; let release!: () => void; let activeSignal: AbortSignal | undefined; let resets = 0;
  const pool = new TranslationCoordinator(async (segments, _config, signal) => {
    calls++; activeSignal = signal;
    await new Promise<void>(resolve => { release = resolve; });
    return Object.fromEntries(segments.map(s => [s.id, '中文 ' + s.text]));
  }, new MemoryTranslationCache());
  function refresh() { resets++; current = readSettings(current.revision + 1)!; pool.reset(); }
  const listener = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('hoverDocsTranslator')) applyConfigurationChange(current, () => readSettings(current.revision), next => { current = next; }, refresh);
  });
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'sample.js'));
  const position = new vscode.Position(3, 1); const token = new vscode.CancellationTokenSource();
  const source = vscode.languages.registerHoverProvider('javascript', { provideHover(document) {
    return document === doc ? new vscode.Hover([new vscode.MarkdownString('```typescript\nfunction independent(value: string): string\n```'), new vscode.MarkdownString(richSource)]) : undefined;
  } });
  const discovery = new HoverDiscoveryCoordinator();
  const provider = createHoverProvider({ discovery, translations: pool, settings: () => current, permitted: async () => true, onError: () => {} });
  let registration: vscode.Disposable | undefined;
  try {
    const pending = Promise.resolve(provider.provideHover(doc, position, token.token));
    await until(() => calls === 1, 'active translation');
    const old = current;
    await configuration.update('displayMode', 'paired', vscode.ConfigurationTarget.Global);
    await until(() => current.paired, 'display event');
    assert.equal(resets, 0); assert.equal(current.revision, old.revision); assert.equal(old.paired, false); assert(!activeSignal!.aborted);
    release(); const oldResult = text(await pending);
    assert(oldResult.includes('**中文说明**')); assert(!oldResult.includes('**原文：**'));
    assert(!oldResult.includes('function independent'));
    const next = text(await provider.provideHover(doc, position, token.token));
    assert(next.includes('**原文：**')); assert(next.includes('原文表格')); assert.equal(calls, 1);
    console.log('DISPLAY PASS real config event; active snapshot survives; next paired Hover reuses cache');

    registration = vscode.languages.registerHoverProvider('javascript', provider);
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(position, position);
    const themeConfig = vscode.workspace.getConfiguration('workbench');
    const originalTheme = themeConfig.get<string>('colorTheme');
    try {
      for (const theme of ['Default Light Modern', 'Default Dark Modern', 'Default High Contrast']) {
        await themeConfig.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
        await sleep(300);
        await vscode.commands.executeCommand('editor.action.hideHover');
        await vscode.commands.executeCommand('editor.action.showHover');
        let details = await hoverPresentation();
        for (let i = 0; i < 40 && (!details.width || !details.text.includes('原文表格')); i++) { await sleep(100); details = await hoverPresentation(); }
        assert(details.text.includes('中文说明') && details.text.includes('原文表格'));
        assert(details.headings.some(h => h.tag === 'H4' && h.text.includes('中文')));
        assert(details.tables >= 3); assert(details.quotes >= 1);
        assert(details.width > 0); assert(!details.dangerousLinks);
        const screenshot = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, '..', '..', '.vscode-test', `display-${theme.replaceAll(' ', '-')}.png`);
        await vscode.workspace.fs.writeFile(screenshot, await captureVisibleHover());
        console.log(`DISPLAY UI PASS ${theme} width=${details.width} tables=${details.tables} quotes=${details.quotes}`);
      }
    } finally { await themeConfig.update('colorTheme', originalTheme, vscode.ConfigurationTarget.Global); await vscode.commands.executeCommand('editor.action.hideHover'); }
    registration.dispose(); registration = undefined;

    // A real service edit still invalidates a pending provider and its transport.
    pool.reset();
    const stale = Promise.resolve(provider.provideHover(doc, position, token.token));
    await until(() => calls === 2, 'second active translation');
    await configuration.update('model', 'changed-model', vscode.ConfigurationTarget.Global);
    await until(() => resets === 1, 'service invalidation');
    assert(activeSignal!.aborted); release(); assert.equal(await stale, undefined);
    console.log('DISPLAY PASS service edit still cancels stale Hover');
  } finally { registration?.dispose(); listener.dispose(); source.dispose(); discovery.dispose(); pool.reset(); token.dispose(); }
}

export async function richLanguageSamples(settings: Settings): Promise<void> {
  const pool = new TranslationCoordinator(async segments => Object.fromEntries(segments.map(s => [s.id, '中文 ' + s.text])), new MemoryTranslationCache());
  const discovery = new HoverDiscoveryCoordinator();
  const provider = createHoverProvider({ discovery, translations: pool, settings: () => ({ ...settings, paired: true }), permitted: async () => true, onError: code => assert.fail(code) });
  const token = new vscode.CancellationTokenSource();
  try {
    for (const filename of ['presentation.py', 'presentation.js']) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, filename));
      await vscode.window.showTextDocument(doc);
      const line = doc.lineCount - 2;
      let result = '';
      for (let i = 0; i < 30; i++) { result = text(await provider.provideHover(doc, new vscode.Position(line, 2), token.token)); if (result.includes('中文说明')) break; await sleep(300); }
      assert(result.includes('中文说明') && result.includes('**原文：**'), filename);
      assert(result.includes('ValueError') || result.includes('TypeError'), `exception lost: ${filename}`);
      assert(result.includes('value'), `parameter lost: ${filename}`);
      console.log(`DISPLAY SOURCE PASS real ${filename} parameter/return/exception docs`);
    }
  } finally { token.dispose(); pool.reset(); discovery.dispose(); }
}
