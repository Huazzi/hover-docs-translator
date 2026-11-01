import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { hoverSelectors, resolveHoverDocument } from '../../src/hover/hoverDocumentScope.js';
import { createHoverProvider } from '../../src/hover/hoverDocumentProvider.js';
import { ExperimentalHoverProvider, RECURSIVE_HOVER_COMMAND } from '../../src/hover/experimentalHoverProvider.js';
import { HoverDiscoveryCoordinator } from '../../src/hover/hoverDiscoveryCoordinator.js';
import { TranslationCoordinator } from '../../src/translation/translationCoordinator.js';
import { MemoryTranslationCache } from '../../src/cache/memoryTranslationCache.js';
import { TranslationError, type Segment, type Translations } from '../../src/translation/contracts.js';
import type { Settings } from '../../src/config/settingsService.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 100; i++) { if (check()) return; await sleep(30); }
  throw new Error(`Notebook timeout: ${label}`);
}
async function bounded<T>(promise: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(promise), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Notebook operation timed out')), 5000); })]); }
  finally { clearTimeout(timer); }
}
const text = (hover: vscode.Hover) => hover.contents.map(content => typeof content === 'string' ? content : content.value).join('\n');
const translate = (segments: Segment[]): Translations => Object.fromEntries(segments.map(segment => [segment.id, segment.text.split(/(⟦HDT_[^⟧]*⟧)/g).map(part => part.startsWith('⟦HDT_') ? part : part.trim() ? '笔记本中文译文。' : part).join('')]));
const position = new vscode.Position(4, 1);
const settings: Settings = { endpoint: 'https://example.com/chat/completions', model: 'test', revision: 1, timeoutMs: 10000, concurrent: 1, queueSize: 8, perMinute: 120, enabled: true, paired: true, maxChars: 6000, discoveryTimeoutMs: 5000, cacheEntries: 500, cacheTtlMs: 86400000 };
const fixture = () => vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'sample.ipynb');

async function close(notebook: vscode.NotebookDocument): Promise<void> {
  if (notebook.isClosed) return;
  if (notebook.isDirty) await notebook.save();
  await vscode.window.showNotebookDocument(notebook);
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}

