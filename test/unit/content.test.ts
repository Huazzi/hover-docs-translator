import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMarkdown, validateTranslation } from '../../src/content/markdownCodec.js';
test('AST protects all code, unsafe links and structure; model text cannot inject Markdown', () => {
  const doc = extractMarkdown(['```typescript\nfunction dangerous(arg: string): void\n```\n\nReturns `arg` from **the source**. [Read docs](https://example.com). [Unsafe](command:evil)\n\n| Key | Meaning |\n| --- | --- |\n| value | Return description |\n\n<script>secret()</script>'], 6000)!;
  assert(doc); assert(!doc.segments.some(s => s.text.includes('dangerous') || s.text.includes('command:') || s.text.includes('secret()')));
  const values = Object.fromEntries(doc.segments.map(s => [s.id, '[evil](command:run) <img src="http://tracker"> 中文说明' + (s.text.match(/⟦HDT_[^⟧]*⟧/g) || []).join('')]));
  const rendered = doc.render(values, false);
  assert(rendered.includes('function dangerous(arg: string): void'));
  assert(rendered.includes('`arg`')); assert(rendered.includes('https://example.com'));
  // Parser sees injected syntax as text, not active links, images or HTML.
  const second = extractMarkdown([rendered], 6000)!;
  assert(second.segments.some(s => s.text.includes('[evil](command:run)')));
  assert(!rendered.includes('[Unsafe](command:evil)'));
});
test('whole paragraphs include short prose and protected inline positions', () => {
  for (const source of ['Use `foo`.', 'Set `value` to `null`.']) {
    const doc = extractMarkdown([source], 6000)!;
    assert(doc); assert.equal(doc.segments.length, 1);
    assert(doc.segments[0].text.startsWith(source.split('`')[0]));
    assert(!doc.segments[0].text.includes('foo')); // Code remains local.
  }
  const doc = extractMarkdown(['Return `false` if the file exists and `true` otherwise.'], 6000)!;
  assert.equal(doc.segments[0].text, 'Return ⟦HDT_0⟧ if the file exists and ⟦HDT_1⟧ otherwise.');
  assert.equal(doc.render({ s0: '如果文件存在则返回 ⟦HDT_0⟧，否则返回 ⟦HDT_1⟧。' }, false).trim(), '如果文件存在则返回 `false`，否则返回 `true`。');
});
test('nested inline formatting and safe links round-trip without trusting model syntax', () => {
  const doc = extractMarkdown(['Read **carefully** and use `foo` with [docs](https://example.com).'], 6000)!;
  const identity = Object.fromEntries(doc.segments.map(s => [s.id, s.text]));
  assert.equal(doc.segments.length, 1);
  assert.match(doc.render(identity, false), /Read \*\*carefully\*\* and use `foo` with \[docs\]\(https:\/\/example.com\)/);
  const payload = JSON.stringify({ segments: [{ id: 's0', text: doc.segments[0].text }] });
  assert.doesNotThrow(() => validateTranslation(payload, doc.segments));
  for (const text of [doc.segments[0].text.replace('⟦HDT_0⟧', ''), doc.segments[0].text + '⟦HDT_0⟧', doc.segments[0].text.replace('⟦HDT_0⟧', '⟦HDT_99⟧')]) {
    assert.throws(() => validateTranslation(JSON.stringify({ segments: [{ id: 's0', text }] }), doc.segments));
    assert.throws(() => doc.render({ s0: text }, false));
  }
});
test('reference links resolve full, collapsed and shortcut definitions before sanitization', () => {
  for (const source of ['Read [documentation][ref].\n\n[ref]: https://example.com/docs', 'Read [documentation][].\n\n[documentation]: https://example.com/docs', 'Read [documentation].\n\n[documentation]: https://example.com/docs']) {
    const doc = extractMarkdown([source], 6000)!;
    const identity = Object.fromEntries(doc.segments.map(s => [s.id, s.text]));
    assert(doc.render(identity, false).includes('[documentation](https://example.com/docs)'));
    assert(!doc.segments[0].text.includes('https://')); // Destination never goes to the model.
  }
  const unsafe = extractMarkdown(['Read [documentation][ref].\n\n[ref]: command:evil'], 6000)!;
  assert(!unsafe.render({ s0: unsafe.segments[0].text }, false).includes('command:'));
  const scoped = extractMarkdown(['Read [one][ref].\n\n[ref]: https://one.example', 'Read [two][ref].\n\n[ref]: https://two.example'], 6000)!;
  const rendered = scoped.render(Object.fromEntries(scoped.segments.map(s => [s.id, s.text])), false);
  assert(rendered.includes('https://one.example')); assert(rendered.includes('https://two.example'));
});
test('recognizable bare JS and Python signatures do not become cloud prose', () => {
  for (const source of ['calculateResult(first, second)', 'calculate_result(first: int, second: int) -> int', 'async calculateResult(first, second): Promise<number>', 'def calculate_result(first: int) -> int:', 'class Calculator:']) assert.equal(extractMarkdown([source], 6000), undefined, source);
  assert(extractMarkdown(['Call calculateResult(first, second) to obtain the result.'], 6000));
});
test('paragraph budget never partially translates around an inline protected node', () => {
  const doc = extractMarkdown(['Short text.\n\nUse `value` to update the current configuration.\n\nGo.'], 20)!;
  assert(doc.partial); assert.equal(doc.segments.length, 1);
});
test('empty/code/Chinese/signature-only content is skipped; budget marks partial', () => {
  for (const s of ['```python\ndef function(x): pass\n```', '这是中文说明', '(function) greet(name: string): string']) assert.equal(extractMarkdown([s], 6000), undefined);
  const doc = extractMarkdown(['Short description.\n\nAnother long description.'], 20)!;
  assert(doc.partial); assert.equal(doc.segments.length, 1);
});
test('validation refuses missing, extra, duplicate, empty and malformed segment output', () => {
  const segments = [{ id: 's0', text: 'source' }, { id: 's1', text: 'other' }];
  for (const raw of ['not json', '{"segments":[]}', '{"segments":[{"id":"s0","text":"译文"},{"id":"s0","text":"译文"}]}', '{"segments":[{"id":"s0","text":""},{"id":"s1","text":"译文"}]}']) assert.throws(() => validateTranslation(raw, segments));
  assert.deepEqual(validateTranslation(JSON.stringify({ segments: segments.map(s => ({ id: s.id, text: '译文' })) }), segments), { s0: '译文', s1: '译文' });
});
