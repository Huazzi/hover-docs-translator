import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { hoverSelectors, resolveHoverDocument } from '../../src/hover/hoverDocumentScope.js';
import { createHoverProvider } from '../../src/hover/hoverDocumentProvider.js';
import { ExperimentalHoverProvider, RECURSIVE_HOVER_COMMAND } from '../../src/hover/experimentalHoverProvider.js';
import { HoverDiscoveryCoordinator } from '../../src/hover/hoverDiscoveryCoordinator.js';
import { TranslationCoordinator } from '../../src/translation/translationCoordinator.js';
import { MemoryTranslationCache } from '../../src/cache/memoryTranslationCache.js';
import { TranslationError, type Segment } from '../../src/translation/contracts.js';
import type { Settings } from '../../src/config/settingsService.js';
import { hoverText, captureVisibleHover } from './renderer.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const text = (hovers: vscode.Hover[]) => hovers.flatMap(hover => hover.contents.map(content => typeof content === 'string' ? content : content.value)).join('\n');
const translate = (segments: Segment[]) => Object.fromEntries(segments.map(segment => [segment.id, segment.text.split(/(⟦HDT_[^⟧]*⟧)/g).map(part => part.startsWith('⟦HDT_') ? part : part.trim() ? '新语言中文译文。' : part).join('')]));
const settings: Settings = { endpoint: 'https://example.com/chat/completions', model: 'test', revision: 1, timeoutMs: 10000, concurrent: 2, queueSize: 8, perMinute: 120, enabled: true, paired: true, maxChars: 6000, discoveryTimeoutMs: 10000, cacheEntries: 500, cacheTtlMs: 86400000 };

