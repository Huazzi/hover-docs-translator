# Architecture — approved direction

User approved optional experimental takeover + stable compatibility fallback; stable remains default. Same extension ID preserves endpoint credentials/consent. No changes to global argv.json, installed editor files, or ordinary user windows.

Proposed implementation details under independent review:
- Guarded registration owner for one mode at a time; proposal registration failure/missing recursive command => stable. Runtime source failure latches fallback until mode retry/reload.
- Separate takeover provider collects originals before cloud permission checks; uses shared TranslationCoordinator. A 2500 ms translation display budget returns original then continues a bounded owned background subscriber; edit/close/dispose/config revoke cancels it. No forced hover refresh.
- Preserve signatures and legacy code. Explicit original-first render policy; conservative unchanged originals for unsupported metadata/markup. Generated Markdown never trusted.
- Keep mode/wait settings separate from service snapshot so switching presentation does not clear authentication blocks/cooldowns/cache. Mode change cancels owned hover jobs; display-only snapshots remain immutable.
- Source failures without collected text restore stable registration; current query may be empty, next hover recovers. Never promise impossible original fallback before language service responds.
- New private 0.3.0 manifest declares proposal; default stable works without enable flag. Rollback by selecting stable or installing retained0.2.1.

File map: config/settings, extension registration, new takeover source/provider/registration modules, codec/renderer policy, commands/diagnostics, manifest, tests and isolated launch/package smoke scripts, README/CHANGELOG/verification.

Alternatives: patching stable provider rejected due distinct fallback/reentrancy contracts; waiting full network timeout rejected for hover latency; cancelling at short deadline rejected because slow models would never warm cache.

Validation: content AST tests, lifecycle/ownership/rate-limit regressions, real Pylance/JS stable and proposed runs, isolated installed VSIX with and without explicit enable, three independent reviews.

## Consolidated independent architecture decision

All three read-only architecture passes complete (flow, settings/security, content/tests). Root adopts separate provider/registration owner, bounded recursive reader and conservative per-fragment rendering. Each pending hover owns one bounded translation subscription; identical segments share the existing coordinator's HTTP task. Early return detaches only Hover cancellation; document/provider ownership remains until completion. Concurrent retained subscriptions are capped. Unsupported source fragments pass through unchanged, generated fragments are untrusted. Semantic unchanged settings updates are no-ops. User's explicit approval of the researched route covers this architecture; no new material scope decision. Implementation starts.
