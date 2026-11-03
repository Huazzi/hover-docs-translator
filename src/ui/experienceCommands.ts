import * as vscode from 'vscode';
import type { Settings } from '../config/settingsService.js';
import type { HoverActivityTracker } from '../hover/hoverActivityTracker.js';
import { resolveHoverDocument } from '../hover/hoverDocumentScope.js';
import { diagnosticSummary, type LocalDiagnosticSnapshot } from './configurationDiagnostics.js';
import type { ConnectionProbe, ProbeResult } from './connectionProbe.js';
import { errorMessage } from './statusMessages.js';

export type ExperienceCommands = Record<'showCurrentHover' | 'checkConfiguration' | 'testConnection' | 'copyDiagnosticSummary', () => Promise<void>>;
export function experienceCommands(deps: {
  settings: () => Settings | undefined; localSnapshot: () => Promise<LocalDiagnosticSnapshot>;
  activities: HoverActivityTracker; probe: ConnectionProbe; modeGeneration: () => number;
}): ExperienceCommands {
  const say = async (text: string) => { await vscode.window.showInformationMessage(text); };
  let testing = false;
  const commands: ExperienceCommands = {
    async showCurrentHover() {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !resolveHoverDocument(editor.document)) { await say('请将光标放在受支持的本地文档或 Python Notebook 代码单元格中。'); return; }
      const config = deps.settings(); const position = editor.selection.active;
      const version = editor.document.version; const generation = deps.modeGeneration();
      const snapshot = await deps.localSnapshot();
      if (editor !== vscode.window.activeTextEditor || editor.document.version !== version || !editor.selection.active.isEqual(position)
        || config?.revision !== deps.settings()?.revision || generation !== deps.modeGeneration()) return;
      const issue = !snapshot.local || !snapshot.trusted ? 'unsupported_environment' : !config ? 'missing_configuration'
        : !config.enabled ? 'paused' : !snapshot.keyPresent ? 'missing_key' : !snapshot.documentConsent ? 'consent_required'
          : snapshot.service.blockedReason ? 'configuration_blocked' : undefined;
      if (issue) { await say(errorMessage(issue)); return; }
      const pending = deps.activities.pendingAt({ uri: editor.document.uri.toString(), version, line: position.line,
        character: position.character, revision: config!.revision, modeGeneration: generation });
      if (pending) { await say('光标处文档请求仍在处理；可从“悬浮翻译”状态栏查看进度，完成后重新悬停。'); return; }
      await vscode.commands.executeCommand('editor.action.showHover', { focus: 'noAutoFocus' });
    },
    async checkConfiguration() {
      const s = await deps.localSnapshot();
      const rows: { label: string; detail?: string; command?: string }[] = [
        { label: '环境 · ' + (s.local && s.trusted ? '受信任的本地工作区' : '当前环境不支持') },
        { label: 'API 地址 · ' + (!s.configuration.endpointConfigured ? '未配置' : s.configuration.issue === 'invalid_endpoint' ? '无效' : '格式有效'),
          detail: '只采用用户级设置；格式有效不等于连接成功', command: 'configure' },
        { label: '模型 · ' + (s.configuration.modelConfigured ? '已配置' : '未配置'), command: 'configure' },
        { label: 'API Key · ' + (s.keyPresent ? '存在（尚不代表有效）' : '未设置'), command: 'setApiKey' },
        { label: '项目文档云端发送 · ' + (s.documentConsent ? '已同意' : '未同意'), command: 'grantConsent' },
        { label: '自动翻译 · ' + (s.enabled ? '启用' : '暂停'), command: 'toggle' },
        { label: '悬停模式 · ' + (s.mode.effective === 'stable' ? '稳定' : '实验接管'),
          detail: s.mode.reason ? errorMessage(s.mode.reason) : '已选择：' + s.mode.requested, command: 'selectHoverMode' },
        { label: '当前文档 · ' + ({ none: '无活动编辑器', file: '支持的文件', notebook: '支持的 Notebook 单元格', unsupported: '不在支持范围' }[s.document.kind]) },
        { label: '原文采集 · ' + ({ idle: '空闲', collecting: '正在采集', draining: '前次源命令尚未结束' }[s.discovery] ?? '尚未观察'),
          detail: s.activity?.outcome === 'no_document' ? '最近未取得文档；不能据此判断语言服务是否安装' : undefined },
        { label: '最近文档请求 · ' + (s.activity ? s.activity.outcome ?? s.activity.stage : '尚未观察'),
          detail: s.activity?.code ? errorMessage(s.activity.code) : s.activity ? '预算保留 ' + (s.activity.budgetPreserved ?? 0) + '，交互保留 ' + (s.activity.unsafePreserved ?? 0) : undefined },
        { label: '服务保护 · ' + (s.service.blockedReason ? errorMessage(s.service.blockedReason) : '未阻断'),
          detail: '运行 ' + s.service.active + '，排队 ' + s.service.queued + '，冷却 ' + Math.ceil(s.service.cooldownRemainingMs / 1000) + ' 秒；频率等待 ' + Math.ceil((s.service.rateRemainingMs ?? 0) / 1000) + ' 秒' },
        { label: '最近连接测试 · ' + (!s.probe ? '当前配置尚未测试' : s.probe.outcome === 'passed' ? '协议验证通过' : s.probe.outcome === 'cancelled' ? '已取消' : errorMessage(s.probe.code ?? 'unknown')),
          detail: s.probe ? new Date(s.probe.finishedAt).toLocaleString() + '，' + s.probe.elapsedMs + ' ms' : undefined },
        { label: '测试当前接口连接…', detail: '下一步确认后仅发送固定样本，可能计费', command: 'testConnection' },
        { label: '预览并复制脱敏诊断摘要', command: 'copyDiagnosticSummary' },
      ];
      const selected = await vscode.window.showQuickPick(rows, { title: '悬浮翻译：本地检查（未发送网络请求）' });
      if (selected?.command) await vscode.commands.executeCommand('hoverDocsTranslator.' + selected.command);
    },
    async testConnection() {
      if (testing) return;
      testing = true;
      let result: ProbeResult;
      try { result = await deps.probe.run(); } finally { testing = false; }
      // Notification dismissal is independent of the next explicitly requested test.
      if (result.outcome === 'passed') void say('测试通过：接口响应及 JSON / 占位符格式有效（' + result.elapsedMs + ' ms）。这不代表所有文档的译文质量。').catch(() => {});
      else if (result.outcome === 'failed') void say(errorMessage(result.code ?? 'unknown')).catch(() => {});
    },
    async copyDiagnosticSummary() {
      const text = diagnosticSummary(await deps.localSnapshot());
      const selected = await vscode.window.showInformationMessage('预览脱敏诊断摘要', { modal: true, detail: text }, '复制以上摘要');
      if (selected === '复制以上摘要') await vscode.env.clipboard.writeText(text);
    },
  };
  return Object.fromEntries(Object.entries(commands).map(([name, action]) => [name, async () => {
    try { await action(); } catch { await say('本地状态已变化或暂时无法读取，请重新检查配置。'); }
  }])) as ExperienceCommands;
}
