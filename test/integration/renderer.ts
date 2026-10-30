interface Target { type: string; url: string; webSocketDebuggerUrl?: string }
/** Read the isolated test window's DOM over its local CDP port; never touches the user's window. */
export async function hoverText(): Promise<string> {
  const targets = await (await fetch('http://127.0.0.1:9317/json/list')).json() as Target[];
  const target = targets.find(t => t.type === 'page' && /workbench/.test(t.url));
  if (!target?.webSocketDebuggerUrl) throw new Error('Isolated test renderer not found');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl!);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('renderer timeout')); }, 3000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: "document.querySelector('.monaco-hover')?.textContent || ''", returnByValue: true } }));
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout); ws.close();
      if (message.error) reject(new Error('renderer evaluation failed')); else resolve(message.result?.result?.value || '');
    };
    ws.onerror = () => { clearTimeout(timeout); ws.close(); reject(new Error('renderer connection failed')); };
  });
}
