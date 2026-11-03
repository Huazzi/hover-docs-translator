const messages: Record<string, string> = {
  http_401: '密钥无效，请重新设置', http_403: '接口拒绝访问，请检查账户权限与密钥',
  http_404: '请求地址不存在，请检查 API 根路径', http_429: '服务限流，请等待冷却结束',
  protocol: '接口返回格式不兼容，请检查接口与模型', missing_key: '请设置当前接口的 API Key',
  configuration_blocked: '当前配置已停止请求，请修正接口、模型或重新设置密钥',
  invalid_configuration: 'API 地址无效，请检查配置', missing_configuration: '请配置 API 地址与模型',
  cooldown: '请求处于冷却保护，请稍后重试', rate_limited: '已达到本地每分钟请求上限，请稍后重试',
  queue_full: '翻译队列已满，请稍后重试', queue_timeout: '排队等待超时，请稍后重试',
  source_timeout: '语言服务采集超时；前次命令可能仍在执行', source_failed: '未能读取语言服务文档',
  source_busy: '前次语言服务采集尚未结束', source_capacity: '语言服务采集已达到容量限制',
  invalid_translation: '译文结构不完整，已保留原文', response_too_large: '响应超过大小限制，已保留原文',
  timeout: '翻译请求超时', network: '网络请求失败', translation_failed: '翻译未完成，已保留原文',
  cancelled: '操作已取消', stale: '配置或权限已变化，请重新发起', unsupported_environment: '仅支持受信任的本地桌面工作区',
  paused: '自动翻译已暂停', consent_required: '请先确认项目文档云端发送',
  takeover_proposal_unavailable: '实验 API 未启用，已回退稳定模式',
  takeover_command_unavailable: '实验原文接口不可用，已回退稳定模式',
  takeover_source_failed: '实验原文采集失败，已回退稳定模式；请重新悬停',
  unknown: '操作未完成，请检查本地配置',
};
export function safeErrorCode(code: string): string {
  return Object.hasOwn(messages, code) || /^http_[1-5]\d{2}$/.test(code) ? code : 'unknown';
}
export function errorMessage(code: string): string {
  const safe = safeErrorCode(code);
  return messages[safe] ?? '接口请求失败（HTTP ' + safe.slice(5) + '）';
}
