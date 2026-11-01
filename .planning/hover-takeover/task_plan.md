# Feature Plan — optional experimental takeover

- Risk: high (experimental compatibility and asynchronous ownership).
- Baseline: 093dd6a; production 0.2.1.
- Scope: optional exclusive Python/JavaScript hover, compact Chinese or original-first paired, stable default and capability fallback; private 0.3.0 VSIX.
- Gate A/B: user explicitly approved the recommended optional Proposed API takeover with stable fallback on 2026-11-01, after research and real prototype. Reuse that authorization; no global runtime edits or Marketplace publication.
- Phase 1 complete: discovery and existing plan catch-up. Phase 2 complete: three independent read-only exploration passes and root file verification. Phase 3 complete: no new material decision needed.
- Phase 4 complete: three independent architecture passes, approved direction consolidated.
- Phase 5 complete: typecheck,36 unit tests, stable/proposed real-host regressions and installed VSIX smoke pass.
- Phase 6 complete: three independent full-diff reviews, all No findings,19/19 reviewable paths each.
- Gate C: no findings or review-driven changes; deliver within existing explicit implementation authorization, no new decision.
- Phase 7 complete:0.3.0 package, final isolated installed smoke, verification records and delivery.

## Acceptance

- Stable default unchanged; missing proposal/command retains stable behavior.
- Experimental paired outputs each source paragraph once followed by translation; Chinese-only retains code/signatures and untranslated fallback.
- Permission/error/timeout fallback never intentionally drops collected originals.
- Short wait followed by owned background completion; edit/close/revoke/service/mode change cancels stale work.
- Preserve endpoint-specific credentials/consent, rate limits and safe Markdown.
- Real-host tests with/without proposal and isolated installed VSIX smoke.
