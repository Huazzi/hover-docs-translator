// Throwaway feasibility experiment. Fixed local translations, no API keys/network model.
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const out = process.env.HDT_TAKEOVER_OUTPUT || path.resolve(__dirname, '../../../.vscode-test/takeover');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pairs = [
  ['Return a greeting for the supplied name.', '为指定的姓名生成问候语。'],
  ['The original name is preserved.', '保留姓名的原始内容。'],
];
const flatten = hovers => (hovers || []).flatMap(h => h.contents).map(c => typeof c === 'string' ? c : c.value || '').join('\n\n');
const count = (text, value) => text.split(value).length - 1;
async function cdp(method, params) {
  const targets = await (await fetch('http://127.0.0.1:9419/json/list')).json();
  const target = targets.find(t => t.type === 'page' && /workbench/.test(t.url));
  assert(target?.webSocketDebuggerUrl, 'isolated renderer must exist');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id !== 1) return; clearTimeout(timer); ws.close(); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); };
    ws.onerror = () => { clearTimeout(timer); ws.close(); reject(new Error('CDP failure')); };
  });
}
async function dom() {
  const r = await cdp('Runtime.evaluate', { expression: `(() => { const e = [...document.querySelectorAll('.monaco-hover')].find(e => e.getBoundingClientRect().width > 0); if (!e) return {text:''}; const r=e.getBoundingClientRect();return {text:e.textContent,clip:{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}}; })()`, returnByValue: true });
  return r.result.value;
}
async function capture(name) { const d = await dom(); const png = await cdp('Page.captureScreenshot', { format: 'png', clip: d.clip }); await fs.writeFile(path.join(out, name + '.png'), Buffer.from(png.data, 'base64')); return d.text; }
async function recursive(doc, pos) {
  // Experimental wrapper handles public Position and Hover conversion; still unstable.
  return vscode.commands.executeCommand('vscode.experimental.executeHoverProvider_recursive', doc.uri, pos);
}
async function normal(doc, pos) { return vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, pos); }
function sourceResult(source) { return new vscode.Hover(source.flatMap(h => h.contents).map(c => new vscode.MarkdownString(typeof c === 'string' ? c : c.value || ''))); }
exports.run = async (extensionMode = 'test-host') => {
  const results = { vscode: vscode.version, extensionMode, runId: process.env.HDT_TAKEOVER_RUN_ID || null, extensions: {}, cases: [] };
  for (const id of ['ms-python.python', 'ms-python.vscode-pylance', 'vscode.typescript-language-features']) {
    const ext = vscode.extensions.getExtension(id); assert(ext, `missing ${id}`); await ext.activate(); results.extensions[id] = ext.packageJSON.version;
  }
  assert(!vscode.extensions.getExtension('local-hover-docs.hover-docs-translator'), 'production extension must not be loaded');
  const docs = [];
  for (const [file, callLine, externalLine, externalColumn] of [['sample.js', 8, 9, 6], ['sample.py', 9, 10, 1]]) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(__dirname, file)));
    await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(callLine, 2);
    let source;
    for (let i = 0; i < 60; i++) { source = await normal(doc, pos); if (flatten(source).includes(pairs[0][0])) break; await sleep(500); }
    assert(flatten(source).includes(pairs[0][0]), `baseline documentation ${file}`);
    const raw = await vscode.commands.executeCommand('_executeHoverProvider_recursive', doc.uri, { lineNumber: pos.line + 1, column: pos.character + 1 });
    assert.equal(flatten(await recursive(doc, pos)), flatten(raw));
    const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', doc.uri, pos);
    assert(definitions.length > 0);
    const signature = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', doc.uri, new vscode.Position(pos.line, 6));
    const signatureCount = signature?.signatures.length || 0;
    docs.push({ doc, pos, file, external: new vscode.Position(externalLine, externalColumn), definitions: definitions.length, signatureCount });
    results.cases.push({ case: 'baseline', file, sourceCount: source.length, definitions: definitions.length, signatureCount });
  }
  let calls = 0, behavior = 'paired', delay = 0;
  const selectors = ['python', 'javascript'].map(language => ({ language, scheme: 'file', exclusive: true }));
  const exclusive = vscode.languages.registerHoverProvider(selectors, {
    async provideHover(doc, pos, token) {
      calls++;
      if (behavior === 'empty') return undefined;
      const source = await recursive(doc, pos);
      if (token.isCancellationRequested) return undefined;
      try {
        if (delay) await sleep(delay);
        if (token.isCancellationRequested) return undefined;
        if (behavior === 'failure') throw new Error('simulated model failure');
        const contents = source.flatMap(h => h.contents).map(c => {
          let value = typeof c === 'string' ? c : c.value || '';
          for (const [en, zh] of pairs) value = value.replace(en, behavior === 'chinese' ? zh : en + '\n\n' + zh);
          const md = new vscode.MarkdownString(value); md.isTrusted = false; md.supportHtml = false; return md;
        });
        return new vscode.Hover(contents);
      } catch { return sourceResult(source); }
    },
  });
  try {
    for (const { doc, pos, file, external, definitions, signatureCount } of docs) {
      calls = 0;
      const output = await normal(doc, pos); const combined = flatten(output);
      assert.equal(output.length, 1); assert.equal(calls, 1, 'recursive query must skip self');
      for (const [en, zh] of pairs) { assert.equal(count(combined, en), 1); assert.equal(count(combined, zh), 1); assert(combined.indexOf(en) < combined.indexOf(zh)); }
      const defs = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', doc.uri, pos);
      assert.equal(defs.length, definitions, 'Hover exclusivity must not disable definitions');
      const completions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, pos);
      assert(completions.items.some(item => (typeof item.label === 'string' ? item.label : item.label.label) === 'greet'));
      const signatures = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', doc.uri, new vscode.Position(pos.line, 6));
      assert.equal(signatures?.signatures.length || 0, signatureCount);
      const externalSource = await recursive(doc, external);
      assert(flatten(externalSource).length > 0, 'external library source remains queryable');
      results.cases.push({ case: 'exclusive-paired', file, hoverCount: output.length, selfCalls: calls, duplicateEnglish: false, externalSourceCount: externalSource.length, definitions: defs.length, completionContainsGreet: true, signatureCount });
      const editor = await vscode.window.showTextDocument(doc); editor.selection = new vscode.Selection(pos, pos);
      delay = 1500;
      await vscode.commands.executeCommand('editor.action.hideHover');
      await vscode.commands.executeCommand('editor.action.showHover');
      await sleep(350); const early = await dom();
      assert(!early.text.includes(pairs[0][0]), 'independent native English should be suppressed while waiting');
      await sleep(1500); let late = await dom();
      for (let i = 0; i < 20 && !late.text.includes(pairs[0][1]); i++) { await sleep(100); late = await dom(); }
      for (const [en, zh] of pairs) { assert.equal(count(late.text, en), 1); assert.equal(count(late.text, zh), 1); }
      await capture(file + '-paired');
      results.cases.push({ case: 'native-DOM', file, earlyText: early.text, englishOnce: true, chineseOnce: true, delayMs: delay });
      delay = 0; await vscode.commands.executeCommand('editor.action.hideHover');
      behavior = 'chinese'; const chinese = flatten(await normal(doc, pos));
      assert(!chinese.includes(pairs[0][0]) && chinese.includes(pairs[0][1]));
      results.cases.push({ case: 'chinese-only', file, originalProseRemoved: true });
      behavior = 'failure'; const failed = flatten(await normal(doc, pos));
      assert.equal(count(failed, pairs[0][0]), 1); assert(!failed.includes(pairs[0][1]));
      results.cases.push({ case: 'explicit-failure-fallback', file, originalOnce: true });
      behavior = 'empty'; assert.equal((await normal(doc, pos)).length, 0);
      results.cases.push({ case: 'no-automatic-fallback', file, returningUndefinedSuppressesOriginal: true });
      behavior = 'paired';
    }
    calls = 0;
    const concurrent = await Promise.all(docs.map(({ doc, pos }) => normal(doc, pos)));
    assert(concurrent.every(h => h.length === 1 && flatten(h).includes(pairs[0][1]))); assert.equal(calls, 2);
    results.cases.push({ case: 'concurrent-python-javascript', selfCalls: calls, bounded: true });
    const third = vscode.languages.registerHoverProvider('javascript', { provideHover: () => new vscode.Hover('THIRD_PARTY_HOVER') });
    try {
      const output = await normal(docs[0].doc, docs[0].pos);
      assert.equal(output.length, 1); assert.equal(count(flatten(output), 'THIRD_PARTY_HOVER'), 1);
      results.cases.push({ case: 'third-party-normal-provider', aggregatedOnce: true });
    } finally { third.dispose(); }
    const rival = vscode.languages.registerHoverProvider({ language: 'javascript', scheme: 'file', exclusive: true }, { provideHover: () => new vscode.Hover('OTHER_EXCLUSIVE_HOVER') });
    try {
      assert(!flatten(await recursive(docs[0].doc, docs[0].pos)).includes('OTHER_EXCLUSIVE_HOVER'));
      const winner = flatten(await normal(docs[0].doc, docs[0].pos));
      results.cases.push({ case: 'competing-exclusive', recursiveOmitsOtherExclusive: true, translationVisible: winner.includes(pairs[0][1]), rivalVisible: winner.includes('OTHER_EXCLUSIVE_HOVER') });
    } finally { rival.dispose(); }
    const editor = await vscode.window.showTextDocument(docs[0].doc);
    const decoration = vscode.window.createTextEditorDecorationType({});
    try {
      const pos = docs[0].pos;
      editor.setDecorations(decoration, [{ range: new vscode.Range(pos.line, 0, pos.line, 5), hoverMessage: 'DECORATION_HOVER_STILL_VISIBLE' }]);
      editor.selection = new vscode.Selection(pos, pos);
      await vscode.commands.executeCommand('editor.action.showHover');
      let view = await dom(); for (let i = 0; i < 30 && !view.text.includes('DECORATION_HOVER_STILL_VISIBLE'); i++) { await sleep(100); view = await dom(); }
      assert(view.text.includes('DECORATION_HOVER_STILL_VISIBLE'));
      results.cases.push({ case: 'decoration-hover', stillVisible: true });
      await vscode.commands.executeCommand('editor.action.hideHover');
    } finally { decoration.dispose(); }
  } finally { exclusive.dispose(); }
  for (const { doc, pos, file } of docs) {
    const restored = flatten(await normal(doc, pos)); assert(restored.includes(pairs[0][0]) && !restored.includes(pairs[0][1]));
    results.cases.push({ case: 'dispose-restores-native', file, restored: true });
  }
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log('TAKEOVER RESULTS ' + JSON.stringify(results));
};