export async function notebookRegression(proposed: boolean): Promise<void> {
  // Run before explicit extension activation or opening .py files: Python cell activation must suffice.
  const sourceUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, `.notebook-source-${proposed}.ipynb`);
  await vscode.workspace.fs.copy(fixture(), sourceUri, { overwrite: true });
  const notebook = await vscode.workspace.openNotebookDocument(sourceUri);
  await vscode.window.showNotebookDocument(notebook);
  await until(() => !!vscode.extensions.getExtension('local-hover-docs.hover-docs-translator')?.isActive, 'Python cell activation');
  const document = notebook.cellAt(0).document;
  assert.equal(document.uri.scheme, 'vscode-notebook-cell');
  assert.equal(resolveHoverDocument(document)?.notebook, notebook);
  for (const exclusive of [false, true]) assert(vscode.languages.match(hoverSelectors(exclusive), document) > 0);
  const markdown = notebook.cellAt(2).document;
  assert.equal(resolveHoverDocument(markdown), undefined);
  await vscode.languages.setTextDocumentLanguage(markdown, 'python');
  assert.equal(resolveHoverDocument(markdown), undefined, 'Markup cells are rejected even with Python language');
  await vscode.languages.setTextDocumentLanguage(markdown, 'markdown');
  const sibling = notebook.cellAt(1).document;
  for (const language of ['javascript', 'java', 'typescript']) {
    await vscode.languages.setTextDocumentLanguage(sibling, language);
    assert.equal(resolveHoverDocument(sibling), undefined);
    assert.equal(vscode.languages.match(hoverSelectors(), sibling), 0);
  }
  await vscode.languages.setTextDocumentLanguage(sibling, 'python');
  const untitled = await vscode.workspace.openNotebookDocument('jupyter-notebook', new vscode.NotebookData([new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'print(1)', 'python')]));
  assert.equal(resolveHoverDocument(untitled.cellAt(0).document), undefined);
  assert.equal(vscode.languages.match(hoverSelectors(), untitled.cellAt(0).document), 0);
  await vscode.window.showNotebookDocument(untitled);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  await vscode.window.showNotebookDocument(notebook);
  console.log('NOTEBOOK SCOPE PASS cell-only activation, local Python code cells, markup/JS/untitled exclusions');

  await vscode.extensions.getExtension('ms-python.python')?.activate();
  await vscode.extensions.getExtension('ms-python.vscode-pylance')?.activate();
  const command = proposed ? RECURSIVE_HOVER_COMMAND : 'vscode.executeHoverProvider';
  let native = '';
  for (let i = 0; i < 60; i++) {
    native = (await vscode.commands.executeCommand<vscode.Hover[]>(command, document.uri, position)).map(text).join('\n');
    if (native.includes('Returns a notebook greeting')) break;
    await sleep(500);
  }
  assert(native.includes('Returns a notebook greeting'), `No real Pylance Notebook docstring: ${native}`);
  const crossCell = (await vscode.commands.executeCommand<vscode.Hover[]>(command, notebook.cellAt(1).document.uri, new vscode.Position(0, 1))).map(text).join('\n');
  assert(crossCell.includes('Returns a notebook greeting'), 'Cross-cell Pylance documentation missing');
  let calls = 0;
  const pool = new TranslationCoordinator(async segments => { calls++; return translate(segments); }, new MemoryTranslationCache());
  let current = settings;
  const deps = { translations: pool, settings: () => current, permitted: async () => true, onError: (code: string) => assert.fail(code) };
  const denied = proposed
    ? new ExperimentalHoverProvider({ ...deps, permitted: async () => false, waitMs: () => 2000, sourceFailed: () => assert.fail('Denied source') })
    : createHoverProvider({ ...deps, permitted: async () => false, discovery: new HoverDiscoveryCoordinator() });
  const deniedToken = new vscode.CancellationTokenSource();
  try {
    const out = await denied.provideHover(document, position, deniedToken.token);
    if (proposed) assert(out && text(out).includes('Returns a notebook greeting'));
    else assert.equal(out, undefined);
    assert.equal(calls, 0, 'No Notebook cloud request without permission');
  } finally { deniedToken.dispose(); if (denied instanceof ExperimentalHoverProvider) denied.dispose(); }
  const failurePool = new TranslationCoordinator(async () => { throw new TranslationError('invalid_translation'); }, new MemoryTranslationCache());
  const failedDeps = { ...deps, translations: failurePool, onError: () => {} };
  const failed = proposed
    ? new ExperimentalHoverProvider({ ...failedDeps, waitMs: () => 2000, sourceFailed: () => assert.fail('Failure source') })
    : createHoverProvider({ ...failedDeps, discovery: new HoverDiscoveryCoordinator() });
  const failedRegistration = vscode.languages.registerHoverProvider(hoverSelectors(proposed), failed);
  try {
    const fallback = (await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position)).map(text).join('\n');
    assert(fallback.includes('Returns a notebook greeting'), 'Failed Notebook translation preserves original hover');
    assert(!fallback.includes('笔记本中文译文'));
  } finally { failedRegistration.dispose(); if (failed instanceof ExperimentalHoverProvider) failed.dispose(); failurePool.reset(); }
  const provider = proposed
    ? new ExperimentalHoverProvider({ ...deps, waitMs: () => 2000, sourceFailed: () => assert.fail('Notebook recursive source failed') })
    : createHoverProvider({ ...deps, discovery: new HoverDiscoveryCoordinator() });
  const registration = vscode.languages.registerHoverProvider(hoverSelectors(proposed), provider);
  try {
    const result = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position);
    const rendered = result.map(text).join('\n');
    assert(rendered.includes('笔记本中文译文'));
    assert(rendered.includes('notebook_greet'), 'Signature retained');
    assert(rendered.includes('Returns a notebook greeting'), 'Original retained in paired mode');
    if (proposed) assert.equal(result.length, 1);
    await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, position);
    assert.equal(calls, 1, 'Notebook repeat uses translation cache');
    current = { ...settings, paired: false };
    const chinese = (await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position)).map(text).join('\n');
    assert(chinese.includes('笔记本中文译文'));
    if (proposed) assert(!chinese.includes('Returns a notebook greeting'));
    assert.equal(calls, 1, 'Display switch reuses Notebook translation cache');
    console.log(`NOTEBOOK PYLANCE PASS proposed=${proposed}; same/cross-cell original, translation, signature, cache`);
  } finally { registration.dispose(); if (provider instanceof ExperimentalHoverProvider) provider.dispose(); pool.reset(); await close(notebook); await vscode.workspace.fs.delete(sourceUri); }
  await notebookLifecycle(proposed);
}

