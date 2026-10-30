import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HoverDiscoveryCoordinator } from '../../src/hover/hoverDiscoveryCoordinator.js';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('asynchronous RPC self callback exits without waiting on its parent', async () => {
  const gate = new HoverDiscoveryCoordinator(); let nested = 0;
  const result = await gate.collect(async () => {
    await sleep(2); nested++;
    assert.equal((await gate.collect(async () => 'recursive', new AbortController().signal, 50)).kind, 'busy');
    return 'source';
  }, new AbortController().signal, 100);
  assert.deepEqual(result, { kind: 'collected', value: 'source' });
  assert.equal(nested, 1); assert.equal(gate.state, 'idle');
});
test('timeout keeps gate occupied until late source really settles', async () => {
  const gate = new HoverDiscoveryCoordinator();
  let finish!: (value: string) => void;
  assert.equal((await gate.collect(() => new Promise(resolve => { finish = resolve; }), new AbortController().signal, 5)).kind, 'timeout');
  assert.equal(gate.state, 'draining');
  assert.equal((await gate.collect(async () => 'wrong', new AbortController().signal, 5)).kind, 'busy');
  finish('late'); await sleep(0); assert.equal(gate.state, 'idle');
});
test('cancellation keeps late self callback isolated, late rejection is handled', async () => {
  const gate = new HoverDiscoveryCoordinator(); const abort = new AbortController();
  let reject!: (error: Error) => void;
  const result = gate.collect(() => new Promise((_resolve, r) => { reject = r; }), abort.signal, 100);
  await sleep(0); abort.abort(); assert.equal((await result).kind, 'cancelled');
  assert.equal(gate.state, 'draining'); reject(new Error('late')); await sleep(0);
  assert.equal(gate.state, 'idle');
});
