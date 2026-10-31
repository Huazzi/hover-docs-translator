import type { Settings } from './settingsService.js';

export function isPresentationOnlyChange(previous: Settings | undefined, next: Settings | undefined): boolean {
  if (!previous || !next || previous.paired === next.paired) return false;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].every(key => key === 'paired' || previous[key as keyof Settings] === next[key as keyof Settings]);
}

/** Shared by the real configuration listener and lifecycle regressions. */
export function applyConfigurationChange(previous: Settings | undefined, read: () => Settings | undefined, replace: (next: Settings) => void, refresh: () => void): void {
  let next: Settings | undefined;
  try { next = read(); } catch { refresh(); return; }
  if (next && isPresentationOnlyChange(previous, next)) replace(next);
  else refresh();
}
