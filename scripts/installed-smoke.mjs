// Install the actual VSIX into an isolated profile. Both extensions load in production mode.
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { createVSIX } from '@vscode/vsce';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const executable = process.env.VSCODE_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : 'D:\\DevTools\\VSCode\\Code.exe');
const executableRoot = dirname(executable);
// Follow the CLI entry used by this installed version; Windows builds may use a versioned directory.
let cli;
if (process.platform === 'darwin') cli = join(executableRoot, '..', 'Resources', 'app', 'out', 'cli.js');
else {
  const batch = await readFile(join(executableRoot, 'bin', 'code.cmd'), 'utf8');
  const relative = batch.match(/"%~dp0\.\.\\([^"\r\n]+cli\.js)"/i)?.[1];
  if (!relative) throw new Error('Cannot resolve installed VS Code CLI from code.cmd');
  cli = join(executableRoot, relative);
}
async function run(args, env = {}) {
  const childEnv = { ...process.env, ...env };
  for (const [key, value] of Object.entries(env)) if (value === '') delete childEnv[key];
  const child = spawn(executable, args, { env: childEnv, windowsHide: true, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  if (code !== 0) throw new Error(`VS Code exit ${code}`);
}
for (const proposed of [false, true]) {
  const output = join(root, '.vscode-test', `installed-${manifest.version}-${proposed ? 'proposed' : 'stable'}`);
  // macOS Unix-domain sockets have a short path limit; also start from a fresh profile.
  const user = await mkdtemp(join(tmpdir(), 'hdt-')); const extensions = join(output, 'extensions');
  console.log(`Installed smoke profile: ${user}`);
  await mkdir(join(user, 'User'), { recursive: true }); await mkdir(extensions, { recursive: true });
  await writeFile(join(user, 'User', 'settings.json'), JSON.stringify({ 'hoverDocsTranslator.hoverMode': 'experimentalTakeover', 'hoverDocsTranslator.enabled': false, 'security.workspace.trust.enabled': false, 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false }));
  await run([cli, '--install-extension', join(root, `${manifest.name}-${manifest.version}.vsix`), '--force', '--extensions-dir', extensions, '--user-data-dir', user], { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' });
  const probe = join(output, 'probe-source'); await mkdir(probe, { recursive: true });
  await writeFile(join(probe, 'package.json'), JSON.stringify({ name: 'installed-hover-probe', publisher: 'local-research', version: '0.0.0', engines: manifest.engines, main: './extension.cjs', activationEvents: ['onStartupFinished'] }));
  await build({ entryPoints: [join(root, 'test/integration/installedSmoke.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: join(probe, 'extension.cjs') });
  const probePackage = join(output, 'probe.vsix');
  await createVSIX({ cwd: probe, packagePath: probePackage, dependencies: false, allowMissingRepository: true, skipLicense: true });
  await run([cli, '--install-extension', probePackage, '--force', '--extensions-dir', extensions, '--user-data-dir', user], { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' });
  const runId = String(Date.now());
  await run([join(root, 'test/fixtures'), '--new-window', '--wait', '--user-data-dir', user, '--extensions-dir', extensions, '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates', '--disable-telemetry', ...(proposed ? ['--enable-proposed-api', 'local-hover-docs.hover-docs-translator'] : [])], { ELECTRON_RUN_AS_NODE: '', HDT_INSTALLED_OUTPUT: output, HDT_INSTALLED_RUN_ID: runId, HDT_INSTALLED_VERSION: manifest.version, HDT_INSTALLED_PROPOSED: proposed ? '1' : '0' });
  const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
  if (result.runId !== runId || !result.success) throw new Error(`Installed smoke failed: ${JSON.stringify(result)}`);
  console.log('INSTALLED PASS ' + JSON.stringify(result));
}
