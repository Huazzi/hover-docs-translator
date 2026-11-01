import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = process.env.HDT_INSTALLED_OUTPUT!;
  const proposed = process.env.HDT_INSTALLED_PROPOSED === '1';
  const result: Record<string, unknown> = { runId: process.env.HDT_INSTALLED_RUN_ID, proposed };
  const counts: Record<string, { takeover: number; restored: number }> = {};
  const sources: vscode.Disposable[] = [];
  const text = (hovers: vscode.Hover[]) => hovers.flatMap(h => h.contents.map(c => typeof c === 'string' ? c : c.value)).join('\n');
  try {
    assert.equal(context.extensionMode, vscode.ExtensionMode.Production);
    const extension = vscode.extensions.getExtension('local-hover-docs.hover-docs-translator')!; assert(extension);
    const samples = [['sample.ts', 'typescript'], ['Sample.java', 'java'], ['sample.js', 'javascript']] as const;
    // Each clean profile starts with a different new language to exercise activation.
    for (const [file, language] of proposed ? [samples[1], samples[0], samples[2]] : samples) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, file));
      await vscode.window.showTextDocument(doc);
      for (let i = 0; i < 100 && !extension.isActive; i++) await new Promise(resolve => setTimeout(resolve, 100));
      assert(extension.isActive, `${language} did not activate installed extension`);
      assert.equal(extension.packageJSON.version, process.env.HDT_INSTALLED_VERSION);
      assert(extension.packageJSON.activationEvents.includes(`onLanguage:${language}`));
      result.version = extension.packageJSON.version;
      for (const marker of ['A', 'B']) sources.push(vscode.languages.registerHoverProvider({ language, scheme: 'file' }, { provideHover() { return new vscode.Hover(`Installed ${language} ordinary sentinel ${marker}.`); } }));
      const config = vscode.workspace.getConfiguration('hoverDocsTranslator');
      await config.update('hoverMode', 'experimentalTakeover', vscode.ConfigurationTarget.Global);
      const position = new vscode.Position(0, 1);
      let hovers: vscode.Hover[] = [];
      for (let i = 0; i < 100; i++) {
        hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, position);
        if (text(hovers).includes(`Installed ${language} ordinary sentinel B.`) && (proposed ? hovers.length === 1 : hovers.length >= 2)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(text(hovers).includes(`Installed ${language} ordinary sentinel A.`));
      assert(text(hovers).includes(`Installed ${language} ordinary sentinel B.`));
      assert(proposed ? hovers.length === 1 : hovers.length >= 2, `${language} unexpected count ${hovers.length}`);
      await config.update('hoverMode', 'stable', vscode.ConfigurationTarget.Global);
      await new Promise(resolve => setTimeout(resolve, 200));
      const restored = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, position);
      assert(restored.length >= 2); counts[language] = { takeover: hovers.length, restored: restored.length };
    }
    result.counts = counts; result.success = true; result.extensionPath = extension.extensionPath;
  } catch (error) { result.success = false; result.error = String(error); }
  finally {
    sources.forEach(source => source.dispose()); await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
    await vscode.commands.executeCommand(process.platform === 'darwin' ? 'workbench.action.quit' : 'workbench.action.closeWindow');
  }
}
