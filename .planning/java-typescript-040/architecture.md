# Architecture — Java/TypeScript, release0.4.0 (Gate B approved)

## Scope
- Add file-backed java and typescript documents in stable append and optional experimental takeover; include approved uncommitted Python Notebook feature in0.4.0.
- Preserve Python/JS behavior, endpoint consent/credentials, request/cancellation/cache contracts and safe Markdown.
- Existing private/self-use VSIX distribution. No Marketplace upload, ordinary user-profile install, TSX/JSX, jdt virtual-source, untitled, remote or Java Notebook expansion. Hovering JDK/JAR APIs from local .java calls is within scope.

## Options
- A (recommended): extend shared file-language list and existing pipeline; add actual Java/TS language-service integration tests and0.4.0 artifact/installed smoke.
- B: new per-language adapters or broad virtual-document support: unnecessary abstraction/new compatibility scope without source evidence.
- C: only selectors/version, retain Windows-only install runner: fewer changes, but no actual artifact install evidence on current machine.

## Implementation blueprint
- Shared local file language list python/javascript/java/typescript generates selectors and eligibility; Python-only notebook branch retained. Existing provider ownership remains.
- Add onLanguage:java/onLanguage:typescript, update manifest description and0.4.0; update only lock root version fields, no dependency resolution changes.
- Update consent UI language description, retain existing endpoint-bound consent semantics.
- Reuse existing Hover commands, codec/rendering/HTTP/coordinator/cache. Actual Java fenced signatures and prose captured in integration. Unsupported visible HTML/navigation links retain source. Never weaken trust/URL safety.
- Conditional: only if captured bare Java signatures enter prose, add precise signature protection with regression. If normal Java takeover prose is universally passthrough due to mixed navigation markup, return for an evidence-based design decision instead of claiming unsupported behavior is supported.

## Changed-file map
- Runtime: src/hover/hoverDocumentScope.ts; src/ui/commands.ts.
- Metadata/release: package.json; package-lock.json; README.md; CHANGELOG.md; verification.md.
- New test/fixtures/sample.ts, test/fixtures/Sample.java, test/integration/languages.ts.
- Entry points: test/integration/index.ts; test/integration/takeover.ts.
- Runners/artifact: scripts/integration.mjs; scripts/installed-smoke.mjs; test/integration/installedSmoke.ts.
- Conditional captured-format fix: src/content/markdownCodec.ts and relevant unit tests only if proven necessary.

## Test design
- Actual TS built-in and installed RedHat Java LS originals, bounded initialization, fail rather than skip absent docs; standalone Java fixture avoids build-system downloads/execution. Java1.58 platform build bundles JRE25; do not point LS home at system17.
- Production provider + fake translator: both new languages, both modes, prose/parameters/returns, protected signature/inline code/example, cache/display reuse, denied/error original preservation. Check requested segments exclude protected source code.
- Scope acceptance and TSX/JSX/jdt/Java Notebook exclusions; preserve full existing Python/JS/Notebook regressions.
- typecheck, unit, build, full stable+takeover suites. No code/kernel execution or paid cloud calls.

## Private release and installed artifact
- Generate hover-docs-translator-0.4.0.vsix with existing npm package command. Read-only inspect archive manifest/version/activation/proposals/dist and exclusions; record SHA256. Preserve old0.3.1 artifact/hash.
- Installed smoke reads manifest name/version, derives new isolated version directories/package filename and passes expected version to production probe (remove031 hardcodes).
- Retain Windows CLI resolution. macOS Code executable and ../Resources/app/out/cli.js; ELECTRON_RUN_AS_NODE only for CLI installation, removed for GUI production startup. Disable extension updates in isolated settings.
- Actual installed VSIX, no development flags: Java/TS controlled sentinels prove takeover registration with/without proposal and return to stable; no cloud required. Explicitly distinguish this from real Java/TS language-service integration; disabled stable probe alone does not prove actual translation.
- Gate C disposition before final release handoff. No user-profile extension installation or Marketplace publication.

## Rollback
No configuration/secret/data migration.0.4.0 uses separate filename; reinstall retained0.3.1 to roll back runtime. Development rollback must preserve approved existing Notebook work rather than reset/revert whole workspace.

## Evidence and approval
- Two read-only explorers and two independent architects completed; root read cited core and installed-extension evidence.
- Baseline typecheck and36 unit tests pass.
- Option A explicitly approved by user on 2026-11-01.
