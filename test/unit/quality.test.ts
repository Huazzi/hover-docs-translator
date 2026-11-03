import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeMarkdown, canRebuildMarkdown } from '../../src/content/markdownCodec.js';
import { createTranslator } from '../../src/translation/chatCompletionsClient.js';
interface QualityCase {
  id: string; fragments: string[]; maxChars: number; expectedSegments: number; expectedBudgetPreserved: number;
  takeoverEligible: boolean; protected: string[]; semanticChecks: string[];
}
const cases: QualityCase[] = JSON.parse(readFileSync('test/fixtures/quality/cases.json', 'utf8'));
const config = { endpoint: 'https://example.com/chat/completions', model: 'fake', revision: 1, timeoutMs: 1000, concurrent: 2, queueSize: 8, perMinute: 120 };
test('quality corpus contains 30 distinct cases with explicit semantic checks', () => {
  assert.equal(cases.length, 30); assert.equal(new Set(cases.map(c => c.id)).size, 30);
  for (const c of cases) assert(c.semanticChecks.length, c.id);
});
for (const c of cases) test('quality structure ' + c.id + ' (fake transport; not semantic evaluation)', async () => {
  const { document, summary } = analyzeMarkdown(c.fragments, c.maxChars, true);
  assert(document, c.id); assert.equal(document.segments.length, c.expectedSegments, c.id);
  assert.equal(summary.budgetPreserved, c.expectedBudgetPreserved);
  assert.equal(c.fragments.every(canRebuildMarkdown), c.takeoverEligible);
  let calls = 0;
  const translator = createTranslator(async () => 'fixture-key', async (_url, options) => {
    calls++; const request = JSON.parse(String(options?.body));
    const input = JSON.parse(request.messages[1].content);
    const segments = input.segments.map((s: { id: string; text: string }) => ({ id: s.id, text: '中文说明：' + s.text }));
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ segments }) } }] }));
  });
  const translated = await translator(document.segments, config, new AbortController().signal);
  for (const paired of [false, true]) {
    const rendered = document.render(translated, paired);
    for (const protectedText of c.protected) assert(rendered.includes(protectedText), c.id + ': ' + protectedText);
    assert(!rendered.includes('⟦HDT_'), c.id);
    assert(!rendered.includes('](command:'), c.id);
  }
  assert.equal(calls, 1);
});
