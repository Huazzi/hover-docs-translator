import { createHash } from 'node:crypto';
import type * as vscode from 'vscode';
const id = (endpoint: string) => `apiKey:${createHash('sha256').update(endpoint).digest('hex')}`;
export class CredentialStore {
  constructor(private secrets: vscode.SecretStorage) {}
  get(endpoint: string): Thenable<string | undefined> { return this.secrets.get(id(endpoint)); }
  async set(endpoint: string, key: string): Promise<void> { await this.secrets.store(id(endpoint), key.trim()); }
  async clearAll(): Promise<void> { for (const key of await this.secrets.keys()) if (key.startsWith('apiKey:')) await this.secrets.delete(key); }
}
