# Feature plan — Java/TypeScript and 0.4.0

- Risk: medium; new supported language contexts and private VSIX release, no external API/permission/concurrency contract change intended.
- Current phase: 7 - Complete.
- Baseline: HEAD fb5297f plus approved uncommitted Notebook feature; preserve all existing work.
- Release interpretation: existing private/self-use VSIX distribution, version0.4.0. Proposed API manifest remains incompatible with Marketplace.
- Gate A: only if exploration reveals unresolved material scope/security choice.
- Gate B: Option A explicitly approved by user on 2026-11-01.
- Gate C: user explicitly accepted both No findings reports and validation limits and approved final private0.4.0 release wrap-up on2026-11-01.

## Seven phases
- [x] 1. Discovery/planning
- [x] 2. Independent exploration
- [x] 3. Scope clarification
- [x] 4. Independent architecture complete (Gate B approved)
- [x] 5. Approved implementation/verification/package preparation
- [x] 6. Independent OCR reviews
- [x] 7. Gate C, final release artifact and summary

## Acceptance and constraints
- Local .java and .ts hover docs in stable and optional takeover.
- Preserve Python,JavaScript,Notebook support, credentials, consent and Markdown protection.
- Version0.4.0 manifest/lock/release docs consistent; build installable self-use VSIX.
- Real TS/Java language-service tests, current regressions, package verification and isolated installed smoke when feasible.
- No automatic user-profile extension installation, paid API, dependency upgrades or broad virtual-document/TSX/JSX/remote expansion.
