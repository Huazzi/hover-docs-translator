import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import type { ExperienceCommands } from '../../src/ui/experienceCommands.js';
import type { ProbeResult } from '../../src/ui/connectionProbe.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
for (const outcome of ['passed', 'failed'] as const) test('a pending ' + outcome + ' notification does not lock retesting; in-flight probes still deduplicate', async () => {
  const bundle = await build({ entryPoints: ['src/ui/experienceCommands.ts'], bundle: true, platform: 'node',
    format: 'cjs', external: ['vscode'], write: false });
  const notifications: (() => void)[] = [];
  const probes: ((result: ProbeResult) => void)[] = [];
  let calls = 0;
  const vscode = { window: { showInformationMessage: () => new Promise<void>(resolve => notifications.push(resolve)) } };
  const module = { exports: {} as { experienceCommands: (deps: unknown) => ExperienceCommands } };
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (name: string) => {
    assert.equal(name, 'vscode'); return vscode;
  } });
  const actions = module.exports.experienceCommands({ probe: {
    run: () => { calls++; return new Promise<ProbeResult>(resolve => probes.push(resolve)); },
  } });
  const result: ProbeResult = { revision: 1, outcome, code: outcome === 'failed' ? 'network' : undefined, elapsedMs: 1, finishedAt: 1 };
  const first = actions.testConnection();
  await actions.testConnection(); assert.equal(calls, 1, 'confirmation/request must remain single-flight');
  probes[0](result); await tick();
  assert.equal(notifications.length, 1, 'result notification is deliberately left open');
  const second = actions.testConnection(); await tick();
  try {
    assert.equal(calls, 2, 'completed probe must release the lock before notification dismissal');
    await actions.testConnection(); assert.equal(calls, 2, 'second in-flight probe still deduplicates');
    // Dismissing the old result must not unlock the second in-flight request.
    notifications[0](); await tick();
    await actions.testConnection(); assert.equal(calls, 2);
    probes[1](result); await tick(); assert.equal(notifications.length, 2);
  } finally {
    for (const resolve of probes) resolve(result);
    for (const dismiss of notifications) dismiss();
    await Promise.all([first, second]);
  }
});
