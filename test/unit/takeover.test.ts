import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecursiveHoverReader } from '../../src/hover/recursiveHoverReader.js';
import { HoverModeController, type HoverMode } from '../../src/hover/hoverModeController.js';
import { extractMarkdown, canRebuildMarkdown } from '../../src/content/markdownCodec.js';
import { applyConfigurationChange } from '../../src/config/settingsChange.js';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes } from 'mdast';

const signal = () => new AbortController().signal;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test('recursive source reads deduplicate positions, overlap documents and keep timed-out leases bounded', async () => {
  const reader = new RecursiveHoverReader<number>(2); let calls = 0; let release!: (value: number) => void;
  const read = () => { calls++; return new Promise<number>(resolve => { release = resolve; }); };
  const a = reader.collect('a', read, signal(), 10);
  const b = reader.collect('a', read, signal(), 1000);
  assert.deepEqual(await reader.collect('b', async () => 2, signal(), 1000), { kind: 'value', value: 2 });
  assert.deepEqual(await a, { kind: 'timeout' }); assert.equal(calls, 1);
  const other = reader.collect('c', () => new Promise<number>(() => {}), signal(), 10);
  assert.deepEqual(await reader.collect('d', async () => 3, signal(), 10), { kind: 'busy' });
  release(1); assert.deepEqual(await b, { kind: 'value', value: 1 }); await other;
  assert.deepEqual(await reader.collect('d', async () => 3, signal(), 100), { kind: 'value', value: 3 });
  reader.dispose();
});

test('source cancellation does not release uncancellable command, and late rejection is consumed', async () => {
  const reader = new RecursiveHoverReader<number>(1); const controller = new AbortController(); let reject!: (reason: Error) => void;
  const wait = reader.collect('a', () => new Promise<number>((_, fail) => { reject = fail; }), controller.signal, 1000);
  await sleep(0); controller.abort(); assert.deepEqual(await wait, { kind: 'cancelled' });
  assert.deepEqual(await reader.collect('b', async () => 2, signal(), 1000), { kind: 'busy' });
  reject(new Error('late')); await sleep(0);
  assert.deepEqual(await reader.collect('b', async () => 2, signal(), 1000), { kind: 'value', value: 2 }); reader.dispose();
});

test('mode controller guards capability, latches source failure and ignores stale capability results', async () => {
  let registrations = 0; let disposals = 0; let gate = false; let available: () => Promise<boolean> = async () => true;
  let fail!: () => void; const log: HoverMode[] = [];
  const controller = new HoverModeController<HoverMode>({
    available: () => available(),
    create(mode, failure) { if (mode === 'experimentalTakeover') fail = failure; return { provider: mode, dispose() { disposals++; } }; },
    register(provider, exclusive) { if (exclusive && !gate) throw new Error('proposal denied'); registrations++; log.push(provider); assert.equal(registrations, 1); return { dispose() { registrations--; } }; },
    report() {},
  });
  await controller.select('experimentalTakeover'); assert.equal(controller.current.reason, 'takeover_proposal_unavailable'); assert.equal(registrations, 1);
  gate = true; await controller.select('experimentalTakeover'); assert.equal(controller.current.effective, 'stable');
  await controller.select('experimentalTakeover', true); assert.equal(controller.current.effective, 'experimentalTakeover');
  fail(); assert.equal(controller.current.reason, 'takeover_source_failed'); assert.equal(controller.current.effective, 'stable');
  await controller.select('experimentalTakeover'); assert.equal(controller.current.effective, 'stable');
  let release!: (value: boolean) => void; available = () => new Promise(resolve => { release = resolve; });
  const pending = controller.select('experimentalTakeover', true); await controller.select('stable'); release(true); await pending;
  assert.equal(controller.current.effective, 'stable'); assert.equal(log.at(-1), 'stable');
  available = async () => false; await controller.select('experimentalTakeover'); assert.equal(controller.current.reason, 'takeover_command_unavailable');
  controller.dispose(); assert.equal(registrations, 0); assert(disposals > 0);
});

test('takeover keeps signatures, original-first paragraph/list/table order and global segment budget', () => {
  const fragments = ['```typescript\nfunction greet(name: string): string\n```', '# Summary\n\nReturn a greeting.\n\n3. Read the value.\n   - Keep a detail.\n\n| Name | Meaning |\n| --- | --- |\n| item | A result |'];
  const doc = extractMarkdown(fragments.map((value, contentIndex) => ({ value, sourceId: 0, contentIndex })), 6000, true)!;
  const result = Object.fromEntries(doc.segments.map((s, index) => [s.id, `译文${index}`]));
  const out = doc.render(result, true);
  assert(out.includes('function greet')); assert.equal(out.split('Return a greeting.').length - 1, 1);
  assert(out.indexOf('Return a greeting.') < out.indexOf('译文1'));
  const tree = unified().use(remarkParse).use(remarkGfm).parse(out); const nodes: Nodes[] = [];
  function walk(node: Nodes) { nodes.push(node); if ('children' in node) node.children.forEach(walk); } walk(tree);
  assert.equal(nodes.filter(n => n.type === 'code').length, 1);
  assert.equal(nodes.filter(n => n.type === 'table').length, 2);
  assert(nodes.some(n => n.type === 'list' && n.start === 3));
  assert(nodes.some(n => n.type === 'heading' && n.depth === 4));
  const only = doc.render(result, false); assert(!only.includes('Return a greeting.')); assert(only.includes('function greet'));
  assert.equal(doc.renderFragments(result, true)[0], undefined, 'signature fragment stays original');
  const partial = extractMarkdown(['Short.', 'This is a long statement.'], 6, true)!;
  assert(partial.renderFragments({ s0: '短句。' }, false)[1]?.includes('超出本次翻译预算'));
});

test('takeover refuses lossy source markup and escapes model syntax', () => {
  for (const value of ['Read [run](command:evil).', 'Read [relative](./api.md).', 'Read ![img](https://example.com/a.png).', '<b>Read</b>']) assert(!canRebuildMarkdown(value), value);
  assert(canRebuildMarkdown('Read [link][missing].')); // Unresolved references are literal text in CommonMark.
  assert(canRebuildMarkdown('Read [docs](https://example.com).'));
  assert(canRebuildMarkdown('Read a value.\n<!--moduleHash:123-->'));
  assert(!canRebuildMarkdown('<!-- first --> <img src="x"> <!-- last -->'));
  const doc = extractMarkdown(['Read a value.'], 100, true)!;
  const output = doc.render({ s0: '[run](command:evil) <script>bad</script>' }, true);
  assert(output.includes('Read a value.')); assert(!output.includes('[run](command:evil)'));
  const identity = doc.render({ s0: 'Read a value.' }, true); assert.equal(identity.trim(), 'Read a value.');
});

test('unchanged service snapshot from control-only event cannot reset service protections', () => {
  // An absent service config remains absent while users choose the hover mode.
  applyConfigurationChange(undefined, () => undefined, () => assert.fail(), () => assert.fail('unrelated preference reset'));
});
