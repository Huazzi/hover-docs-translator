# Verified findings

- Research report documents VS Code 1.144.0 exclusive proposal and recursive command, including production-mode loading.
- Existing provider returns undefined on errors and omits independent signatures/legacy code; must remain separate from takeover provider.
- Stable discovery lock prevents self-recursion; recursive takeover excludes exclusive providers and needs separate concurrent ownership.
- readSettings requires endpoint/model; presentation preferences must remain readable independently.
- TranslationCoordinator already owns queue, cache, rate limiting and cancellation; background subscriber must have explicit lifetime, not detached acquire without cleanup.
- Source Markdown sanitizer is deliberately lossy for appended translations. Takeover must preserve original fragments it cannot safely reconstruct.
- Official Proposed API guidance checked again: private VSIX sharing supported with explicit enable; Marketplace publication unsuitable.
- Independent explorers: takeover_flow, takeover_settings, takeover_tests; root read provider/coordinator/codec/renderer/config/activation/commands/integration and tests.
