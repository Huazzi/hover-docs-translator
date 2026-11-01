import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes } from 'mdast';
import { extractMarkdown, type ProtectedDocument } from '../../src/content/markdownCodec.js';
import { hoverMarkdown } from '../../src/content/hoverMarkdownRenderer.js';
const parser = unified().use(remarkParse).use(remarkGfm);
const translated = (doc: ProtectedDocument) => Object.fromEntries(doc.segments.map(s => [s.id, '译文 ' + s.text]));
function nodes(markdown: string, type: Nodes['type']): Nodes[] {
  const found: Nodes[] = [];
  function visit(node: Nodes) { if (node.type === type) found.push(node); if ('children' in node) node.children.forEach(visit); }
  visit(parser.parse(markdown)); return found;
}

test('compact titles normalize independently, preserve content, and leave segments unchanged', () => {
  const doc = extractMarkdown(['# Main\n\nRead `value` from [docs](https://example.com).\n\n### Detail\n\n```js\nexample()\n```', '## Another\n\nMore prose.'], 6000)!;
  const before = structuredClone(doc.segments); const result = translated(doc);
  const compact = doc.render(result, false); const paired = doc.render(result, true);
  assert.deepEqual(nodes(compact, 'heading').map(h => h.type === 'heading' && h.depth), [4, 6, 4]);
  assert.equal(nodes(paired, 'heading').length, 3);
  assert.deepEqual(paired, compact, 'Stable mode relies on the native original instead of copying it');
  assert.equal(nodes(paired, 'code').length, 1);
  assert.equal(nodes(paired, 'blockquote').length, 0);
  assert(paired.includes('https://example.com')); assert(paired.includes('`value`'));
  assert.deepEqual(doc.segments, before);
  const framed = hoverMarkdown(compact, false);
  assert.equal(framed, compact); assert(!framed.includes('部分内容未翻译'));
});

test('stable paired lists keep numbering and nesting without additional original quotations', () => {
  const doc = extractMarkdown(['3. Read the value.\n4. Write the result.\n   - Keep this detail.\n\n> Read carefully.'], 6000)!;
  const output = doc.render(translated(doc), true);
  const lists = nodes(output, 'list');
  assert.equal(lists.length, 2);
  assert(lists[0].type === 'list' && lists[0].start === 3 && lists[0].children.length === 2);
  assert.equal(nodes(output, 'listItem').length, 3);
  assert.equal(nodes(output, 'blockquote').length, 1); // Only the actual source quotation.
  assert(!output.includes('原文：'));
  assert.equal((output.match(/Read the value\./g) || []).length, 1);
});

test('stable paired tables retain shape without appending an original table', () => {
  const source = '| Parameter | Meaning |\n| :--- | ---: |\n| `path` | File path |';
  const doc = extractMarkdown([source], 6000)!;
  const tables = nodes(doc.render(translated(doc), true), 'table');
  assert.equal(tables.length, 1);
  for (const table of tables) { assert(table.type === 'table'); assert.deepEqual(table.align, ['left', 'right']); assert.equal(table.children.length, 2); assert(table.children.every(row => row.children.length === 2)); }
  assert.equal(nodes(doc.render(translated(doc), false), 'table').length, 1);
  const identity = Object.fromEntries(doc.segments.map(s => [s.id, s.text]));
  assert.equal(nodes(doc.render(identity, true), 'table').length, 1);
});

test('budget annotations identify only skipped prose, including tables and nested lists', () => {
  const doc = extractMarkdown(['Short.\n\n这是中文。\n\n```js\nexample()\n```\n\n- This is a long parameter description.\n\n| Name | Meaning |\n| --- | --- |\n| value | Description |'], 6)!;
  const output = doc.render({ s0: '简短。' }, true);
  assert(doc.partial);
  assert.equal((output.match(/原文保留（超出本次翻译预算）/g) || []).length, 1);
  assert.equal((output.match(/此表部分内容超出翻译预算/g) || []).length, 1);
  assert.equal(nodes(output, 'table').length, 1);
  assert.equal(nodes(output, 'code').length, 1);
  assert(output.includes('这是中文。')); assert(hoverMarkdown(output, true).includes('部分内容未翻译'));
});

test('only independent leading declarations with same-hover prose are omitted', () => {
  const declaration = '```typescript\nfunction greet(name: string): string\n```';
  const source = [declaration, 'Returns a greeting.'];
  const doc = extractMarkdown(source.map((value, contentIndex) => ({ value, sourceId: 0, contentIndex })), 6000)!;
  const flat = extractMarkdown(source, 6000)!;
  assert.deepEqual(doc.segments, flat.segments);
  assert(!doc.render(translated(doc), false).includes('function greet'));
  assert(flat.render(translated(flat), false).includes('function greet'));
  for (const value of ['```js\ngreet("Ada")\n```', '```js\nfunction greet() { return "hello"; }\n```', '```ts\nfunction greet(\n name: string\n): string\n```', '```python\nclass Thing:\n```']) {
    const kept = extractMarkdown([{ value, sourceId: 0, contentIndex: 0 }, { value: source[1], sourceId: 0, contentIndex: 1 }], 6000)!;
    assert.equal(nodes(kept.render(translated(kept), false), 'code').length, 1, value);
  }
  const unrelated = extractMarkdown([{ value: declaration, sourceId: 0, contentIndex: 0 }, { value: source[1], sourceId: 1, contentIndex: 0 }], 6000)!;
  assert.equal(nodes(unrelated.render(translated(unrelated), false), 'code').length, 1);
  const mixed = extractMarkdown([declaration + '\n\n' + source[1]], 6000)!;
  assert.equal(nodes(mixed.render(translated(mixed), true), 'code').length, 1);
});

test('paired content cannot activate injected HTML, code fences or command links', () => {
  const doc = extractMarkdown(['Read **carefully** and use `value`.'], 6000)!;
  const result = Object.fromEntries(doc.segments.map(s => [s.id, '[run](command:evil) <script>evil()</script> ```js ' + s.text]));
  const output = doc.render(result, true);
  assert.equal(nodes(output, 'html').length, 0); assert.equal(nodes(output, 'link').length, 0); assert.equal(nodes(output, 'code').length, 0);
  assert.equal(nodes(output, 'inlineCode').length, 1);
});
