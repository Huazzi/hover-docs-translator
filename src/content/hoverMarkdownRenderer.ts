import { unified } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type { Root, Nodes, Paragraph, PhrasingContent, Heading } from 'mdast';

const writer = unified().use(remarkGfm).use(remarkStringify);
export interface Presentation {
  translated: ReadonlyMap<Nodes, PhrasingContent[]>;
  budgetSkipped: ReadonlySet<Nodes>;
  omitted: ReadonlySet<Nodes>;
  headingDepths: ReadonlyMap<Nodes, Heading['depth']>;
}
const paragraph = (text: string): Paragraph => ({ type: 'paragraph', children: [{ type: 'text', value: text }] });
const budgetLabel = '原文保留（超出本次翻译预算）';
function sameText(a: PhrasingContent[], b: PhrasingContent[]): boolean {
  const serialize = (children: PhrasingContent[]) => writer.stringify({ type: 'root', children: [{ type: 'paragraph', children }] });
  return serialize(a) === serialize(b);
}
/** Only sanitized source nodes and restored text nodes may reach this renderer. */
export function renderMarkdown(root: Root, state: Presentation, paired: boolean, originalFirst = false): string {
  // Append mode already has the language service's original. Only takeover needs
  // to reconstruct bilingual content; never add another labelled original block.
  const includeOriginal = paired && originalFirst;
  function contains(node: Nodes, matches: (node: Nodes) => boolean): boolean {
    return matches(node) || ('children' in node && node.children.some(child => contains(child, matches)));
  }
  function project(node: Nodes, withinTable = false): Nodes[] {
    if (state.omitted.has(node)) return [];
    const clone = { ...node };
    const translated = state.translated.get(node);
    if ((clone.type === 'paragraph' || clone.type === 'heading' || clone.type === 'tableCell') && translated) clone.children = structuredClone(translated);
    else if ('children' in node && 'children' in clone) clone.children = node.children.flatMap(child => project(child, withinTable || node.type === 'table')) as typeof clone.children;

    if (clone.type === 'heading' && node.type === 'heading') {
      clone.depth = state.headingDepths.get(node) ?? node.depth;
      if (includeOriginal && translated && !sameText(translated, node.children)) clone.children = [...structuredClone(node.children), { type: 'text', value: ' · ' }, ...clone.children];
    }
    if (withinTable) return [clone];
    if (node.type === 'table') {
      const result: Nodes[] = [];
      if (contains(node, child => state.budgetSkipped.has(child))) result.push(paragraph('此表部分内容超出翻译预算，未译内容保留原文。'));
      result.push(clone);
      if (includeOriginal && contains(node, child => {
        const value = state.translated.get(child);
        return child.type === 'tableCell' && !!value && !sameText(value, child.children);
      })) {
        result.splice(result.length - 1, 0, structuredClone(node));
      }
      return result;
    }
    if (state.budgetSkipped.has(node)) return [paragraph(budgetLabel), clone];
    if (node.type === 'paragraph' && includeOriginal && translated && !sameText(translated, node.children)) {
      return [structuredClone(node), clone];
    }
    return [clone];
  }
  return writer.stringify(project(root)[0] as Root);
}

export function hoverMarkdown(body: string, partial: boolean): string {
  return `${partial ? '部分内容未翻译，已在对应位置标注。\n\n' : ''}${body}`;
}
