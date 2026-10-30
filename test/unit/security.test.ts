import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { CredentialStore } from '../../src/security/credentialStore.js';
import { ConsentStore } from '../../src/security/consentStore.js';
test('credentials are endpoint-bound and clearing affects only this extension namespace', async () => {
  const values = new Map<string, string>([['unrelated', 'retain']]);
  const secrets: vscode.SecretStorage = {
    get: async k => values.get(k), store: async (k, v) => { values.set(k, v); }, delete: async k => { values.delete(k); }, keys: async () => [...values.keys()],
    onDidChange: () => ({ dispose() {} }),
  };
  const store = new CredentialStore(secrets);
  await store.set('https://one.example/chat/completions', 'secret');
  assert.equal(await store.get('https://two.example/chat/completions'), undefined);
  assert.equal(await store.get('https://one.example/chat/completions'), 'secret');
  assert(![...values.keys()].some(k => k.includes('secret') || k.includes('one.example')));
  await store.clearAll(); assert.deepEqual([...values.entries()], [['unrelated', 'retain']]);
});
test('cloud consent is explicit per endpoint and revocable without storing documents', async () => {
  const values = new Map<string, unknown>();
  const state: vscode.Memento = { keys: () => [...values.keys()], get<T>(key: string, fallback?: T) { return values.has(key) ? values.get(key) as T : fallback; }, async update(key, value) { if (value === undefined) values.delete(key); else values.set(key, value); } };
  const store = new ConsentStore(state);
  assert.equal(store.has('one'), false); await store.grant('one');
  assert.equal(store.has('one'), true); assert.equal(store.has('two'), false);
  await store.revokeAll(); assert.equal(store.has('one'), false);
});
