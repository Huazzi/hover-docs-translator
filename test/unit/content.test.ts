import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMarkdown, validateTranslation } from '../../src/content/markdownCodec.js';
test('AST protects all code, unsafe links and structure; model text cannot inject Markdown', () => {
  const doc = extractMarkdown(['```typescript\nfunction dangerous(arg: string): void\n```\n\nReturns `arg` from **the source**. [Read docs](https://example.com). [Unsafe](command:evil)\n\n| Key | Meaning |\n| --- | --- |\n| value | Return description |\n\n<script>secret()</script>'], 6000)!;
  assert(doc); assert(!doc.segments.some(s => s.text.includes('dangerous') || s.text.includes('command:') || s.text.includes('secret()')));
  const values = Object.fromEntries(doc.segments.map(s => [s.id, '[evil](command:run) <img src="http://tracker"> 中文说明']));
  const rendered = doc.render(values, false);
  assert(rendered.includes('function dangerous(arg: string): void'));
  assert(rendered.includes('`arg`')); assert(rendered.includes('https://example.com'));
  // Parser sees injected syntax as text, not active links, images or HTML.
  const second = extractMarkdown([rendered], 6000)!;
  assert(second.segments.some(s => s.text.includes('[evil](command:run)')));
  assert(!rendered.includes('[Unsafe](command:evil)'));
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
