# Verified findings

- src/extension.ts registers only file Python/JavaScript selectors.
- src/hover/hoverDocumentProvider.ts additionally rejects non-file documents.
- Both providers watch TabInputText, not TabInputNotebook.
- Official VS Code API and installed @types/vscode agree: setting notebookType makes selector scheme/pattern apply to parent notebook URI. Source: https://code.visualstudio.com/api/references/vscode-api#DocumentFilter
- Integration runner uses USERPROFILE, Windows Code.exe and Python/Pylance extension links; notebook tests do not exist.
- Prior plans read; session-catchup returned no recovered context.

- Two independent explorer reports confirmed scope/entry/cancellation/test findings; root reread cited provider, activation, cancellation and integration files.
- Official API and local type declarations confirm Notebook close event is not guaranteed on tab close; explicit TabInputNotebook cancellation is needed. contentChanges exposes removedCells.
- Local VS Code and Jupyter are installed; existing integration runner must narrowly adapt home/executable/extension discovery before real Notebook tests.
- Baseline typecheck and all 36 unit tests pass. No real-host Notebook evidence yet.

- Correction to initial extension-discovery assumption: built-in vscode.ipynb manifest contributes jupyter-notebook serializer; missing Jupyter links do not prevent Notebook opening. Real Pylance source behavior still requires testing.
