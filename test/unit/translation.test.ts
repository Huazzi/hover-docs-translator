import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TranslationCoordinator } from '../../src/translation/translationCoordinator.js';
import { MemoryTranslationCache } from '../../src/cache/memoryTranslationCache.js';
import { createTranslator } from '../../src/translation/chatCompletionsClient.js';
import { normalizeEndpoint } from '../../src/config/endpoint.js';
import { TranslationError, type ServiceConfig, type Translations } from '../../src/translation/contracts.js';
const config: ServiceConfig = { endpoint: 'https://example.com/v1/chat/completions', model: 'test', revision: 1, timeoutMs: 1000, concurrent: 2, queueSize: 8, perMinute: 20 };
const segments = [{ id: 's0', text: 'Example description' }];
const signal = () => new AbortController().signal;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('endpoint root is explicit; rejects insecure/credential/redirect-style URLs', () => {
  assert.equal(normalizeEndpoint('https://example.com/v1/'), config.endpoint);
  assert.equal(normalizeEndpoint('https://example.com/'), 'https://example.com/chat/completions');
  for (const s of ['http://example.com', 'https://u:p@example.com', 'https://example.com?key=a', 'https://example.com/#x', config.endpoint]) assert.throws(() => normalizeEndpoint(s));
});
test('shared task survives one cancellation, caches result; cache clear invalidates late response', async () => {
  let calls = 0; let finish!: (v: Translations) => void;
  const pool = new TranslationCoordinator(async () => { calls++; return new Promise(resolve => { finish = resolve; }); }, new MemoryTranslationCache());
  const a = new AbortController();
  const first = pool.acquire(segments, config, a.signal); const firstCheck = assert.rejects(first, /cancelled/);
  const second = pool.acquire(segments, config, signal()); a.abort(); await firstCheck;
  finish({ s0: '译文' }); assert.deepEqual(await second, { s0: '译文' });
  assert.deepEqual(await pool.acquire(segments, config, signal()), { s0: '译文' }); assert.equal(calls, 1);
  pool.reset(); const late = pool.acquire(segments, config, signal()); const check = assert.rejects(late, /cancelled/);
  pool.reset(); await check; finish({ s0: 'old' }); await tick();
  const fresh = pool.acquire(segments, config, signal()); finish({ s0: 'new' }); assert.equal((await fresh).s0, 'new'); assert.equal(calls, 3);
});
test('last subscriber cancellation aborts HTTP; queue and rate are bounded', async () => {
  let aborted = false;
  const pool = new TranslationCoordinator(async (_s, _c, abort) => new Promise((_resolve, reject) => abort.addEventListener('abort', () => { aborted = true; reject(new TranslationError('cancelled')); })), new MemoryTranslationCache());
  const a = new AbortController(); const job = pool.acquire(segments, { ...config, concurrent: 1, queueSize: 0 }, a.signal); const check = assert.rejects(job);
  await assert.rejects(pool.acquire([{ id: 's0', text: 'other' }], { ...config, concurrent: 1, queueSize: 0 }, signal()), /queue_full/);
  a.abort(); await check; assert(aborted); pool.reset();
  const rate = new TranslationCoordinator(async () => ({ s0: '译文' }), new MemoryTranslationCache());
  await rate.acquire(segments, { ...config, perMinute: 1 }, signal());
  await assert.rejects(rate.acquire([{ id: 's0', text: 'different' }], { ...config, perMinute: 1 }, signal()), /rate_limited/);
});
test('401 blocks automatic requests until explicit configuration reset', async () => {
  let calls = 0;
  const pool = new TranslationCoordinator(async () => { calls++; throw new TranslationError('http_401'); }, new MemoryTranslationCache());
  await assert.rejects(pool.acquire(segments, config, signal()), /http_401/);
  await assert.rejects(pool.acquire(segments, config, signal()), /configuration_blocked/); assert.equal(calls, 1);
});
test('client uses no redirects, sends only supplied segments, and validates bounded response', async () => {
  const fake: typeof fetch = async (_url, options) => {
    assert.equal(options?.redirect, 'error'); assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer secret');
    const body = JSON.parse(String(options?.body)); assert.equal(body.stream, false); assert.equal(body.model, 'test');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"segments":[{"id":"s0","text":"译文"}]}' } }] }));
  };
  assert.deepEqual(await createTranslator(async () => 'secret', fake)(segments, config, signal()), { s0: '译文' });
  for (const response of [new Response('oops'), new Response('x'.repeat(512 * 1024 + 1)), new Response('', { status: 401 }), new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }))]) {
    await assert.rejects(createTranslator(async () => 'secret', async () => response)(segments, config, signal()));
  }
});
test('memory cache enforces LRU capacity and does not expose mutable cached objects', () => {
  const cache = new MemoryTranslationCache(2); cache.set('a', { s0: 'A' }); cache.set('b', { s0: 'B' });
  const a = cache.get('a')!; a.s0 = 'mutated'; cache.set('c', { s0: 'C' });
  assert.equal(cache.get('b'), undefined); assert.equal(cache.get('a')?.s0, 'A');
});
test('client timeout releases task slot even if transport ignores cancellation', async () => {
  const pool = new TranslationCoordinator(async () => new Promise(() => {}), new MemoryTranslationCache());
  await assert.rejects(pool.acquire(segments, { ...config, timeoutMs: 5 }, signal()), /timeout/);
});
test('concurrent 500 and timeout cannot shorten a prior 429 Retry-After', async () => {
  const originalNow = Date.now; let now = originalNow();
  Date.now = () => now;
  try {
    for (const laterFailure of ['http_500', 'timeout']) {
      const rejects: ((error: Error) => void)[] = []; let calls = 0;
      const pool = new TranslationCoordinator(async () => { calls++; return new Promise((_resolve, reject) => rejects.push(reject)); }, new MemoryTranslationCache());
      const first = pool.acquire(segments, config, signal()); const firstCheck = assert.rejects(first, /http_429/);
      const second = pool.acquire([{ id: 's0', text: 'other paragraph' }], config, signal()); const secondCheck = assert.rejects(second, new RegExp(laterFailure));
      rejects[0](new TranslationError('http_429', 120000)); await firstCheck;
      rejects[1](new TranslationError(laterFailure)); await secondCheck;
      now += 6000;
      await assert.rejects(pool.acquire([{ id: 's0', text: 'must stay blocked' }], config, signal()), /cooldown/);
      assert.equal(calls, 2);
      now += 115000;
      const after = pool.acquire([{ id: 's0', text: 'after original deadline' }], config, signal());
      const afterCheck = assert.rejects(after, /cancelled/); assert.equal(calls, 3);
      pool.reset(); await afterCheck; rejects[2](new TranslationError('cancelled')); await tick();
    }
  } finally { Date.now = originalNow; }
});
