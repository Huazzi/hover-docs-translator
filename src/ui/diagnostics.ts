import * as vscode from 'vscode';
import type { ModeState } from '../hover/hoverModeController.js';
const messages: Record<string, string> = {
  http_401: '密钥无效，请重新设置', http_403: '接口拒绝访问，请检查密钥', http_404: '请求地址不存在，请检查 API 根路径',
  protocol: '接口响应不兼容，请检查接口和模型', missing_key: '请设置 API Key', configuration_blocked: '请更新配置或密钥以恢复',
  http_429: '服务限流，稍后重试', source_timeout: '语言服务采集超时；等待其返回或重载窗口',
  invalid_translation: '译文结构不完整，已保留原文', timeout: '翻译超时', network: '网络请求失败',
  takeover_proposal_unavailable: '实验 API 未启用，已回退稳定模式', takeover_command_unavailable: '实验原文接口不可用，已回退稳定模式',
  takeover_source_failed: '实验原文采集失败，已回退稳定模式；请重新悬停',
};
export class Diagnostics implements vscode.Disposable {
  readonly output = vscode.window.createOutputChannel('Hover Docs Translator');
  private status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
  private activity = 0;
  private message = '配置翻译';
  private modeMessage = '稳定模式';
  constructor() { this.status.command = 'hoverDocsTranslator.menu'; this.refresh(); this.status.show(); }
  state(message: string): void { this.message = message; this.refresh(); }
  active(count: number): void { this.activity = count; this.refresh(); }
  mode(state: ModeState): void {
    this.modeMessage = state.reason ? messages[state.reason] || '已回退稳定模式' : state.effective === 'experimentalTakeover' ? '实验性悬停接管' : '稳定模式';
    if (state.reason) this.output.appendLine(`${new Date().toISOString()} ${state.reason}`);
    this.refresh();
  }
  error(code: string): void {
    // Only locally classified codes, never exception messages or server bodies.
    const safe = /^[a-z0-9_]+$/.test(code) ? code : 'unknown';
    this.output.appendLine(`${new Date().toISOString()} ${safe}`);
    this.state(messages[safe] || `翻译状态：${safe}`);
  }
  private refresh(): void { this.status.text = this.activity ? `$(sync~spin) 中文文档 ${this.activity}` : '$(globe) 中文文档'; this.status.tooltip = `${this.modeMessage}\n${this.message}`; }
  dispose(): void { this.output.dispose(); this.status.dispose(); }
}
