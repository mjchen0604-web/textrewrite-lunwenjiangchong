import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import {
  buildTextRewriteCompare,
  buildTextRewriteGuard,
  buildTextRewriteInstructionPack
} from '../dist/handlers.js';

async function waitForHealth(port) {
  const url = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function parseMcpResponse(text) {
  const dataLine = text
    .split(/\r?\n/)
    .find((line) => line.startsWith('data: '));
  const payload = dataLine ? dataLine.slice('data: '.length) : text;
  return JSON.parse(payload);
}

async function callMcp(port, body) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  assert.equal(response.status, 200);
  return parseMcpResponse(await response.text());
}

async function withServer(port, fn) {
  const child = spawn(process.execPath, ['dist/server.js'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  try {
    await waitForHealth(port);
    return await fn();
  } catch (error) {
    error.message += `\nServer logs:\n${logs.join('')}`;
    throw error;
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

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

test('MCP tools/list exposes explicit input and output schemas for ChatGPT Apps', async () => {
  await withServer(18794, async () => {
    const listed = await callMcp(18794, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    });

    const tools = listed.result.tools;
    assert.equal(tools.length, 3);
    for (const tool of tools) {
      assert.match(tool.description, /^Use this when /);
      assert.ok(tool.inputSchema?.type === 'object', `${tool.name} missing input object schema`);
      assert.ok(tool.outputSchema?.type === 'object', `${tool.name} missing output object schema`);
      assert.ok(Array.isArray(tool.outputSchema.required), `${tool.name} output schema should declare required fields`);
      assert.ok(tool.outputSchema.required.includes('result'), `${tool.name} output schema should require result`);
      assert.ok(tool.outputSchema.required.includes('next_action'), `${tool.name} output schema should require next_action`);
      assert.deepEqual(tool.annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      });
      assert.doesNotMatch(`${tool.title}\n${tool.description}`, /\/Users\/|localhost|127\.0\.0\.1|https?:\/\//);
    }

    const guard = tools.find((tool) => tool.name === 'textrewrite_guard');
    assert.ok(guard.inputSchema.required.includes('original_text'));
    assert.ok(guard.inputSchema.required.includes('revised_text'));
    assert.equal(guard.outputSchema.properties.issues.type, 'array');
    assert.equal(guard.outputSchema.properties.metrics.type, 'object');

    const pack = tools.find((tool) => tool.name === 'textrewrite_instruction_pack');
    assert.ok(pack.inputSchema.required.includes('original_text'));
    assert.equal(pack.outputSchema.properties.guard_policy.type, 'object');
    assert.equal(pack.outputSchema.properties.instruction_pack.type, 'array');
  });
});

test('MCP tools/call returns structuredContent that validates against outputSchema', async () => {
  await withServer(18795, async () => {
    const response = await callMcp(18795, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'textrewrite_guard',
        arguments: {
          original_text: '2024年，模型A达到92.5%的准确率[1]。',
          revised_text: '2024年，模型A取得了92.5%的准确率[1]。'
        }
      }
    });

    assert.equal(response.result.structuredContent.mode, 'guard');
    assert.equal(response.result.structuredContent.tool_name, 'textrewrite_guard');
    assert.equal(typeof response.result.structuredContent.passed, 'boolean');
    assert.ok(Array.isArray(response.result.structuredContent.issues));
  });
});
