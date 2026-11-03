import { normalizeEndpoint } from '../config/endpoint.js';
import type { ActivitySnapshot } from '../hover/hoverActivityTracker.js';
import type { ModeState } from '../hover/hoverModeController.js';
import type { ServiceSnapshot } from '../translation/translationCoordinator.js';
import type { ProbeResult } from './connectionProbe.js';
import { safeErrorCode } from './statusMessages.js';

export function inspectConfiguration(base: string, model: string): {
  endpointConfigured: boolean; modelConfigured: boolean; issue?: 'missing_endpoint' | 'invalid_endpoint' | 'missing_model'; endpoint?: string;
} {
  const modelConfigured = !!model.trim();
  if (!base.trim()) return { endpointConfigured: false, modelConfigured, issue: 'missing_endpoint' };
  try {
    const endpoint = normalizeEndpoint(base);
    return { endpointConfigured: true, modelConfigured, endpoint, issue: modelConfigured ? undefined : 'missing_model' };
  } catch { return { endpointConfigured: true, modelConfigured, issue: 'invalid_endpoint' }; }
}
export interface LocalDiagnosticSnapshot {
  extensionVersion: string; vscodeVersion: string; platform: string;
  configuration: Omit<ReturnType<typeof inspectConfiguration>, 'endpoint'>;
  keyPresent: boolean; local: boolean; trusted: boolean; enabled: boolean; documentConsent: boolean;
  document: { language: string; kind: 'none' | 'file' | 'notebook' | 'unsupported' };
  mode: Readonly<ModeState>; discovery: string; service: ServiceSnapshot;
  activity?: ActivitySnapshot; probe?: ProbeResult;
}
/** Explicit allowlist: never serialize runtime objects or arbitrary error messages. */
export function diagnosticSummary(s: LocalDiagnosticSnapshot): string {
  const language = ['python', 'javascript', 'typescript', 'java'].includes(s.document.language) ? s.document.language : 'other';
  return JSON.stringify({
    extensionVersion: s.extensionVersion, vscodeVersion: s.vscodeVersion, platform: s.platform,
    endpointConfigured: s.configuration.endpointConfigured, modelConfigured: s.configuration.modelConfigured,
    configurationIssue: s.configuration.issue, keyPresent: s.keyPresent, local: s.local, trusted: s.trusted,
    enabled: s.enabled, documentConsent: s.documentConsent, language, documentKind: s.document.kind,
    requestedMode: s.mode.requested, effectiveMode: s.mode.effective,
    modeReason: s.mode.reason ? safeErrorCode(s.mode.reason) : undefined,
    discovery: s.discovery, active: s.service.active, queued: s.service.queued,
    blockedReason: s.service.blockedReason ? safeErrorCode(s.service.blockedReason) : undefined,
    cooldownRemainingMs: s.service.cooldownRemainingMs, rateRemainingMs: s.service.rateRemainingMs,
    recent: s.activity ? {
      stage: s.activity.stage, outcome: s.activity.outcome, background: s.activity.background,
      code: s.activity.code ? safeErrorCode(s.activity.code) : undefined, cacheHit: s.activity.cacheHit,
      shared: s.activity.shared, elapsedMs: s.activity.elapsedMs, durations: s.activity.durations,
      budgetPreserved: s.activity.budgetPreserved, unsafePreserved: s.activity.unsafePreserved,
    } : undefined,
    test: s.probe ? { outcome: s.probe.outcome, code: s.probe.code ? safeErrorCode(s.probe.code) : undefined,
      elapsedMs: s.probe.elapsedMs, finishedAt: new Date(s.probe.finishedAt).toISOString() } : undefined,
  }, null, 2);
}
