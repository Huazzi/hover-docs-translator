import * as vscode from 'vscode';
import { canRebuildMarkdown, analyzeMarkdown } from './markdownCodec.js';
import type { Translations } from '../translation/contracts.js';

/** Keep source objects for fallback/passthrough; never transfer their trust to model text. */
export function prepareTakeover(contents: vscode.Hover['contents'], maxChars: number) {
  return analyzeTakeover(contents, maxChars).document;
}
export function analyzeTakeover(contents: vscode.Hover['contents'], maxChars: number) {
  let unsafePreserved = 0;
  const indices: number[] = [];
  const fragments = contents.flatMap((content, index) => {
    if (typeof content !== 'string' && 'language' in content) return [];
    if (typeof content !== 'string' && content.supportThemeIcons) { unsafePreserved++; return []; }
    // A baseUri alone does not change plain prose or absolute URLs. Relative links are
    // rejected below, so we need not transfer source URI/trust metadata to model output.
    const value = typeof content === 'string' ? content : content.value;
    if (!canRebuildMarkdown(value)) { unsafePreserved++; return []; }
    indices.push(index); return [value];
  });
  const analysis = analyzeMarkdown(fragments, maxChars, true);
  const summary = { ...analysis.summary, unsafePreserved };
  const doc = analysis.document;
  if (!doc) return { summary, document: undefined };
  return { summary, document: { segments: doc.segments, render(value: Translations, paired: boolean): vscode.Hover['contents'] {
    const output = [...contents];
    doc.renderFragments(value, paired).forEach((rendered, index) => {
      if (rendered === undefined) return;
      const markdown = new vscode.MarkdownString(rendered);
      markdown.isTrusted = false; markdown.supportHtml = false; markdown.supportThemeIcons = false;
      output[indices[index]] = markdown;
    });
    return output;
  } } };
}
