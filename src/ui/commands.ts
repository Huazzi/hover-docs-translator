import * as vscode from 'vscode';
import { NAMESPACE, displayMode, hoverMode, type Settings } from '../config/settingsService.js';
import type { ModeState } from '../hover/hoverModeController.js';
import { normalizeEndpoint } from '../config/endpoint.js';
import type { CredentialStore } from '../security/credentialStore.js';
import type { ConsentStore } from '../security/consentStore.js';
import type { Diagnostics } from './diagnostics.js';
export function registerCommands(context: vscode.ExtensionContext, deps: {
  settings: () => Settings | undefined; credentials: CredentialStore; consent: ConsentStore;
  invalidate: () => void; clearCache: () => void; diagnostics: Diagnostics;
  modeState: () => Readonly<ModeState>; retryMode: () => Promise<void>;
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
    async toggleDisplay() {
      const current = displayMode();
      const takeover = deps.modeState().effective === 'experimentalTakeover';
      const options = [
        { label: '中文阅读', value: 'translationOnly', detail: takeover ? '中文正文，保留签名、示例及无法翻译的原文。' : '插件区以中文呈现；语言服务原文仍保留。' },
        { label: '中英对照', value: 'paired', detail: takeover ? '每段原文后紧接中文，不再追加整份原文。' : '结合语言服务原文阅读译文，插件不再重复附加原文。' },
      ].map(option => ({ ...option, description: option.value === current ? '当前' : undefined }));
      const choice = await vscode.window.showQuickPick(options, { title: '选择显示方式', placeHolder: '下一次悬停生效；复用有效的译文缓存' });
      if (choice && choice.value !== displayMode()) {
        await settings.update('displayMode', choice.value, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage(`已选择${choice.label}，下一次悬停生效。`);
      }
    },
    async selectHoverMode() {
      const state = deps.modeState();
      const options = [
        { label: '稳定模式', value: 'stable', detail: '原文与译文分别显示，无需启用实验 API。' },
        { label: '实验性悬停接管', value: 'experimentalTakeover', detail: '重建一份悬停文档；需要显式启用实验 API。' },
      ].map(option => ({ ...option, description: option.value === state.effective ? '当前生效' : option.value === state.requested ? '已选择，暂未生效' : undefined }));
      const choice = await vscode.window.showQuickPick(options, { title: '选择悬停模式', placeHolder: '实验模式不可用时自动回退稳定模式；再次选择可重试' });
      if (!choice) return;
      if (choice.value === hoverMode()) await deps.retryMode();
      else {
        await settings.update('hoverMode', choice.value, vscode.ConfigurationTarget.Global);
        // Wait for capability detection, even if the config notification was already delivered.
        await deps.retryMode();
      }
      if (choice.value === 'experimentalTakeover' && deps.modeState().effective !== 'experimentalTakeover') {
        void vscode.window.showInformationMessage('当前已回退稳定模式。请完全退出 VS Code 后，用 code --enable-proposed-api local-hover-docs.hover-docs-translator 启动；然后重新选择实验模式。详见扩展 README。');
      }
    },
    clearCache() { deps.clearCache(); },
    showDiagnostics() { deps.diagnostics.output.show(); },
    async menu() {
      const options = [
        ['配置接口、模型与密钥', 'configure'], ['设置 API Key', 'setApiKey'], ['确认云端发送', 'grantConsent'],
        ['暂停/恢复自动翻译', 'toggle'], [`悬停模式 · ${deps.modeState().effective === 'experimentalTakeover' ? '实验接管' : '稳定'}${deps.modeState().reason ? '（已回退）' : ''}`, 'selectHoverMode'], [`显示方式 · ${displayMode() === 'paired' ? '中英对照' : '中文阅读'}`, 'toggleDisplay'], ['清空缓存', 'clearCache'],
        ['撤回云端发送同意', 'revokeConsent'], ['清除全部 API Key', 'clearApiKeys'], ['打开诊断日志', 'showDiagnostics'],
      ].map(([label, command]) => ({ label, command }));
      const choice = await vscode.window.showQuickPick(options, { title: '悬浮翻译' });
      if (choice) await vscode.commands.executeCommand(`${NAMESPACE}.${choice.command}`);
    },
  };
  for (const [name, action] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(`${NAMESPACE}.${name}`, action));
}
