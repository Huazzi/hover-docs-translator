import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const result = await build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: 'dist/extension.cjs', external: ['vscode'], sourcemap: true, metafile: true, legalComments: 'eof' });
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.startsWith('node_modules/')) continue;
  let dir = dirname(input);
  while (dir.startsWith('node_modules')) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (pkg.name && !packages.has(pkg.name)) {
        let license = '';
        for (const file of ['license', 'LICENSE', 'license.md', 'LICENSE.md', 'LICENSE-MIT']) { try { license = await readFile(join(dir, file), 'utf8'); break; } catch {} }
        packages.set(pkg.name, `## ${pkg.name} ${pkg.version} (${pkg.license || 'see upstream'})\n\n${license || 'License text: see upstream package.'}\n`);
      }
      if (pkg.name) break;
    } catch {}
    dir = dirname(dir);
  }
}
await writeFile('THIRD_PARTY_NOTICES.md', ('# Bundled dependency notices\n\n' + [...packages.values()].join('\n')).trimEnd() + '\n');
