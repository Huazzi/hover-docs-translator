import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HoverActivityTracker, type HoverTarget } from '../../src/hover/hoverActivityTracker.js';
const target: HoverTarget = { uri: 'file:///fixture.py', version: 1, line: 2, character: 1, revision: 1, modeGeneration: 1 };
test('late A never replaces B, nor resurrects after B expires; view changes only detach presentation', async () => {
  const tracker = new HoverActivityTracker(undefined, undefined, 5); tracker.setView(target.uri);
  const a = tracker.begin(target); const b = tracker.begin({ ...target, line: 4 });
  a.finish('completed'); assert.equal(tracker.snapshot()?.outcome, undefined);
  b.finish('completed'); assert.equal(tracker.snapshot()?.outcome, 'completed');
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(tracker.snapshot(), undefined);
  const c = tracker.begin(target); tracker.setView('file:///other.py');
  c.background(); c.finish('failed', { code: 'timeout' }); assert.equal(tracker.snapshot(), undefined);
  tracker.setView(target.uri); assert.equal(tracker.snapshot(), undefined); tracker.dispose();
});
test('same caret can explicitly select pending work; stale versions/modes and invalidated cells cannot', () => {
  const tracker = new HoverActivityTracker(); tracker.setView(target.uri);
  const a = tracker.begin({ ...target, notebookUri: 'file:///sample.ipynb' });
  a.observe({ kind: 'requesting', shared: true }); a.background();
  tracker.setView(target.uri); assert.equal(tracker.snapshot(), undefined);
  assert.equal(tracker.pendingAt({ ...target, version: 2 }), undefined);
  assert.equal(tracker.pendingAt({ ...target, modeGeneration: 2 }), undefined);
  assert.equal(tracker.pendingAt(target)?.background, true);
  tracker.invalidate('file:///sample.ipynb'); a.finish('completed');
  assert.equal(tracker.pendingAt(target), undefined); assert.equal(tracker.snapshot(), undefined); tracker.dispose();
});
test('stage timings distinguish collection, queue, execution and cache; observers cannot break work', () => {
  let now = 0; const tracker = new HoverActivityTracker(() => { throw new Error('UI'); }, () => now);
  tracker.setView(target.uri); const a = tracker.begin(target);
  now = 10; a.stage('queued'); now = 30; a.observe({ kind: 'requesting', shared: false });
  now = 80; a.stage('rendering'); now = 85; a.finish('completed');
  assert.deepEqual(tracker.snapshot()?.durations, { collecting: 10, queued: 20, requesting: 50, rendering: 5 });
  const b = tracker.begin(target); b.observe({ kind: 'cache_hit' }); b.finish('completed');
  assert.equal(tracker.snapshot()?.cacheHit, true); assert.equal(tracker.snapshot()?.durations.requesting, undefined); tracker.dispose();
});
