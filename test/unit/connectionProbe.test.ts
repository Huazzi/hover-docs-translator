import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionProbe, PROBE_TEXT } from '../../src/ui/connectionProbe.js';
import { TranslationCoordinator, type WorkEvent } from '../../src/translation/translationCoordinator.js';
import { MemoryTranslationCache } from '../../src/cache/memoryTranslationCache.js';
import { createTranslator } from '../../src/translation/chatCompletionsClient.js';
import { TranslationError, type ServiceConfig, type Translations } from '../../src/translation/contracts.js';
const config: ServiceConfig = { endpoint: 'https://example.com/chat/completions', model: 'fake', revision: 1, timeoutMs: 1000, concurrent: 2, queueSize: 2, perMinute: 20 };
const signal = () => new AbortController().signal;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('probe single-flight covers confirmation, bypasses cache, sends only fixed sample, and leaves document cache intact', async () => {
  let calls = 0; let confirmations = 0; let approve!: (value: boolean) => void;
  const pool = new TranslationCoordinator(async segments => {
    calls++; assert.equal(segments[0].text, PROBE_TEXT); return Object.fromEntries(segments.map(s => [s.id, s.text]));
  }, new MemoryTranslationCache());
  const segments = [{ id: 'probe0', text: PROBE_TEXT }];
  await pool.acquire(segments, config, signal());
  const probe = new ConnectionProbe({ settings: () => config, pool, preflight: async () => undefined,
    confirm: async () => { confirmations++; return new Promise(resolve => { approve = resolve; }); } });
  const a = probe.run(); const b = probe.run(); assert.equal(a, b);
  await tick(); assert.equal(confirmations, 1); assert.equal(calls, 1);
  approve(true); assert.equal((await a).outcome, 'passed'); assert.equal(calls, 2);
  await pool.acquire(segments, config, signal()); assert.equal(calls, 2);
  const again = probe.run(); await tick(); approve(true); await again; assert.equal(calls, 3);
  pool.reset();
});
test('missing key, unsupported environment, and rejected confirmation make no requests', async () => {
  const pool = new TranslationCoordinator(async () => assert.fail('network forbidden'), new MemoryTranslationCache());
  for (const code of ['missing_key', 'unsupported_environment']) {
    const probe = new ConnectionProbe({ settings: () => config, pool, preflight: async () => code,
      confirm: async () => assert.fail('must not confirm when locally blocked') });
    assert.equal((await probe.run()).code, code);
  }
  const declined = new ConnectionProbe({ settings: () => config, pool, preflight: async () => undefined, confirm: async () => false });
  assert.equal((await declined.run()).outcome, 'cancelled'); pool.reset();
});
test('configuration or permission invalidation during confirmation cannot transfer authorization', async () => {
  for (const change of ['config', 'permission']) {
    let current = config; let approve!: (value: boolean) => void;
    const pool = new TranslationCoordinator(async () => assert.fail('stale request'), new MemoryTranslationCache());
    const probe = new ConnectionProbe({ settings: () => current, pool, preflight: async () => undefined,
      confirm: async () => new Promise(resolve => { approve = resolve; }) });
    const pending = probe.run(); await tick();
    if (change === 'config') current = { ...config, endpoint: 'https://other.example/chat/completions', revision: 2 };
    else probe.cancel();
    approve(true); assert.equal((await pending).outcome, 'cancelled'); assert.equal(probe.result, undefined);
    pool.reset();
  }
});
test('cancelled diagnostic subscriber does not cancel unrelated document task; queued test is not sent', async () => {
  let calls = 0; let release!: (v: Translations) => void; let documentSignal!: AbortSignal;
  const pool = new TranslationCoordinator(async (_s, _c, sig) => { calls++; documentSignal = sig; return new Promise(resolve => { release = resolve; }); }, new MemoryTranslationCache());
  const limited = { ...config, concurrent: 1 };
  const document = pool.acquire([{ id: 'doc', text: 'Document description.' }], limited, signal());
  const probe = new ConnectionProbe({ settings: () => limited, pool, preflight: async () => undefined, confirm: async () => true });
  const pending = probe.run(); await tick(); assert.equal(pool.snapshot(limited).queued, 1);
  probe.cancel(); assert.equal((await pending).outcome, 'cancelled'); assert(!documentSignal.aborted); assert.equal(calls, 1);
  release({ doc: '说明' }); await document; pool.reset();
});
test('probe validates JSON and protected markers, not just HTTP 200', async () => {
  const translator = createTranslator(async () => 'fixture', async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"segments":[{"id":"probe0","text":"missing protected token"}]}' } }],
  })));
  const pool = new TranslationCoordinator(translator, new MemoryTranslationCache());
  const probe = new ConnectionProbe({ settings: () => config, pool, preflight: async () => undefined, confirm: async () => true });
  assert.equal((await probe.run()).code, 'invalid_translation'); pool.reset();
});
test('reset never clears cooldown or rolling starts; only explicit repair releases configuration block', async () => {
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  try {
    let calls = 0;
    const pool = new TranslationCoordinator(async () => { calls++; throw new TranslationError('http_401'); }, new MemoryTranslationCache());
    const input = [{ id: 's0', text: 'Description' }];
    await assert.rejects(pool.acquire(input, config, signal()), /http_401/);
    pool.reset(); assert.equal(pool.snapshot(config).blockedReason, 'http_401');
    const blocked = new ConnectionProbe({ settings: () => config, pool, preflight: async () => undefined, confirm: async () => assert.fail('blocked') });
    assert.equal((await blocked.run()).code, 'configuration_blocked'); assert.equal(calls, 1);
    pool.reset(undefined, { releaseConfigurationBlock: true });
    assert.equal(pool.snapshot(config).blockedReason, undefined);
    await assert.rejects(pool.acquire(input, config, signal()), /cooldown/);
    now += 5001; assert.equal(pool.snapshot({ perMinute: 1 }).rateRemainingMs! > 0, true);
    await assert.rejects(pool.acquire(input, { ...config, perMinute: 1 }, signal()), /rate_limited/);
    now += 60000; assert.equal(pool.snapshot({ perMinute: 1 }).rateRemainingMs, 0);
    pool.reset();
  } finally { Date.now = originalNow; }
});
test('shared observations report current stage, detach on cancellation, and ignore observer failures', async () => {
  let release!: (v: Translations) => void; let calls = 0;
  const pool = new TranslationCoordinator(async () => { calls++; return new Promise(resolve => { release = resolve; }); }, new MemoryTranslationCache());
  const a = new AbortController(); const eventsA: WorkEvent[] = []; const eventsB: WorkEvent[] = [];
  const input = [{ id: 's0', text: 'Description' }];
  const first = pool.acquire(input, config, a.signal, { observe: event => { eventsA.push(event); throw new Error('UI'); } });
  const rejection = assert.rejects(first, /cancelled/);
  const second = pool.acquire(input, config, signal(), { observe: event => eventsB.push(event) });
  assert.deepEqual(eventsB, [{ kind: 'requesting', shared: true }]);
  a.abort(); await rejection; const length = eventsA.length;
  release({ s0: '说明' }); await second; assert.equal(eventsA.length, length); assert.equal(calls, 1);
  const cached: WorkEvent[] = []; await pool.acquire(input, config, signal(), { observe: e => cached.push(e) });
  assert.deepEqual(cached, [{ kind: 'cache_hit' }]); pool.reset();
});
test('429 survives explicit service repair and prevents a probe before its confirmation', async () => {
  const pool = new TranslationCoordinator(async () => { throw new TranslationError('http_429', 120000); }, new MemoryTranslationCache());
  await assert.rejects(pool.acquire([{ id: 's0', text: 'Description' }], config, signal()), /http_429/);
  const before = pool.snapshot(config).cooldownRemainingMs;
  pool.reset(undefined, { releaseConfigurationBlock: true });
  assert(pool.snapshot(config).cooldownRemainingMs >= before - 100);
  const probe = new ConnectionProbe({ settings: () => ({ ...config, model: 'changed' }), pool, preflight: async () => undefined,
    confirm: async () => assert.fail('cooldown must be explained before a paid request confirmation') });
  assert.equal((await probe.run()).code, 'cooldown'); pool.reset();
});
test('queued shared observers receive start once; cancelled subscriber receives no late start', async () => {
  let release!: (value: Translations) => void;
  const pool = new TranslationCoordinator(async segments => segments[0].id === 'holder'
    ? new Promise(resolve => { release = resolve; }) : { s0: '说明' }, new MemoryTranslationCache());
  const limited = { ...config, concurrent: 1 };
  const holder = pool.acquire([{ id: 'holder', text: 'Hold the slot' }], limited, signal());
  const cancelled = new AbortController(); const firstEvents: WorkEvent[] = []; const secondEvents: WorkEvent[] = [];
  const input = [{ id: 's0', text: 'Queued documentation' }];
  const first = pool.acquire(input, limited, cancelled.signal, { observe: event => firstEvents.push(event) });
  const check = assert.rejects(first, /cancelled/);
  const second = pool.acquire(input, limited, signal(), { observe: event => secondEvents.push(event) });
  assert.equal(pool.snapshot(limited).queued, 1);
  cancelled.abort(); await check; release({ holder: '完成' }); await holder; await second;
  assert.deepEqual(firstEvents, [{ kind: 'queued', shared: false }]);
  assert.deepEqual(secondEvents, [{ kind: 'queued', shared: true }, { kind: 'requesting', shared: true }]); pool.reset();
});
