import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = process.env.HDT_INSTALLED_OUTPUT!;
  const result: Record<string, unknown> = { runId: process.env.HDT_INSTALLED_RUN_ID, proposed: process.env.HDT_INSTALLED_PROPOSED === '1' };
  let source: vscode.Disposable | undefined;
  try {
    assert.equal(context.extensionMode, vscode.ExtensionMode.Production);
    const extension = vscode.extensions.getExtension('local-hover-docs.hover-docs-translator')!;
    assert(extension); await extension.activate(); assert.equal(extension.packageJSON.version, '0.3.0');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'sample.js'));
    await vscode.window.showTextDocument(doc); await vscode.extensions.getExtension('vscode.typescript-language-features')?.activate();
    source = vscode.languages.registerHoverProvider('javascript', { provideHover() { return new vscode.Hover('Installed ordinary sentinel.'); } });
    const text = (hovers: vscode.Hover[]) => hovers.flatMap(h => h.contents.map(c => typeof c === 'string' ? c : c.value)).join('\n');
    let hovers: vscode.Hover[] = [];
    for (let i = 0; i < 100; i++) {
      hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, new vscode.Position(3, 1));
      if (text(hovers).includes('greeting') && (result.proposed ? hovers.length === 1 : hovers.length >= 2)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(text(hovers).includes('Installed ordinary sentinel.'));
    assert(text(hovers).includes('greeting'));
    assert(result.proposed ? hovers.length === 1 : hovers.length >= 2, `unexpected count ${hovers.length}`);
    result.hoverCount = hovers.length;
    await vscode.workspace.getConfiguration('hoverDocsTranslator').update('hoverMode', 'stable', vscode.ConfigurationTarget.Global);
    await new Promise(resolve => setTimeout(resolve, 200));
    const restored = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, new vscode.Position(3, 1));
    assert(restored.length >= 2); result.restoredCount = restored.length;
    result.success = true; result.extensionPath = extension.extensionPath;
  } catch (error) { result.success = false; result.error = String(error); }
  finally {
    source?.dispose(); await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
    await vscode.commands.executeCommand('workbench.action.closeWindow');
  }
}
