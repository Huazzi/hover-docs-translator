import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdir, readdir, readFile, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const extensionDir = join(root, '.test-extensions'); await mkdir(extensionDir, { recursive: true });
const source = join(process.env.USERPROFILE, '.vscode', 'extensions');
const wanted = new Set(['ms-python.python', 'ms-python.vscode-pylance', 'ms-python.vscode-python-envs', 'ms-python.debugpy']);
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  try {
    const pkg = JSON.parse(await readFile(join(source, entry.name, 'package.json'), 'utf8'));
    if (!wanted.has(`${pkg.publisher}.${pkg.name}`)) continue;
    try { await symlink(join(source, entry.name), join(extensionDir, entry.name), 'junction'); } catch (e) { if(e.code !== 'EEXIST') throw e; }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
await build({ entryPoints: ['test/integration/index.ts'], absWorkingDir: root, bundle: true, platform: 'node', format: 'cjs', outfile: join(root, 'dist/test/index.cjs'), external: ['vscode'] });
await runTests({ vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || 'D:\\DevTools\\VSCode\\Code.exe', extensionDevelopmentPath: root, extensionTestsPath: join(root, 'dist/test/index.cjs'), launchArgs: [join(root, 'test/fixtures'), '--user-data-dir', join(root, '.vscode-test/user'), '--extensions-dir', extensionDir, '--remote-debugging-port=9317', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates', '--disable-telemetry'] });
