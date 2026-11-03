import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { ExperimentalHoverProvider, RECURSIVE_HOVER_COMMAND } from '../../src/hover/experimentalHoverProvider.js';
import { TranslationCoordinator } from '../../src/translation/translationCoordinator.js';
import { MemoryTranslationCache } from '../../src/cache/memoryTranslationCache.js';
import { TranslationError, type Segment } from '../../src/translation/contracts.js';
import type { Settings } from '../../src/config/settingsService.js';
import { prepareTakeover } from '../../src/content/takeoverHoverContent.js';
import { hoverText, captureVisibleHover } from './renderer.js';
import { notebookRegression } from './notebook.js';
import { hoverSelectors } from '../../src/hover/hoverDocumentScope.js';
import { languageRegression } from './languages.js';
import { experienceRegression } from './experience.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => boolean, label: string) { for (let i = 0; i < 100; i++) { if (test()) return; await sleep(20); } throw new Error(label); }
const text = (hover: vscode.Hover | undefined | null) => hover?.contents.map(c => typeof c === 'string' ? c : c.value).join('\n') || '';
const settings: Settings = { endpoint: 'https://example.com/chat/completions', model: 'test', revision: 1, timeoutMs: 1000, concurrent: 2, queueSize: 2, perMinute: 120, enabled: true, paired: true, maxChars: 6000, discoveryTimeoutMs: 1000, cacheEntries: 500, cacheTtlMs: 86400000 };
const translate = (segments: Segment[]) => Object.fromEntries(segments.map(s => [s.id, s.text.split(/(⟦HDT_[^⟧]*⟧)/g).map(part => part.startsWith('⟦HDT_') ? part : part.trim() ? '中文译文。' : part).join('')]));
const position = new vscode.Position(3, 1);
const source = new vscode.Hover([new vscode.MarkdownString('```js\nfunction greet(name: string): string\n```'), new vscode.MarkdownString('Returns a greeting for the supplied user.')]);

export async function registrationSmoke(proposed: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration('hoverDocsTranslator');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'sample.js'));
  await vscode.window.showTextDocument(document);
  await vscode.extensions.getExtension('vscode.typescript-language-features')?.activate();
  const extra = vscode.languages.registerHoverProvider('javascript', { provideHover() { return new vscode.Hover('Ordinary provider sentinel.'); } });
  try {
    await config.update('hoverMode', 'experimentalTakeover', vscode.ConfigurationTarget.Global);
    let results: vscode.Hover[] = [];
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      results = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position);
      if (results.map(text).join('').includes('greeting') && (proposed ? results.length === 1 : results.length >= 2)) break;
    }
    assert(results.map(text).join('').includes('Ordinary provider sentinel.'));
    assert(proposed ? results.length === 1 : results.length >= 2, `mode gate ${proposed}: ${results.length}`);
    await config.update('hoverMode', 'stable', vscode.ConfigurationTarget.Global); await sleep(100);
    results = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position);
    assert(results.length >= 2, 'Switching back must restore ordinary providers');
    console.log(`REGISTRATION PASS proposal=${proposed}; safe original without credentials; return to stable`);
  } finally { extra.dispose(); await config.update('hoverMode', 'stable', vscode.ConfigurationTarget.Global); }
}

