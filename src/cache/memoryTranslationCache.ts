import type { Translations } from '../translation/contracts.js';
export class MemoryTranslationCache {
  private entries = new Map<string, { value: Translations; expires: number; bytes: number }>();
  private bytes = 0;
  constructor(private maxEntries = 500, private ttlMs = 86400000, private maxBytes = 10 * 1024 * 1024) {}
  get(key: string): Translations | undefined {
    const entry = this.entries.get(key); if (!entry) return undefined;
    this.remove(key); if (entry.expires <= Date.now()) return undefined;
    this.entries.set(key, entry); this.bytes += entry.bytes; return { ...entry.value };
  }
  set(key: string, value: Translations): void {
    this.remove(key); const bytes = Buffer.byteLength(JSON.stringify(value)) + Buffer.byteLength(key);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value: { ...value }, expires: Date.now() + this.ttlMs, bytes }); this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.remove(this.entries.keys().next().value!);
  }
  private remove(key: string): void { const e = this.entries.get(key); if (e) this.bytes -= e.bytes; this.entries.delete(key); }
  clear(): void { this.entries.clear(); this.bytes = 0; }
}
