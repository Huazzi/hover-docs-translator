import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectConfiguration, diagnosticSummary, type LocalDiagnosticSnapshot } from '../../src/ui/configurationDiagnostics.js';
import { ServiceIdentity } from '../../src/config/settingsChange.js';
test('local inspection distinguishes missing/invalid fields and has no transport dependency', () => {
  assert.equal(inspectConfiguration('', '').issue, 'missing_endpoint');
  assert.equal(inspectConfiguration('http://example.com', 'model').issue, 'invalid_endpoint');
  assert.equal(inspectConfiguration('https://example.com', '').issue, 'missing_model');
  assert.equal(inspectConfiguration('https://example.com', 'model').endpoint, 'https://example.com/chat/completions');
});
test('diagnostic summary allows facts but removes hidden runtime fields and arbitrary error codes', () => {
  const snapshot: LocalDiagnosticSnapshot = {
    extensionVersion: '0.5.0', vscodeVersion: '1.144.0', platform: 'win32',
    configuration: { endpointConfigured: true, modelConfigured: true }, keyPresent: true, local: true, trusted: true, enabled: true, documentConsent: false,
    document: { language: 'private-secret-language', kind: 'file' }, mode: { requested: 'stable', effective: 'stable' },
    discovery: 'idle', service: { active: 0, queued: 0, cooldownRemainingMs: 0, blockedReason: 'secret_server_response' },
    activity: { stage: 'requesting', outcome: 'failed', background: false, cacheHit: false, shared: false, elapsedMs: 20, durations: { requesting: 20 }, code: 'private_path_key' },
  };
  const withPrivateFields = { ...snapshot, endpoint: 'https://secret.example', model: 'private-model', key: 'fixture-secret', uri: 'D:/private/code.py' };
  const text = diagnosticSummary(withPrivateFields);
  for (const value of ['secret.example', 'private-model', 'fixture-secret', 'D:/private', 'secret_server_response', 'private_path_key', 'private-secret-language']) assert(!text.includes(value), value);
  assert(text.includes('"keyPresent": true')); assert(text.includes('"documentConsent": false')); assert(text.includes('unknown'));
});
test('invalid intermediate configuration and restoring same identity never release a block', () => {
  const identity = new ServiceIdentity(); const config = { endpoint: 'https://example.com/chat/completions', model: 'one' };
  assert(!identity.update(config)); assert(!identity.update(undefined)); assert(!identity.update(config));
  assert(!identity.update({ ...config })); assert(identity.update({ ...config, model: 'two' }));
  assert(!identity.update(undefined)); assert(identity.update(config));
});