async function lifecycle(document: vscode.TextDocument): Promise<void> {
  const token = new vscode.CancellationTokenSource(); let calls = 0;
  const pool = new TranslationCoordinator(async segments => { calls++; return translate(segments); }, new MemoryTranslationCache());
  const make = (overrides: Partial<ConstructorParameters<typeof ExperimentalHoverProvider>[0]> = {}) => new ExperimentalHoverProvider({ translations: pool, settings: () => settings, permitted: async () => true, onError() {}, waitMs: () => 100, sourceFailed: () => assert.fail('source failure'), readSource: async () => [source], ...overrides });
  try {
    for (const override of [{ settings: () => undefined }, { settings: () => ({ ...settings, enabled: false }) }, { permitted: async () => false }, { readSource: async () => [new vscode.Hover('这是中文。')] }]) {
      const provider = make(override); const out = await provider.provideHover(document, position, token.token);
      assert(out && (text(out).includes('greeting') || text(out).includes('这是中文'))); provider.dispose();
    }
    assert.equal(calls, 0, 'No cloud when disabled, unconfigured, denied, or no prose');
    for (const code of ['http_401', 'http_429', 'timeout', 'invalid_translation', 'queue_full']) {
      const broken = new TranslationCoordinator(async () => { throw new TranslationError(code); }, new MemoryTranslationCache());
      const provider = make({ translations: broken });
      assert.equal(text(await provider.provideHover(document, position, token.token)), text(source)); provider.dispose(); broken.reset();
    }
    const command = new vscode.MarkdownString('Read [run](command:test).'); command.isTrusted = true;
    const relative = new vscode.MarkdownString('Read [relative](./a.md).'); relative.baseUri = vscode.Uri.file('D:/example/');
    const legacy = { language: 'python', value: 'def greet(name):' };
    const mixed = [command, relative, legacy, ...source.contents];
    const prepared = prepareTakeover(mixed, 6000)!;
    const output = prepared.render(translate(prepared.segments), true);
    assert.equal(output[0], command); assert.equal(output[1], relative); assert.equal(output[2], legacy);
    const generated = output.at(-1) as vscode.MarkdownString;
    assert.equal(generated.isTrusted, false); assert.equal(generated.supportHtml, false);

    // A timeout returns originals, detaches only hover cancellation, and warms shared cache.
    let release!: () => void; let transportSignal!: AbortSignal;
    const slow = new TranslationCoordinator(async (segments, _config, signal) => { calls++; transportSignal = signal; await new Promise<void>(resolve => { release = resolve; }); return translate(segments); }, new MemoryTranslationCache());
    const provider = make({ translations: slow, waitMs: () => 30 });
    const first = await provider.provideHover(document, position, token.token);
    assert.equal(text(first), text(source)); token.cancel(); assert(!transportSignal.aborted);
    const token2 = new vscode.CancellationTokenSource();
    const second = await provider.provideHover(document, position, token2.token); assert.equal(text(second), text(source)); assert.equal(calls, 1);
    release(); await sleep(30);
    assert(text(await provider.provideHover(document, position, token2.token)).includes('中文译文')); assert.equal(calls, 1);
    provider.dispose(); slow.reset(); token2.dispose();

    // Cancelling before early return still cancels the final subscriber immediately.
    let started = false; let cancelled = false;
    const cancellable = new TranslationCoordinator(async (_segments, _cfg, signal) => {
      started = true;
      return new Promise((_, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new TranslationError('cancelled')); }, { once: true }));
    }, new MemoryTranslationCache());
    const cancelProvider = make({ translations: cancellable, waitMs: () => 1000 });
    const cancelToken = new vscode.CancellationTokenSource();
    const pending = cancelProvider.provideHover(document, position, cancelToken.token);
    await until(() => started, 'translation started'); cancelToken.cancel();
    assert.equal(await pending, undefined); assert(cancelled);
    cancelProvider.dispose(); cancellable.reset(); cancelToken.dispose();

    // A retained background task is still owned: invalidation cancels it, no late cache entry.
    for (const action of ['invalidate', 'dispose', 'edit', 'close'] as const) {
      const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, `.takeover-${action}.js`);
      await vscode.workspace.fs.writeFile(uri, Buffer.from('const item = 1;\nitem;\n'));
      const doc = await vscode.workspace.openTextDocument(uri); await vscode.window.showTextDocument(doc);
      let aborted = false;
      const hanging = new TranslationCoordinator(async (_segments, _cfg, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new TranslationError('cancelled')); }, { once: true })), new MemoryTranslationCache());
      const owned = make({ translations: hanging, waitMs: () => 20 }); const t = new vscode.CancellationTokenSource();
      assert(await owned.provideHover(doc, new vscode.Position(1, 1), t.token));
      if (action === 'invalidate') owned.cancelPending();
      else if (action === 'dispose') owned.dispose();
      else if (action === 'edit') { const edit = new vscode.WorkspaceEdit(); edit.insert(uri, new vscode.Position(0, 0), '// edit\n'); await vscode.workspace.applyEdit(edit); }
      else await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await until(() => aborted, `background ${action} must cancel`);
      owned.dispose(); hanging.reset(); t.dispose();
      if (!doc.isClosed) { if (doc.isDirty) await doc.save(); await vscode.commands.executeCommand('workbench.action.closeActiveEditor'); }
      await vscode.workspace.fs.delete(uri);
    }
    let failed = 0;
    const badSource = make({ readSource: async () => { throw new Error('unsupported'); }, sourceFailed: () => { failed++; } });
    const fresh = new vscode.CancellationTokenSource();
    assert.equal(await badSource.provideHover(document, position, fresh.token), undefined); assert.equal(failed, 1); badSource.dispose(); fresh.dispose();
    const sourceToken = new vscode.CancellationTokenSource();
    const empty = make({ readSource: async () => [], sourceFailed: () => assert.fail('empty is not broken') });
    assert.equal(await empty.provideHover(document, position, sourceToken.token), undefined); empty.dispose();
    const stuck = make({ settings: () => ({ ...settings, discoveryTimeoutMs: 10 }), readSource: () => new Promise(() => {}), sourceFailed: () => { failed++; } });
    assert.equal(await stuck.provideHover(document, position, sourceToken.token), undefined); assert.equal(failed, 2); stuck.dispose(); sourceToken.dispose();
    console.log('TAKEOVER LIFECYCLE PASS original fallback, safe metadata, deadline cache, retained-task cancellation and source failure');
  } finally { token.dispose(); pool.reset(); }
}

