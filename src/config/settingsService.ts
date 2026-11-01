import * as vscode from 'vscode';
import { normalizeEndpoint } from './endpoint.js';
import type { ServiceConfig } from '../translation/contracts.js';
import type { HoverMode } from '../hover/hoverModeController.js';
export const NAMESPACE = 'hoverDocsTranslator';
export interface Settings extends ServiceConfig { enabled: boolean; maxChars: number; discoveryTimeoutMs: number; paired: boolean; cacheEntries: number; cacheTtlMs: number }
/** Read only explicit user configuration and manifest defaults; ignore workspace overrides. */
export function userSetting<T>(name: string, fallback: T): T {
  const entry = vscode.workspace.getConfiguration(NAMESPACE).inspect<T>(name);
  return entry?.globalValue ?? entry?.defaultValue ?? fallback;
}
function limit(name: string, fallback: number, min: number, max: number): number {
  const value = userSetting(name, fallback); return Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;
}
export function displayMode(): 'translationOnly' | 'paired' {
  return userSetting<string>('displayMode', 'translationOnly') === 'paired' ? 'paired' : 'translationOnly';
}
export function hoverMode(): HoverMode {
  return userSetting<string>('hoverMode', 'stable') === 'experimentalTakeover' ? 'experimentalTakeover' : 'stable';
}
export function takeoverWaitMs(): number { return limit('takeoverWaitMs', 2500, 100, 10000); }
export function readSettings(revision: number): Settings | undefined {
  const base = userSetting('apiBaseUrl', ''); const model = userSetting('model', '').trim();
  if (!base || !model) return undefined;
  return {
    endpoint: normalizeEndpoint(base), model, revision, enabled: userSetting('enabled', true), paired: displayMode() === 'paired',
    maxChars: limit('maxChars', 6000, 100, 30000), discoveryTimeoutMs: limit('discoveryTimeoutMs', 5000, 100, 30000),
    timeoutMs: limit('requestTimeoutMs', 15000, 1000, 60000), concurrent: limit('maxConcurrentRequests', 2, 1, 4), queueSize: limit('maxQueueSize', 8, 0, 20), perMinute: limit('requestsPerMinute', 20, 1, 120),
    cacheEntries: limit('cacheMaxEntries', 500, 1, 2000), cacheTtlMs: limit('cacheTtlMinutes', 1440, 1, 10080) * 60000,
  };
}
