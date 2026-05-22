import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTextRewriteCompare,
  buildTextRewriteGuard,
  buildTextRewriteInstructionPack
} from '../dist/handlers.js';

test('instruction pack returns plain basic paper rewrite contract without deployment leakage', () => {
  const result = buildTextRewriteInstructionPack({
    profile: 'plain_basic_paper',
    original_text: '本研究通过复杂机制显著提升了系统性能。我认为该方法具有较高创新性。',
    field: 'education',
    protected_terms: ['系统性能'],
    target_word_ratio_min: 0.9,
    target_word_ratio_max: 1.1
  });

  assert.equal(result.mode, 'instruction_pack');
  assert.equal(result.source, 'textrewrite');
  assert.equal(result.tool_name, 'textrewrite_instruction_pack');
  assert.equal(result.profile, 'plain_basic_paper');
  assert.ok(result.instruction_pack.some((item) => /调整语序|同义/.test(item)));
  assert.ok(result.instruction_pack.some((item) => /不改变原文核心/.test(item)));
  assert.ok(result.guard_policy.protected_terms.includes('系统性能'));
  assert.ok(result.output_contract.required_sections.includes('rewritten_text'));
  assert.doesNotMatch(result.result, /\/Users\/|localhost|127\.0\.0\.1|https?:\/\//);
});

test('guard flags missing protected facts, subjective wording, and large length drift', () => {
  const result = buildTextRewriteGuard({
    original_text: '2024年，模型A在实验中达到92.5%的准确率，系统性能有所提升[1]。',
    revised_text: '我认为这个方法效果不错，准确率提高了。',
    protected_terms: ['模型A', '系统性能'],
    target_word_ratio_min: 0.9,
    target_word_ratio_max: 1.1
  });

  assert.equal(result.mode, 'guard');
  assert.equal(result.tool_name, 'textrewrite_guard');
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.code === 'missing_number'));
  assert.ok(result.issues.some((issue) => issue.code === 'missing_citation'));
  assert.ok(result.issues.some((issue) => issue.code === 'missing_protected_term'));
  assert.ok(result.issues.some((issue) => issue.code === 'subjective_phrase'));
  assert.ok(result.issues.some((issue) => issue.code === 'length_ratio_out_of_range'));
});

test('guard passes a conservative rewrite that preserves numbers citations and protected terms', () => {
  const result = buildTextRewriteGuard({
    original_text: '2024年，模型A在实验中达到92.5%的准确率，系统性能有所提升[1]。',
    revised_text: '2024年，模型A在实验里取得了92.5%的准确率，系统性能也有一定提升[1]。',
    protected_terms: ['模型A', '系统性能'],
    target_word_ratio_min: 0.8,
    target_word_ratio_max: 1.2
  });

  assert.equal(result.passed, true);
  assert.equal(result.blocking_issue_count, 0);
  assert.ok(result.metrics.length_ratio >= 0.8 && result.metrics.length_ratio <= 1.2);
});

test('compare reports length punctuation and preservation metrics', () => {
  const result = buildTextRewriteCompare({
    original_text: '这个方法显著提升了性能。它可以用于后续研究。',
    revised_text: '这个办法让性能有了提升，可以在后续研究里继续使用。'
  });

  assert.equal(result.mode, 'compare');
  assert.equal(result.tool_name, 'textrewrite_compare');
  assert.ok(result.metrics.original_length > 0);
  assert.ok(result.metrics.revised_length > 0);
  assert.ok(result.report.some((item) => /字数|长度|标点/.test(item)));
});
