// Run from the repository: node docs/experiments/hover-takeover/run.mjs
// Separate development extension, user profile and CDP port. No production activation.
import { runTests } from '@vscode/test-electron';
import { mkdir, readdir, readFile, writeFile, copyFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
const experiment = import.meta.dirname;
const root = resolve(experiment, '../../..');
const installed = process.argv.includes('--installed');
const output = join(root, '.vscode-test', installed ? 'takeover-installed' : 'takeover');
await mkdir(output, { recursive: true });
const proposed = process.argv.includes('--proposed') || installed;
let developmentPath = experiment;
if (proposed) {
  developmentPath = join(output, 'proposed-extension');
  await mkdir(developmentPath, { recursive: true });
  const manifest = JSON.parse(await readFile(join(experiment, 'package.json'), 'utf8'));
  manifest.enabledApiProposals = ['documentFiltersExclusive'];
  await writeFile(join(developmentPath, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const file of ['extension.cjs', 'experiment.cjs', 'sample.js', 'sample.py']) await copyFile(join(experiment, file), join(developmentPath, file));
}
const extensionDir = join(output, 'extensions'); await mkdir(extensionDir, { recursive: true });
const source = join(process.env.USERPROFILE, '.vscode', 'extensions');
const wanted = new Set(['ms-python.python', 'ms-python.vscode-pylance', 'ms-python.vscode-python-envs', 'ms-python.debugpy']);
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = join(source, entry.name);
  let pkg;
  try { pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')); } catch { continue; }
  if (!wanted.has(`${pkg.publisher}.${pkg.name}`)) continue;
  try { await symlink(path, join(extensionDir, entry.name), 'junction'); } catch (error) { if (error.code !== 'EEXIST') throw error; }
}
if (installed) {
  const target = join(extensionDir, 'local-research.hover-takeover-prototype');
  await mkdir(target, { recursive: true });
  const manifest = JSON.parse(await readFile(join(developmentPath, 'package.json'), 'utf8'));
  manifest.activationEvents = ['onStartupFinished'];
  await writeFile(join(target, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const file of ['experiment.cjs', 'sample.js', 'sample.py']) await copyFile(join(experiment, file), join(target, file));
  await copyFile(join(experiment, 'installed-extension.cjs'), join(target, 'extension.cjs'));
  const runId = String(Date.now());
  const child = spawn(process.env.VSCODE_EXECUTABLE || 'D:\\DevTools\\VSCode\\Code.exe', [target, '--new-window', '--wait', '--user-data-dir', join(output, 'user'), '--extensions-dir', extensionDir, '--remote-debugging-port=9419', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates', '--disable-telemetry', '--enable-proposed-api', 'local-research.hover-takeover-prototype'], { env: { ...process.env, HDT_TAKEOVER_OUTPUT: output, HDT_TAKEOVER_RUN_ID: runId }, stdio: 'inherit', windowsHide: true });
  const code = await new Promise(resolve => child.on('exit', resolve));
  if (code) throw new Error(`Isolated window exit ${code}`);
  const result = JSON.parse(await readFile(join(output, 'results.json'), 'utf8'));
  if (result.extensionMode !== 'production' || result.runId !== runId) throw new Error('Not a fresh installed production run');
  console.log('INSTALLED TAKEOVER RESULTS ' + JSON.stringify(result));
} else await runTests({
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || 'D:\\DevTools\\VSCode\\Code.exe',
  extensionDevelopmentPath: developmentPath,
  extensionTestsPath: join(developmentPath, 'experiment.cjs'),
  launchArgs: [developmentPath, '--user-data-dir', join(output, 'user'), '--extensions-dir', extensionDir, '--remote-debugging-port=9419', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates', '--disable-telemetry', ...(proposed ? ['--enable-proposed-api', 'local-research.hover-takeover-prototype'] : [])],
});
