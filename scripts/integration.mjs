import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
const root = resolve(import.meta.dirname, '..');
const takeover = process.argv.includes('--takeover');
const userDir = join(root, takeover ? '.vscode-test/user-takeover' : '.vscode-test/user');
const settingsPath = join(userDir, 'User', 'settings.json');
await mkdir(join(userDir, 'User'), { recursive: true });
let settings = {};
try { settings = JSON.parse(await readFile(settingsPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(settingsPath, JSON.stringify({ ...settings, 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false }, null, 2));
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const extensionDir = join(root, '.test-extensions', version); await mkdir(extensionDir, { recursive: true });
const source = join(homedir(), '.vscode', 'extensions');
const wanted = new Set(['ms-python.python', 'ms-python.vscode-pylance', 'ms-python.vscode-python-envs', 'ms-python.debugpy', 'redhat.java']);
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  try {
    const pkg = JSON.parse(await readFile(join(source, entry.name, 'package.json'), 'utf8'));
    if (!wanted.has(`${pkg.publisher}.${pkg.name}`)) continue;
    try { await symlink(join(source, entry.name), join(extensionDir, entry.name), process.platform === 'win32' ? 'junction' : 'dir'); } catch (e) { if(e.code !== 'EEXIST') throw e; }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
await build({ entryPoints: [takeover ? 'test/integration/takeover.ts' : 'test/integration/index.ts'], absWorkingDir: root, bundle: true, platform: 'node', format: 'cjs', outfile: join(root, 'dist/test/index.cjs'), external: ['vscode'] });
await runTests({ vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : 'D:\\DevTools\\VSCode\\Code.exe'), extensionDevelopmentPath: root, extensionTestsPath: join(root, 'dist/test/index.cjs'), launchArgs: [join(root, 'test/fixtures'), '--user-data-dir', userDir, '--extensions-dir', extensionDir, '--remote-debugging-port=9317', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates', '--disable-telemetry', ...(takeover ? ['--enable-proposed-api', 'local-hover-docs.hover-docs-translator'] : [])] });
