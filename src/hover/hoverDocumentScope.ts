import * as vscode from 'vscode';
const fileLanguages = ['python', 'javascript', 'java', 'typescript'];

export function hoverSelectors(exclusive = false): vscode.DocumentSelector {
  const filters: vscode.DocumentFilter[] = [
    ...fileLanguages.map(language => ({ language, scheme: 'file' })),
    { language: 'python', notebookType: 'jupyter-notebook', scheme: 'file', pattern: '**/*.ipynb' },
  ];
  return exclusive ? filters.map(filter => ({ ...filter, exclusive: true })) : filters;
}

export interface HoverDocumentContext { notebook?: vscode.NotebookDocument }
export function resolveHoverDocument(document: vscode.TextDocument): HoverDocumentContext | undefined {
  if (document.uri.scheme === 'file' && fileLanguages.includes(document.languageId)) return {};
  if (document.uri.scheme !== 'vscode-notebook-cell' || document.languageId !== 'python') return undefined;
  const notebook = vscode.workspace.notebookDocuments.find(candidate => !candidate.isClosed
    && candidate.notebookType === 'jupyter-notebook' && candidate.uri.scheme === 'file'
    && candidate.uri.path.endsWith('.ipynb')
    && candidate.getCells().some(cell => cell.kind === vscode.NotebookCellKind.Code && cell.document === document));
  return notebook ? { notebook } : undefined;
}

export function notebookContains(context: HoverDocumentContext, document: vscode.TextDocument): boolean {
  return !context.notebook || (!context.notebook.isClosed && context.notebook.getCells().some(cell => cell.kind === vscode.NotebookCellKind.Code && cell.document === document && document.languageId === 'python'));
}
