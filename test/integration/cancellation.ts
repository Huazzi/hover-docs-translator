import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { createHoverProvider } from '../../src/hover/hoverDocumentProvider.js';
import { HoverDiscoveryCoordinator } from '../../src/hover/hoverDiscoveryCoordinator.js';
import { TranslationCoordinator } from '../../src/translation/translationCoordinator.js';
import { MemoryTranslationCache } from '../../src/cache/memoryTranslationCache.js';
import { TranslationError, type Translations } from '../../src/translation/contracts.js';
import type { Settings } from '../../src/config/settingsService.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function within<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(promise), new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 3000); })]); }
  finally { clearTimeout(timer); }
}
export async function cancellationRegression(settings: Settings): Promise<void> {
  for (const action of ['change', 'close']) for (const mode of ['queued', 'active']) {
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, `.cancel-${action}-${mode}.js`);
    await vscode.workspace.fs.writeFile(uri, Buffer.from('const value = 1;\nvalue;\n'));
    const doc = await vscode.workspace.openTextDocument(uri); await vscode.window.showTextDocument(doc);
    const subscribed = deferred<void>(); const started = deferred<void>(); let calls = 0; let aborted = false;
    const holding = deferred<Translations>();
    const pool = new TranslationCoordinator(async (_segments, _config, signal) => {
      calls++;
      if (mode === 'queued' && calls === 1) return holding.promise;
      started.resolve();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new TranslationError('cancelled')); }, { once: true }));
    }, new MemoryTranslationCache());
    const config = { ...settings, concurrent: 1 };
    const acquire = pool.acquire.bind(pool);
    pool.acquire = (...args) => { const promise = acquire(...args); subscribed.resolve(); return promise; };
    const source = vscode.languages.registerHoverProvider('javascript', { provideHover(document) { if (document === doc) return new vscode.Hover('Cancellation fixture description.'); return undefined; } });
    const token = new vscode.CancellationTokenSource(); // Never cancelled by the test: document events must do the work.
    try {
      const holder = mode === 'queued' ? acquire([{ id: 's0', text: 'occupy slot' }], config, new AbortController().signal) : undefined;
      const provider = createHoverProvider({ discovery: new HoverDiscoveryCoordinator(), translations: pool, settings: () => config, permitted: async () => true, onError: () => {} });
      const hover = provider.provideHover(doc, new vscode.Position(1, 1), token.token);
      await within(subscribed.promise, 'consumer subscribed');
      if (mode === 'active') await within(started.promise, 'HTTP started');
      if (action === 'change') {
        const edit = new vscode.WorkspaceEdit(); edit.insert(uri, new vscode.Position(0, 0), '// changed\n');
        assert(await vscode.workspace.applyEdit(edit));
      } else await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      assert.equal(await within(Promise.resolve(hover), `${action} ${mode} consumer cancelled`), undefined);
      if (mode === 'queued') { holding.resolve({ s0: '占位' }); await holder; assert.equal(calls, 1, 'Stale queued document must never start HTTP'); }
      else assert(aborted, 'In-flight HTTP must be aborted when its document is invalidated');
      console.log(`CANCEL PASS document ${action} during ${mode} translation`);
    } finally {
      source.dispose(); pool.reset(); token.dispose();
      if (!doc.isClosed) { if (doc.isDirty) await doc.save(); await vscode.commands.executeCommand('workbench.action.closeActiveEditor'); }
      await vscode.workspace.fs.delete(uri);
    }
  }
}
