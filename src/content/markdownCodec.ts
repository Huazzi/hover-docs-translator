import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type { Root, Nodes, Text } from 'mdast';
import type { Segment, Translations } from '../translation/contracts.js';
import { TranslationError } from '../translation/contracts.js';

const parser = unified().use(remarkParse).use(remarkGfm);
const writer = unified().use(remarkGfm).use(remarkStringify);
export interface ProtectedDocument { segments: Segment[]; render: (result: Translations, paired: boolean) => string; partial: boolean }
function english(text: string): boolean {
  const latin = (text.match(/[a-z]/gi) || []).length;
  const chinese = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return latin >= 4 && latin > chinese;
}
function safeUrl(url: string): boolean { try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; } }
function clean(node: Nodes): void {
  if (!('children' in node)) return;
  node.children = node.children.filter(child => !['html', 'image', 'imageReference', 'definition'].includes(child.type)) as typeof node.children;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === 'link' && !safeUrl(child.url) || child.type === 'linkReference') {
      // Keep the readable label without copying executable/local link destinations.
      if ('children' in child) node.children.splice(i, 1, ...child.children as typeof node.children);
    }
  }
  for (const child of node.children) clean(child);
}
export function extractMarkdown(contents: string[], maxChars: number): ProtectedDocument | undefined {
  const unique = [...new Set(contents)]; const root: Root = { type: 'root', children: [] };
  for (const content of unique) root.children.push(...parser.parse(content).children);
  clean(root);
  const segments: Segment[] = []; const replacements: { node: Text; id: string }[] = [];
  const seen = new Map<string, string>(); let chars = 0; let partial = false; let exhausted = false;
  function eligible(node: Text): boolean {
    return english(node.value) && !/^\s*(?:\(?(?:function|method|class)\)?\s|(?:async\s+)?def\s|[\w.]+\([^\n]*\)\s*(?:->|:))/.test(node.value) && !/(?:[A-Za-z]:\\|\/(?:home|Users|tmp)\/)/.test(node.value);
  }
  function textNodes(node: Nodes): Text[] {
    if (node.type === 'code' || node.type === 'inlineCode') return [];
    if (node.type === 'text') return eligible(node) ? [node] : [];
    return 'children' in node ? node.children.flatMap(textNodes) : [];
  }
  function walk(node: Nodes): void {
    if (['paragraph', 'heading', 'tableCell'].includes(node.type)) {
      const texts = textNodes(node); if (!texts.length) return;
      const newTexts = [...new Set(texts.map(text => text.value))].filter(text => !seen.has(text));
      if (exhausted || chars + newTexts.reduce((total, text) => total + text.length, 0) > maxChars) { partial = true; exhausted = true; return; }
      for (const item of texts) {
        let id = seen.get(item.value);
        if (!id) { id = `s${segments.length}`; segments.push({ id, text: item.value }); seen.set(item.value, id); chars += item.value.length; }
        replacements.push({ node: item, id });
      }
      return;
    }
    if ('children' in node) for (const child of node.children) walk(child);
  }
  walk(root);
  if (!segments.length) return undefined;
  return { segments, partial, render(result, paired) {
    // Clone so repeat rendering never mutates the retained original tree.
    const clone = structuredClone(root); const mapping = new Map<Text, string>();
    for (const r of replacements) mapping.set(r.node, r.id);
    function apply(original: Nodes, target: Nodes): void {
      if (original.type === 'text' && target.type === 'text') {
        const id = mapping.get(original); if (id) target.value = paired ? `${original.value}\n${result[id]}` : result[id];
      }
      if ('children' in original && 'children' in target) original.children.forEach((child, i) => apply(child, target.children[i]));
    }
    apply(root, clone); return writer.stringify(clone);
  } };
}

export function validateTranslation(raw: string, segments: Segment[]): Translations {
  let value: unknown;
  try { value = JSON.parse(raw.replace(/^\s*```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')); } catch { throw new TranslationError('invalid_translation'); }
  if (!value || typeof value !== 'object' || !('segments' in value) || !Array.isArray(value.segments) || value.segments.length !== segments.length) throw new TranslationError('invalid_translation');
  const expected = new Map(segments.map(s => [s.id, s])); const result: Translations = {};
  for (const entry of value.segments) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.text !== 'string' || !entry.text.trim() || !expected.has(entry.id) || Object.hasOwn(result, entry.id)) throw new TranslationError('invalid_translation');
    if (entry.text.length > Math.max(1000, expected.get(entry.id)!.text.length * 8)) throw new TranslationError('invalid_translation');
    result[entry.id] = entry.text;
  }
  return result;
}
