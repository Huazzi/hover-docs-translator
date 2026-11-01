import * as vscode from 'vscode';
import { canRebuildMarkdown, extractMarkdown } from './markdownCodec.js';
import type { Translations } from '../translation/contracts.js';

/** Keep source objects for fallback/passthrough; never transfer their trust to model text. */
export function prepareTakeover(contents: vscode.Hover['contents'], maxChars: number) {
  const indices: number[] = [];
  const fragments = contents.flatMap((content, index) => {
    if (typeof content !== 'string' && ('language' in content || content.supportThemeIcons)) return [];
    // A baseUri alone does not change plain prose or absolute URLs. Relative links are
    // rejected below, so we need not transfer source URI/trust metadata to model output.
    const value = typeof content === 'string' ? content : content.value;
    if (!canRebuildMarkdown(value)) return [];
    indices.push(index); return [value];
  });
  const doc = extractMarkdown(fragments, maxChars, true);
  if (!doc) return undefined;
  return { segments: doc.segments, render(value: Translations, paired: boolean): vscode.Hover['contents'] {
    const output = [...contents];
    doc.renderFragments(value, paired).forEach((rendered, index) => {
      if (rendered === undefined) return;
      const markdown = new vscode.MarkdownString(rendered);
      markdown.isTrusted = false; markdown.supportHtml = false; markdown.supportThemeIcons = false;
      output[indices[index]] = markdown;
    });
    return output;
  } };
}
