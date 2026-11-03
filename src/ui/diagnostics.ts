import * as vscode from 'vscode';
import type { ModeState } from '../hover/hoverModeController.js';
import type { ActivitySnapshot } from '../hover/hoverActivityTracker.js';
import type { ServiceSnapshot } from '../translation/translationCoordinator.js';
import { errorMessage, safeErrorCode } from './statusMessages.js';

export class Diagnostics implements vscode.Disposable {
  readonly output = vscode.window.createOutputChannel('悬浮翻译');
  private status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
  private latest?: ActivitySnapshot;
  private service?: ServiceSnapshot;
  private probing = false;
  private issue?: string;
  private message = '请配置接口、模型与密钥';
  private modeMessage = '稳定模式';
  constructor() { this.status.command = 'hoverDocsTranslator.menu'; this.refresh(); this.status.show(); }
  readiness(issue?: string, enabled = true): void {
    this.issue = issue;
    this.message = issue ? errorMessage(issue) : enabled ? '配置检查通过，可尝试翻译；连接结果请查看诊断' : '自动翻译已暂停';
    this.refresh();
  }
  update(latest: ActivitySnapshot | undefined, service: ServiceSnapshot, probing: boolean): void {
    this.latest = latest; this.service = service; this.probing = probing; this.refresh();
  }
  mode(state: ModeState): void {
    this.modeMessage = state.reason ? errorMessage(state.reason) : state.effective === 'experimentalTakeover' ? '实验性悬停接管' : '稳定模式';
    if (state.reason) this.error(state.reason);
    this.refresh();
  }
  error(code: string): void {
    this.output.appendLine(new Date().toISOString() + ' ' + safeErrorCode(code));
    this.refresh();
  }
  private refresh(): void {
    const item = this.latest; const service = this.service;
    let suffix = ''; let detail = this.message;
    if (this.issue) suffix = '需检查';
    else if (service?.blockedReason) { suffix = '需检查'; detail = errorMessage(service.blockedReason); }
    else if (service?.cooldownRemainingMs) {
      suffix = '冷却中'; detail = '请求冷却，约 ' + Math.ceil(service.cooldownRemainingMs / 1000) + ' 秒后可重试';
    } else if (this.probing) { suffix = '测试中'; detail = '正在验证固定样本；不发送项目文档'; }
    else if (item) {
      if (item.outcome === 'completed') { suffix = '已完成'; detail = '最近一次翻译已完成' + (item.background ? '；请重新悬停查看' : ''); }
      else if (item.outcome === 'failed') { suffix = '需检查'; detail = errorMessage(item.code ?? 'unknown'); }
      else if (item.outcome) detail = item.outcome === 'no_document' ? '最近请求未取得文档说明' : '最近请求没有可翻译文字或需要保留原文';
      else {
        suffix = item.background ? '后台翻译' : ({ collecting: '读取中', queued: '排队中', requesting: '翻译中', rendering: '呈现中' }[item.stage]);
        detail = '最近文档请求：' + suffix + (item.background ? '；原文已先显示，完成后请重新悬停' : '');
      }
      if (item.cacheHit) detail += '\n本次命中缓存';
      else if (item.shared) detail += '\n复用进行中的请求';
      if (item.budgetPreserved) detail += '\n字符预算保留 ' + item.budgetPreserved + ' 个文字单元';
      if (item.unsafePreserved) detail += '\n为保留交互保留 ' + item.unsafePreserved + ' 个片段';
    }
    if (service?.rateRemainingMs) detail += '\n本地频率限制剩余约 ' + Math.ceil(service.rateRemainingMs / 1000) + ' 秒';
    const busy = !!service?.active || !!service?.queued || this.probing || (!!item && !item.outcome);
    this.status.text = (busy ? '$(sync~spin)' : '$(globe)') + ' 悬浮翻译' + (suffix ? ' · ' + suffix : '');
    this.status.tooltip = this.modeMessage + '\n' + detail + '\n运行 ' + (service?.active ?? 0) + '，排队 ' + (service?.queued ?? 0);
  }
  dispose(): void { this.output.dispose(); this.status.dispose(); }
}
