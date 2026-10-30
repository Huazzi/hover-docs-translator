export interface Segment { id: string; text: string }
export type Translations = Record<string, string>;
export interface ServiceConfig {
  endpoint: string; model: string; revision: number; timeoutMs: number;
  concurrent: number; queueSize: number; perMinute: number;
}
export class TranslationError extends Error {
  constructor(public readonly code: string, public readonly cooldownMs = 0) { super(code); }
}
