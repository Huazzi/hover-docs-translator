import * as vscode from 'vscode';
import { NAMESPACE, type Settings } from '../config/settingsService.js';
import { normalizeEndpoint } from '../config/endpoint.js';
import type { CredentialStore } from '../security/credentialStore.js';
import type { ConsentStore } from '../security/consentStore.js';
import type { Diagnostics } from './diagnostics.js';
export function registerCommands(context: vscode.ExtensionContext, deps: {
  settings: () => Settings | undefined; credentials: CredentialStore; consent: ConsentStore;
  invalidate: () => void; clearCache: () => void; diagnostics: Diagnostics;
}): void {
  const settings = vscode.workspace.getConfiguration(NAMESPACE);
  async function grant(): Promise<void> {
    const config = deps.settings(); if (!config) { void vscode.window.showInformationMessage('请先配置 API 根路径和模型。'); return; }
    if (vscode.env.remoteName || !vscode.workspace.isTrusted) { void vscode.window.showInformationMessage('首版仅在受信任的本地桌面工作区启用云端翻译。'); return; }
    const answer = await vscode.window.showInformationMessage(`将 Python/JavaScript 的悬停说明发送到：\n${config.endpoint}\n\n内容可能来自你的私有项目。仅发送文档说明；不发送完整文件。API 服务可能产生费用。`, { modal: true }, '同意云端发送');
    if (answer === '同意云端发送') { await deps.consent.grant(config.endpoint); deps.invalidate(); }
  }
  async function key(): Promise<void> {
    const config = deps.settings(); if (!config) { void vscode.window.showInformationMessage('请先配置 API 根路径和模型。'); return; }
    const value = await vscode.window.showInputBox({ title: '设置 API Key', prompt: '密钥仅用于当前接口，保存在 VS Code SecretStorage。', password: true, ignoreFocusOut: true, validateInput: s => s.trim() ? undefined : '请输入密钥' });
    if (value !== undefined && config.endpoint === deps.settings()?.endpoint) { await deps.credentials.set(config.endpoint, value); deps.invalidate(); }
  }
  const commands: Record<string, () => unknown> = {
    async configure() {
      const base = await vscode.window.showInputBox({ title: 'API 根路径', prompt: '填写供应商 API 根路径（需要 /v1 时请保留），程序追加 /chat/completions。', value: settings.inspect<string>('apiBaseUrl')?.globalValue || '', ignoreFocusOut: true, validateInput: value => { try { normalizeEndpoint(value); return undefined; } catch (e) { return e instanceof Error ? e.message : '地址无效'; } } });
      if (!base) return;
      const endpoint = normalizeEndpoint(base);
      const model = await vscode.window.showInputBox({ title: '翻译模型', prompt: `最终请求地址：${endpoint}`, value: settings.inspect<string>('model')?.globalValue || '', ignoreFocusOut: true, validateInput: value => value.trim() ? undefined : '请输入模型名' });
      if (!model) return;
      await settings.update('apiBaseUrl', base.trim(), vscode.ConfigurationTarget.Global);
      await settings.update('model', model.trim(), vscode.ConfigurationTarget.Global);
      await key(); await grant();
    },
    setApiKey: key,
    async clearApiKeys() { await deps.credentials.clearAll(); deps.invalidate(); },
    grantConsent: grant,
    async revokeConsent() { await deps.consent.revokeAll(); deps.invalidate(); },
    async toggle() { await settings.update('enabled', !deps.settings()?.enabled, vscode.ConfigurationTarget.Global); },
    async toggleDisplay() { await settings.update('displayMode', deps.settings()?.paired ? 'translationOnly' : 'paired', vscode.ConfigurationTarget.Global); },
    clearCache() { deps.clearCache(); },
    showDiagnostics() { deps.diagnostics.output.show(); },
    async menu() {
      const options = [
        ['配置接口、模型与密钥', 'configure'], ['设置 API Key', 'setApiKey'], ['确认云端发送', 'grantConsent'],
        ['暂停/恢复自动翻译', 'toggle'], ['切换中英对照', 'toggleDisplay'], ['清空缓存', 'clearCache'],
        ['撤回云端发送同意', 'revokeConsent'], ['清除全部 API Key', 'clearApiKeys'], ['打开诊断日志', 'showDiagnostics'],
      ].map(([label, command]) => ({ label, command }));
      const choice = await vscode.window.showQuickPick(options, { title: 'Hover Docs Translator' });
      if (choice) await vscode.commands.executeCommand(`${NAMESPACE}.${choice.command}`);
    },
  };
  for (const [name, action] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(`${NAMESPACE}.${name}`, action));
}
