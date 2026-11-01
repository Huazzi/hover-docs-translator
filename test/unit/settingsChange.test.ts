import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPresentationOnlyChange, applyConfigurationChange } from '../../src/config/settingsChange.js';
import type { Settings } from '../../src/config/settingsService.js';
import { TranslationCoordinator } from '../../src/translation/translationCoordinator.js';
import { MemoryTranslationCache } from '../../src/cache/memoryTranslationCache.js';
import { TranslationError } from '../../src/translation/contracts.js';
const config: Settings = { endpoint: 'https://example.com/chat/completions', model: 'test', revision: 1, enabled: true, paired: false, maxChars: 6000, discoveryTimeoutMs: 5000, timeoutMs: 15000, concurrent: 2, queueSize: 8, perMinute: 20, cacheEntries: 500, cacheTtlMs: 86400000 };

test('presentation classification rejects mixed changes to every service field and missing configs', () => {
  assert(isPresentationOnlyChange(config, { ...config, paired: true }));
  assert(!isPresentationOnlyChange(undefined, { ...config, paired: true }));
  assert(!isPresentationOnlyChange(config, undefined)); assert(!isPresentationOnlyChange(config, { ...config }));
  for (const key of Object.keys(config) as (keyof Settings)[]) {
    if (key === 'paired') continue;
    const value = config[key];
    const changed = typeof value === 'number' ? value + 1 : typeof value === 'boolean' ? !value : value + '/changed';
    assert(!isPresentationOnlyChange(config, { ...config, paired: true, [key]: changed }), key);
  }
  assert(!isPresentationOnlyChange(config, { ...config, paired: true, futureServiceSetting: 1 } as Settings));
});

test('configuration dispatch preserves old snapshot, and read failures force invalidation', () => {
  let current = config; let resets = 0;
  applyConfigurationChange(current, () => ({ ...config, paired: true }), next => { current = next; }, () => { resets++; });
  assert.equal(resets, 0); assert.equal(config.paired, false); assert.equal(current.paired, true); assert.equal(current.revision, config.revision);
  applyConfigurationChange(current, () => { throw new Error('invalid endpoint'); }, () => assert.fail('must invalidate'), () => { resets++; });
  assert.equal(resets, 1);
});

test('changing presentation cannot clear 401 block or 429 cooldown', async () => {
  for (const [code, subsequent] of [['http_401', 'configuration_blocked'], ['http_429', 'cooldown']]) {
    let calls = 0; let current = config;
    const pool = new TranslationCoordinator(async () => { calls++; throw new TranslationError(code, 120000); }, new MemoryTranslationCache());
    const segments = [{ id: 's0', text: 'Description.' }];
    await assert.rejects(pool.acquire(segments, current, new AbortController().signal), new RegExp(code));
    // Hover mode and wait preferences are outside the service snapshot; their event reads
    // identical settings and must not clear cooldown/authentication state either.
    applyConfigurationChange(current, () => ({ ...current }), next => { current = next; }, () => pool.reset());
    applyConfigurationChange(current, () => ({ ...current, paired: true }), next => { current = next; }, () => pool.reset());
    await assert.rejects(pool.acquire(segments, current, new AbortController().signal), new RegExp(subsequent));
    assert.equal(calls, 1); pool.reset();
  }
});
