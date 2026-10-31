// Activated only in an isolated, installed-style experiment. No development flag.
exports.activate = context => {
  const vscode = require('vscode');
  setTimeout(async () => {
    try {
      if (context.extensionMode !== vscode.ExtensionMode.Production) throw new Error('Expected production extension mode');
      await require('./experiment.cjs').run('production');
    } catch (error) {
      await require('node:fs/promises').writeFile(require('node:path').join(process.env.HDT_TAKEOVER_OUTPUT, 'installed-failure.txt'), String(error.stack || error));
    } finally { await vscode.commands.executeCommand('workbench.action.closeWindow'); }
  }, 500);
};
