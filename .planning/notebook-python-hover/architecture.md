# Architecture — Gate B approved

## Scope
Local saved file-backed jupyter-notebook .ipynb Python code cells, stable and optional experimental takeover. Existing file Python/JS and permission gates remain. No kernel execution, notebook content upload, new dependencies or configuration migration.

## Options
- A (recommended): small shared hoverDocumentScope.ts for selectors and document/notebook ownership; preserve existing per-request stable and per-instance experimental cancellation structure.
- B: inline selectors/eligibility in three locations; fewer files but risks scope divergence.
- C: unified lifecycle framework; more abstraction and unrelated ownership refactoring than this feature warrants.

## Design
- Retain file Python/JS selectors; add language python, notebookType jupyter-notebook, scheme file, pattern **/*.ipynb; preserve exclusive flag in experimental mode.
- Resolve Python code-cell membership from workspace.notebookDocuments; verify actual parent type/URI, cell kind and document identity. Never decode cell URI as file URI.
- Both providers use shared eligibility. Pass cell URI and cell-local position to existing hover commands.
- Record parent notebook identity. Cancel on target cell edit/close/removal, parent notebook close and TabInputNotebook close; validate notebook open and cell membership before returning asynchronous results. Other cells and outputs/metadata alone do not cancel target requests. Experimental background tasks retain existing ownership.
- No Markdown codec, HTTP, cache or request scheduler changes.

## File map
New: src/hover/hoverDocumentScope.ts; test/integration/notebook.ts; test/fixtures/sample.ipynb.
Modify: src/extension.ts; src/hover/hoverDocumentProvider.ts; src/hover/experimentalHoverProvider.ts; test/integration/index.ts; test/integration/takeover.ts; scripts/integration.mjs; README.md; CHANGELOG.md; verification.md.
- Existing onLanguage:python retained unless real notebook-only activation evidence proves another event necessary.
- Integration runner: homedir(), platform-appropriate executable/symlink, retain VSCODE_EXECUTABLE override and Windows behavior. Built-in vscode.ipynb serializer verified locally; link Jupyter only if real-source evidence requires. Do not expand installed-smoke platform support in this feature.

## Verification
- Baseline typecheck +36 unit tests already pass.
- Real Notebook selector/eligibility positive and negative cases, file .py/.js regression.
- Controlled original hover + fake translation: stable append, takeover reconstruction, cache reuse, failed/denied translations preserve originals.
- Real Pylance docstring hover (same/cross cell) using built-in ipynb serializer, standard and recursive commands; no code execution/paid API.
- Queued/active requests cancelled by edit/removal/notebook tab close; takeover background cancellation and unrelated cell isolation.
- typecheck, unit, build, stable integration, takeover integration. Any environment gaps reported explicitly; Windows installed smoke not claimed on macOS.

## Rollback
No data migration. Revert feature files or reinstall prior VSIX. Existing credentials/settings remain compatible.

## Independent passes
Two explorers and two architects completed read-only. Root verified cited source, installed types, built-in serializer manifest and official API documentation.

## Gate B
Proposed: Option A. User explicitly approved Option A on 2026-11-01.
