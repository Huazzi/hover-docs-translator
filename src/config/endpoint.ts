export function normalizeEndpoint(base: string): string {
  const url = new URL(base.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('接口必须为 HTTPS，且不能包含凭证、查询或片段。');
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(path)) throw new Error('请填写 API 根路径，去掉 /chat/completions。');
  url.pathname = `${path}/chat/completions`;
  return url.toString();
}
