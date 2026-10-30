import { createHash } from 'node:crypto';
import type * as vscode from 'vscode';
export class ConsentStore {
  constructor(private state: vscode.Memento) {}
  private key(endpoint: string): string { return `consent:v1:${createHash('sha256').update(endpoint).digest('hex')}`; }
  has(endpoint: string): boolean { return this.state.get(this.key(endpoint), false); }
  async grant(endpoint: string): Promise<void> { await this.state.update(this.key(endpoint), true); }
  async revokeAll(): Promise<void> { for (const key of this.state.keys()) if (key.startsWith('consent:')) await this.state.update(key, undefined); }
}