async function notebookLifecycle(proposed: boolean): Promise<void> {
  for (const phase of proposed ? ['queued', 'active', 'background'] : ['queued', 'active']) {
    for (const action of ['edit', 'remove', 'close']) {
      const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, `.notebook-${proposed}-${phase}-${action}.ipynb`);
      await vscode.workspace.fs.copy(fixture(), uri, { overwrite: true });
      const notebook = await vscode.workspace.openNotebookDocument(uri); await vscode.window.showNotebookDocument(notebook);
      const document = notebook.cellAt(0).document;
      let subscribed = false; let aborted = false; let calls = 0; let release!: (value: Translations) => void;
      const holder = new Promise<Translations>(resolve => { release = resolve; });
      const pool = new TranslationCoordinator(async (_segments, _config, signal) => {
        calls++;
        if (phase === 'queued' && calls === 1) return holder;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new TranslationError('cancelled')); }, { once: true }));
      }, new MemoryTranslationCache());
      const acquire = pool.acquire.bind(pool);
      pool.acquire = (...args) => { const result = acquire(...args); subscribed = true; return result; };
      const source = new vscode.Hover('Notebook cancellation fixture description.');
      const original = vscode.languages.registerHoverProvider(hoverSelectors(), { provideHover(doc) { return doc === document ? source : undefined; } });
      const deps = { translations: pool, settings: () => settings, permitted: async () => true, onError: (code: string) => assert.fail(code) };
      const provider = proposed
        ? new ExperimentalHoverProvider({ ...deps, waitMs: () => phase === 'background' ? 20 : 5000, sourceFailed: () => assert.fail('Notebook fixture source'), readSource: async () => [source] })
        : createHoverProvider({ ...deps, discovery: new HoverDiscoveryCoordinator() });
      const token = new vscode.CancellationTokenSource();
      let blocking: Promise<Translations> | undefined;
      try {
        if (phase === 'queued') blocking = acquire([{ id: 's0', text: 'occupy Notebook slot' }], settings, new AbortController().signal);
        const pending = Promise.resolve(provider.provideHover(document, position, token.token));
        await until(() => subscribed, 'translation subscribed');
        if (phase !== 'queued') await until(() => calls === 1, 'translation started');
        if (phase === 'background') { assert.equal(text((await bounded(pending))!), text(source)); token.cancel(); assert(!aborted); }
        // Another cell's text and output/metadata changes must not cancel this request.
        const unrelated = new vscode.WorkspaceEdit(); unrelated.insert(notebook.cellAt(1).document.uri, new vscode.Position(0, 0), '# unrelated\n');
        assert(await vscode.workspace.applyEdit(unrelated));
        const metadata = new vscode.WorkspaceEdit(); metadata.set(notebook.uri, [vscode.NotebookEdit.updateCellMetadata(1, { test: 'unrelated metadata' })]);
        assert(await vscode.workspace.applyEdit(metadata));
        await sleep(30); assert(!aborted);
        if (action === 'edit') {
          const edit = new vscode.WorkspaceEdit(); edit.insert(document.uri, new vscode.Position(0, 0), '# changed\n'); assert(await vscode.workspace.applyEdit(edit));
        } else if (action === 'remove') {
          const edit = new vscode.WorkspaceEdit(); edit.set(notebook.uri, [vscode.NotebookEdit.replaceCells(new vscode.NotebookRange(0, 1), [])]); assert(await vscode.workspace.applyEdit(edit));
        } else {
          await notebook.save(); await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
        if (phase === 'background') await until(() => aborted, 'background HTTP abort');
        else assert.equal(await bounded(pending), undefined);
        if (phase === 'queued') { release({ s0: '占位' }); await blocking; assert.equal(calls, 1, 'Removed queued subscriber never starts transport'); }
        else assert(aborted, 'Notebook invalidation aborts active transport');
        console.log(`NOTEBOOK CANCEL PASS proposed=${proposed} ${phase} ${action}`);
      } finally {
        release({ s0: '占位' }); original.dispose(); if (provider instanceof ExperimentalHoverProvider) provider.dispose(); pool.reset(); token.dispose();
        await close(notebook); await vscode.workspace.fs.delete(uri);
      }
    }
  }
}
