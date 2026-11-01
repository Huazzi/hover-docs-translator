# Verified findings

- Shared hoverDocumentScope currently accepts file Python/JavaScript and local Jupyter Python code cells.
- Manifest activation only Python/JavaScript; consent UI names those languages.
- Current manifest and lock root version0.3.1; installed smoke hardcodes0.3.1 and Windows code.cmd path.
- Installed Red Hat Java1.58.0 arm64; system JDK17 and8. Runtime requirements need confirmation before real Java tests.
- Previously approved Notebook changes remain uncommitted; final release must include them.
- Prior0.3.1 VSIX SHA256: 0d1244fb69670d05f1a33ba6485a0480d066af45d77af3feb2b4cfa3803d6245

- Two independent explorers confirmed shared scope, manifest activation, consent language text and release hardcodes. Root reread cited files and Java installed README/package.
- Official VS Code API docs via Context7 confirm file+typescript selector and per-language onLanguage activation. RedHat library lookup returned irrelevant results; used installed exact-version extension README/config as authoritative evidence rather than querying unrelated library.
- Red Hat Java platform build embeds JRE25; no need to replace system17/8 or install dependencies. Java LS client supports file and virtual jdt docs; proposed release limits source context to existing file model.
- Existing fenced code protection is language-agnostic. Actual Java Javadoc may contain unsupported links/HTML; capture during implementation and retain source if not safely rebuildable. Do not broaden trust or guess signature regex.
- Private release must include existing Notebook work; no Marketplace upload inferred. Installed smoke needs version synchronization and narrow macOS CLI path support for real artifact verification.

- Actual Java LS signature is fenced `String Sample.greetReader(String name)`; no codec/signature regex change needed. Captured @throws prose carries trusted command:java.open.file links, so current takeover keeps that entire unsafe fragment. A separate ordinary @param/@return Java method translates successfully; complex linked body is explicitly tested as original-preserving fallback, not counted as translated. Stable mode translates sanitized rich prose.
