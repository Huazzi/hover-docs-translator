interface Target { type: string; url: string; webSocketDebuggerUrl?: string }
export interface HoverPresentation { text: string; headings: { tag: string; text: string }[]; tables: number; quotes: number; width: number; dangerousLinks: boolean }
export async function hoverPresentation(): Promise<HoverPresentation> {
  return rendererValue<HoverPresentation>(`(() => { const h = [...document.querySelectorAll('.monaco-hover')].find(e => e.getBoundingClientRect().width > 0); return { text: h?.textContent || '', headings: [...(h?.querySelectorAll('h1,h2,h3,h4,h5,h6') || [])].map(e => ({tag:e.tagName,text:e.textContent})), tables: h?.querySelectorAll('table').length || 0, quotes: h?.querySelectorAll('blockquote').length || 0, width: h?.getBoundingClientRect().width || 0, dangerousLinks: !!h?.querySelector('a[href^="command:evil"]') }; })()`);
}
/** Read the isolated test window's DOM over its local CDP port; never touches the user's window. */
export async function hoverText(): Promise<string> {
  return rendererValue<string>("document.querySelector('.monaco-hover')?.textContent || ''");
}
async function rendererValue<T>(expression: string): Promise<T> {
  const result = await rendererCommand<{ result: { value: T }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error('renderer evaluation failed');
  return result.result.value;
}
export async function captureVisibleHover(): Promise<Uint8Array> {
  const clip = await rendererValue<{ x: number; y: number; width: number; height: number; scale: number }>(`(() => { const h = [...document.querySelectorAll('.monaco-hover')].find(e => e.getBoundingClientRect().width > 0); const r = h.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,scale:1 }; })()`);
  const image = await rendererCommand<{ data: string }>('Page.captureScreenshot', { format: 'png', clip });
  return Buffer.from(image.data, 'base64');
}
async function rendererCommand<T>(method: string, params: object): Promise<T> {
  const targets = await (await fetch('http://127.0.0.1:9317/json/list')).json() as Target[];
  const target = targets.find(t => t.type === 'page' && /workbench/.test(t.url));
  if (!target?.webSocketDebuggerUrl) throw new Error('Isolated test renderer not found');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl!);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('renderer timeout')); }, 3000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout); ws.close();
      if (message.error) reject(new Error('renderer command failed')); else resolve(message.result);
    };
    ws.onerror = () => { clearTimeout(timeout); ws.close(); reject(new Error('renderer connection failed')); };
  });
}
