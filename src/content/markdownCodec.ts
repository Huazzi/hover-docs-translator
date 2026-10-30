import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type { Root, Nodes, PhrasingContent, Definition, Paragraph, Heading, TableCell } from 'mdast';
import type { Segment, Translations } from '../translation/contracts.js';
import { TranslationError } from '../translation/contracts.js';

const parser = unified().use(remarkParse).use(remarkGfm);
const writer = unified().use(remarkGfm).use(remarkStringify);
const markerPattern = /⟦HDT_[^⟧]*⟧/g;
type Block = Paragraph | Heading | TableCell;
type Part = { kind: 'leaf' | 'open'; node: PhrasingContent } | { kind: 'close' };
interface Unit { segment: Segment; parts: Part[] }
export interface ProtectedDocument { segments: Segment[]; render: (result: Translations, paired: boolean) => string; partial: boolean }
function english(text: string): boolean {
  const latin = (text.match(/[a-z]/gi) || []).length;
  const chinese = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return latin >= 2 && latin > chinese;
}
function safeUrl(url: string): boolean { try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; } }
const referenceId = (id: string) => id.replace(/\s+/g, ' ').trim().toUpperCase();
function clean(node: Nodes, definitions: Map<string, Definition>): void {
  if (!('children' in node)) return;
  const children: Nodes[] = [];
  for (const child of node.children) {
    if (['html', 'image', 'imageReference', 'definition'].includes(child.type)) continue;
    if (child.type === 'linkReference') {
      const definition = definitions.get(referenceId(child.identifier));
      if (definition && safeUrl(definition.url)) children.push({ type: 'link', url: definition.url, title: definition.title, children: child.children });
      else children.push(...child.children);
    } else if (child.type === 'link' && !safeUrl(child.url)) children.push(...child.children);
    else children.push(child);
  }
  node.children = children as typeof node.children;
  for (const child of node.children) clean(child, definitions);
}
function sanitize(root: Root): void {
  const definitions = new Map<string, Definition>();
  function scan(node: Nodes): void {
    if (node.type === 'definition' && !definitions.has(referenceId(node.identifier))) definitions.set(referenceId(node.identifier), node);
    if ('children' in node) node.children.forEach(scan);
  }
  scan(root); clean(root, definitions);
}
function prose(node: Nodes): string {
  if (node.type === 'text') return node.value;
  return 'children' in node ? node.children.map(prose).join('') : '';
}
function signatureOnly(text: string): boolean {
  const value = text.trim();
  return /^\(?(?:function|method|class)\)?\s/.test(value)
    || /^(?:async\s+)?(?:def|class)\s/.test(value)
    || /^(?:async\s+)?[\w.$]+\s*\([^\n]*\)\s*(?:(?:->|:|=>)\s*[^\n]+)?\s*;?$/.test(value);
}
function protect(block: Block, id: string): Unit {
  const parts: Part[] = [];
  const token = (part: Part) => { const index = parts.push(part) - 1; return `⟦HDT_${index}⟧`; };
  function encode(node: PhrasingContent): string {
    if (node.type === 'text') return node.value;
    if ('children' in node) return token({ kind: 'open', node }) + node.children.map(encode).join('') + token({ kind: 'close' });
    return token({ kind: 'leaf', node });
  }
  return { segment: { id, text: block.children.map(encode).join('') }, parts };
}
function checkMarkers(source: string, translated: string): void {
  const expected = source.match(markerPattern) || [];
  const actual = translated.match(markerPattern) || [];
  if (actual.length !== expected.length || actual.some((marker, i) => marker !== expected[i])) throw new TranslationError('invalid_translation');
}
function restore(unit: Unit, translated: string): PhrasingContent[] {
  checkMarkers(unit.segment.text, translated);
  const result: PhrasingContent[] = [];
  const stack = [result]; let offset = 0;
  for (const match of translated.matchAll(markerPattern)) {
    if (match.index > offset) stack.at(-1)!.push({ type: 'text', value: translated.slice(offset, match.index) });
    const part = unit.parts[Number(match[0].slice(5, -1))];
    if (!part) throw new TranslationError('invalid_translation');
    if (part.kind === 'close') stack.pop();
    else {
      const node = structuredClone(part.node); stack.at(-1)!.push(node);
      if (part.kind === 'open' && 'children' in node) { node.children = []; stack.push(node.children); }
    }
    offset = match.index + match[0].length;
  }
  if (offset < translated.length) stack.at(-1)!.push({ type: 'text', value: translated.slice(offset) });
  if (stack.length !== 1) throw new TranslationError('invalid_translation');
  return result;
}
export function extractMarkdown(contents: string[], maxChars: number): ProtectedDocument | undefined {
  const root: Root = { type: 'root', children: [] };
  // Definitions belong to each source Markdown document, not the merged Hover.
  for (const content of new Set(contents)) { const parsed = parser.parse(content); sanitize(parsed); root.children.push(...parsed.children); }
  const units = new Map<Block, Unit>(); const segments: Segment[] = []; const seen = new Map<string, Segment>();
  let chars = 0; let partial = false; let exhausted = false;
  function walk(node: Nodes): void {
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') {
      const text = prose(node);
      if (!english(text) || signatureOnly(text) || /(?:[A-Za-z]:\\|\/(?:home|Users|tmp)\/)/.test(text) || /⟦HDT_[^⟧]*⟧/.test(text)) return;
      const unit = protect(node, `s${segments.length}`); const previous = seen.get(unit.segment.text);
      const cost = previous ? 0 : unit.segment.text.length;
      if (exhausted || chars + cost > maxChars) { partial = true; exhausted = true; return; }
      if (previous) unit.segment = previous;
      else { segments.push(unit.segment); seen.set(unit.segment.text, unit.segment); chars += cost; }
      units.set(node, unit); return;
    }
    if ('children' in node) node.children.forEach(walk);
  }
  walk(root); if (!segments.length) return undefined;
  return { segments, partial, render(result, paired) {
    const clone = structuredClone(root);
    function apply(original: Nodes, target: Nodes): void {
      if ((original.type === 'paragraph' || original.type === 'heading' || original.type === 'tableCell') && (target.type === 'paragraph' || target.type === 'heading' || target.type === 'tableCell')) {
        const unit = units.get(original);
        if (unit) { const translated = restore(unit, result[unit.segment.id]); target.children = paired ? [...target.children, { type: 'break' }, ...translated] : translated; }
        return;
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
    const source = expected.get(entry.id)!;
    if (entry.text.length > Math.max(1000, source.text.length * 8)) throw new TranslationError('invalid_translation');
    checkMarkers(source.text, entry.text); result[entry.id] = entry.text;
  }
  return result;
}