export async function run(): Promise<void> {
  await notebookRegression(true);
  await languageRegression(true);
  await vscode.extensions.getExtension('local-hover-docs.hover-docs-translator')?.activate();
  await registrationSmoke(true);
  await experienceRegression(true);
  const documents: vscode.TextDocument[] = [];
  for (const [file, line] of [['sample.js', 3], ['sample.py', 6]] as const) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, file));
    documents.push(document); await vscode.window.showTextDocument(document);
    if (file.endsWith('.py')) { await vscode.extensions.getExtension('ms-python.python')?.activate(); await vscode.extensions.getExtension('ms-python.vscode-pylance')?.activate(); }
    let native = '';
    for (let i = 0; i < 30; i++) { native = (await vscode.commands.executeCommand<vscode.Hover[]>(RECURSIVE_HOVER_COMMAND, document.uri, new vscode.Position(line, 1))).map(text).join('\n'); if (native.includes('greeting')) break; await sleep(500); }
    assert(native.includes('greeting'), file);
  }
  let current = settings; let calls = 0;
  const pool = new TranslationCoordinator(async segments => { calls++; await sleep(40); return translate(segments); }, new MemoryTranslationCache());
  const provider = new ExperimentalHoverProvider({ translations: pool, settings: () => current, permitted: async () => true, onError: code => assert.fail(code), waitMs: () => 1000, sourceFailed: () => assert.fail('recursive source') });
  const registration = vscode.languages.registerHoverProvider(hoverSelectors(true), provider);
  try {
    const results = await Promise.all(documents.map((doc, index) => vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, new vscode.Position(index ? 6 : 3, 1))));
    results.forEach((hovers, index) => {
      assert.equal(hovers.length, 1); const value = text(hovers[0]); assert(value.includes('greet')); assert(value.includes('中文译文'));
      assert.equal(value.split('Returns a greeting for the supplied user.').length - 1, 1);
      assert(value.indexOf('Returns a greeting') < value.indexOf('中文译文')); console.log(`TAKEOVER SOURCE PASS ${documents[index].languageId}`);
    });
    for (const [index, document] of documents.entries()) {
      const p = new vscode.Position(index ? 6 : 3, 1);
      const definitions = await vscode.commands.executeCommand<unknown[]>('vscode.executeDefinitionProvider', document.uri, p); assert(definitions.length);
      const editor = await vscode.window.showTextDocument(document); editor.selection = new vscode.Selection(p, p);
      await vscode.commands.executeCommand('editor.action.hideHover'); await vscode.commands.executeCommand('editor.action.showHover');
      let visible = ''; for (let i = 0; i < 40; i++) { visible = await hoverText(); if (visible.includes('中文译文')) break; await sleep(100); }
      assert.equal(visible.split('Returns a greeting for the supplied user.').length - 1, 1); assert(visible.includes('中文译文'));
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, '..', '..', '.vscode-test', `takeover-${document.languageId}.png`), await captureVisibleHover());
      await vscode.commands.executeCommand('editor.action.hideHover');
    }
    const previousCalls = calls; current = { ...settings, paired: false };
    const chinese = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', documents[0].uri, position);
    assert(text(chinese[0]).includes('中文译文')); assert(!text(chinese[0]).includes('Returns a greeting')); assert.equal(calls, previousCalls);
    console.log('TAKEOVER UI PASS native bilingual once, signature and definition retained, Chinese-only cache reuse');
  } finally { registration.dispose(); provider.dispose(); pool.reset(); }
  // Keep the JS model open during lifecycle tests while temporary documents are closed.
  await vscode.window.showTextDocument(documents[0], { preview: false });
  await lifecycle(documents[0]);
}