export async function languageRegression(proposed: boolean): Promise<void> {
  for (const sample of [
    { file: 'sample.ts', language: 'typescript', extension: 'vscode.typescript-language-features', symbol: 'identityValue', call: 'identityValue<string>("reader");', prose: 'Returns the supplied value', parameter: 'value' },
    { file: 'Sample.java', language: 'java', extension: 'redhat.java', symbol: 'echoReader', call: 'echoReader("reader");', prose: 'Returns the supplied Java text', parameter: 'value' },
  ]) {
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, sample.file);
    const document = await vscode.workspace.openTextDocument(uri); await vscode.window.showTextDocument(document);
    assert.equal(document.languageId, sample.language); assert(resolveHoverDocument(document));
    assert(vscode.languages.match(hoverSelectors(proposed), document) > 0);
    const extension = vscode.extensions.getExtension(sample.extension); assert(extension, `Required language service missing: ${sample.extension}`); await extension.activate();
    const offset = document.getText().lastIndexOf(sample.call); assert(offset >= 0);
    const position = document.positionAt(offset + 1);
    const command = proposed ? RECURSIVE_HOVER_COMMAND : 'vscode.executeHoverProvider';
    let originals: vscode.Hover[] = [];
    for (let attempt = 0; attempt < 120; attempt++) {
      originals = await vscode.commands.executeCommand<vscode.Hover[]>(command, uri, position);
      if (text(originals).includes(sample.prose)) break;
      await sleep(500);
    }
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, '..', '..', '.vscode-test', `language-${sample.language}-${proposed}.json`), Buffer.from(JSON.stringify(originals.map(hover => ({ contents: hover.contents.map(content => typeof content === 'string' ? content : 'language' in content ? content : { value: content.value, isTrusted: content.isTrusted, supportHtml: content.supportHtml }), range: hover.range })), null, 2)));
    assert(text(originals).includes(sample.prose), `No ${sample.language} source docs; inspect .vscode-test/language-${sample.language}-${proposed}.json and isolated extension logs: ${text(originals)}`);
    const signature = text(originals).match(/```(?:java|typescript)\n([\s\S]*?)```/)?.[1].trim();
    assert(signature && signature.includes(sample.symbol), `${sample.language} fenced signature missing: ${text(originals)}`);

    let current = settings; let permitted = true; let fail = false; let calls = 0; let captured: Segment[] = [];
    const errors: string[] = [];
    const pool = new TranslationCoordinator(async segments => { calls++; captured = segments; if (fail) throw new TranslationError('invalid_translation'); return translate(segments); }, new MemoryTranslationCache());
    const deps = { translations: pool, settings: () => current, permitted: async () => permitted, onError: (code: string) => errors.push(code) };
    const provider = proposed
      ? new ExperimentalHoverProvider({ ...deps, waitMs: () => 3000, sourceFailed: () => assert.fail(`${sample.language} recursive source failed`) })
      : createHoverProvider({ ...deps, discovery: new HoverDiscoveryCoordinator() });
    const registration = vscode.languages.registerHoverProvider(hoverSelectors(proposed), provider);
    try {
      const translated = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position);
      const rendered = text(translated);
      assert(rendered.includes('新语言中文译文'), `${sample.language} translation missing: ${rendered}`);
      assert(rendered.includes(signature)); assert(rendered.includes(sample.parameter));
      assert(!captured.some(segment => segment.text.includes(sample.call) || segment.text.includes(signature)), 'Signature/example code must stay local');
      assert.equal(calls, 1); assert.equal(errors.length, 0);
      const editor = await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand('editor.action.hideHover');
      editor.selection = new vscode.Selection(position, position);
      await sleep(100);
      await vscode.commands.executeCommand('editor.action.showHover', { focus: 'noAutoFocus' });
      let visible = '';
      for (let i = 0; i < 40; i++) { visible = await hoverText(); if (visible.includes('新语言中文译文')) break; await sleep(100); }
      assert(visible.includes('新语言中文译文'), sample.language + ' visible translation missing: ' + visible);
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, '..', '..', '.vscode-test', 'language-ui-' + sample.language + '-' + proposed + '.png'), await captureVisibleHover());
      await vscode.commands.executeCommand('editor.action.hideHover');
      if (proposed) { assert.equal(translated.length, 1); assert(rendered.includes(sample.prose)); }
      current = { ...settings, paired: false };
      const chinese = text(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position));
      assert(chinese.includes('新语言中文译文')); if (proposed) assert(!chinese.includes(sample.prose));
      assert.equal(calls, 1, 'Display changes reuse cached translations');
      permitted = false;
      const denied = text(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position));
      assert(denied.includes(sample.prose)); assert(!denied.includes('新语言中文译文')); assert.equal(calls, 1);
      permitted = true; fail = true; pool.reset();
      const fallback = text(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position));
      assert(fallback.includes(sample.prose)); assert(!fallback.includes('新语言中文译文')); assert(errors.includes('invalid_translation'));
      if (sample.language === 'java') {
        // Red Hat emits @throws navigation as a trusted command link. Takeover must
        // preserve that source fragment; stable append may translate its sanitized prose.
        fail = false; pool.reset(); const previousCalls = calls;
        assert(pool.snapshot(settings).cooldownRemainingMs > 0, 'Clearing cache must retain failure cooldown');
        await sleep(pool.snapshot(settings).cooldownRemainingMs + 20);
        const richPosition = document.positionAt(document.getText().lastIndexOf('greetReader("reader");') + 1);
        const rich = text(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, richPosition));
        assert(rich.includes('Returns a Java greeting')); assert(rich.includes('command:java.open.file'));
        if (proposed) assert.equal(calls, previousCalls, 'Unsafe Java fragment stays original without a cloud request');
        else { assert(rich.includes('新语言中文译文')); assert.equal(calls, previousCalls + 1); }
        console.log(`JAVA MARKUP PASS proposed=${proposed}: linked exception source preserved`);
      }
      console.log(`LANGUAGE PASS ${sample.language} proposed=${proposed}: real docs/signature, translation, cache/display, denied/error original fallback`);
    } finally { registration.dispose(); if (provider instanceof ExperimentalHoverProvider) provider.dispose(); pool.reset(); }
  }
  const scopeDocument = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'sample.ts'));
  for (const language of ['typescriptreact', 'javascriptreact']) {
    const document = await vscode.languages.setTextDocumentLanguage(scopeDocument, language);
    assert.equal(resolveHoverDocument(document), undefined); assert.equal(vscode.languages.match(hoverSelectors(), document), 0);
  }
  await vscode.languages.setTextDocumentLanguage(scopeDocument, 'typescript');
  const notebook = await vscode.workspace.openNotebookDocument('jupyter-notebook', new vscode.NotebookData([new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'class Example {}', 'java')]));
  assert.equal(resolveHoverDocument(notebook.cellAt(0).document), undefined);
  assert.equal(vscode.languages.match(hoverSelectors(), notebook.cellAt(0).document), 0);
  console.log('LANGUAGE SCOPE PASS TSX/JSX and Java Notebook excluded');
}
