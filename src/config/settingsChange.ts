import type { Settings } from './settingsService.js';

/** Invalid intermediate settings never erase the last valid service identity. */
export class ServiceIdentity {
  private last?: string;
  update(config: Pick<Settings, 'endpoint' | 'model'> | undefined): boolean {
    if (!config) return false;
    const next = JSON.stringify([config.endpoint, config.model]);
    const changed = this.last !== undefined && next !== this.last;
    this.last = next; return changed;
  }
}

export function isPresentationOnlyChange(previous: Settings | undefined, next: Settings | undefined): boolean {
  if (!previous || !next || previous.paired === next.paired) return false;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].every(key => key === 'paired' || previous[key as keyof Settings] === next[key as keyof Settings]);
}

/** Shared by the real configuration listener and lifecycle regressions. */
export function applyConfigurationChange(previous: Settings | undefined, read: () => Settings | undefined, replace: (next: Settings) => void, refresh: () => void): void {
  let next: Settings | undefined;
  try { next = read(); } catch { refresh(); return; }
  if (previous && next && [...new Set([...Object.keys(previous), ...Object.keys(next)])].every(key => previous[key as keyof Settings] === next[key as keyof Settings])) return;
  if (!previous && !next) return;
  if (next && isPresentationOnlyChange(previous, next)) replace(next);
  else refresh();
}
