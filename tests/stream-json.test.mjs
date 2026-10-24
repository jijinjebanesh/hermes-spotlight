import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { HermesJsonlParser } = require('../dist-electron/main/hermes-stream-json.cjs');
const { terminal_output_text } = require('../dist-electron/tool-parser.cjs');

const line = (event) => `${JSON.stringify(event)}\n`;

test('parses split JSONL records and preserves exact assistant text', () => {
  const parser = new HermesJsonlParser();
  const output = 'First line\n\n```ts\nconst answer = 42;\n```';
  const wire = line({ type: 'text', text: 'First ' })
    + line({ type: 'text', text: 'line\n\n```ts\nconst answer = ' })
    + line({ type: 'text', text: '42;\n```' });
  const events = [...parser.push(wire.slice(0, 19)), ...parser.push(wire.slice(19)), ...parser.finish()];
  assert.equal(events.filter((event) => event.type === 'segment').map((event) => event.segment.content ?? '').join(''), output);
});

test('maps tool start and result into a complete tool lifecycle', () => {
  const parser = new HermesJsonlParser();
  const events = parser.push(
    line({ type: 'tool_use', name: 'terminal', tool_call_id: 'tool-1', input: { command: 'node -v' } })
    + line({ type: 'tool_result', name: 'terminal', tool_call_id: 'tool-1', output: 'v22.0.0', duration_ms: 20 })
  );
  const segments = events.filter((event) => event.type === 'segment').map((event) => event.segment);
  assert.deepEqual(segments.map((segment) => segment.type), ['tool_start', 'tool_complete']);
  assert.equal(segments[1].result, 'v22.0.0');
  assert.equal(segments[1].toolId, 'tool-1');
  assert.equal(segments[1].durationS, 0.02);
});

test('normalizes terminal stdout across direct, wrapped, empty, and malformed results', () => {
  assert.equal(terminal_output_text('*\r\n**\r\n'), '*\r\n**');
  assert.equal(terminal_output_text({ output: 'done\n' }), 'done');
  assert.equal(terminal_output_text('{"output":"wrapped stdout"}'), 'wrapped stdout');
  assert.equal(terminal_output_text('{"output":null}'), null);
  assert.equal(terminal_output_text(''), null);
  assert.equal(terminal_output_text('  \r\n'), null);
  assert.equal(terminal_output_text('undefined'), null);
  assert.equal(terminal_output_text('null'), null);
  assert.equal(terminal_output_text('{not json'), '{not json');
  assert.equal(terminal_output_text({ error: 'failed' }), null);
});

test('markdown code content normalization never turns a missing child into the word undefined', () => {
  const normalize = (children) => String(children ?? '').replace(/\n$/, '');
  assert.equal(normalize(undefined), '');
  assert.equal(normalize(null), '');
  assert.equal(normalize('python3 -c "print(\'ok\')"\n'), 'python3 -c "print(\'ok\')"');
});

test('renders the reported assistant answer without leaking undefined into code blocks', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: './vite.config.ts',
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const { MarkdownContent } = await vite.ssrLoadModule('/src/components/message/MarkdownContent.tsx');
    const content = [
      'Paste this directly into your terminal for the output:',
      '',
      '```bash',
      'python3 -c "for i in range(1, 6): print(\'*\' * i)"',
      '```',
      '',
      'It will print:',
      '```',
      '*',
      '**',
      '***',
      '****',
      '*****',
      '```',
    ].join('\n');
    const html = renderToStaticMarkup(React.createElement(MarkdownContent, { content }));
    assert.equal(html.includes('undefined'), false);
    assert.ok(html.includes('python3 '), 'the bash command should be visible and copyable');
    assert.equal(html.includes('Ran terminal command'), false);

    const visibleCode = renderToStaticMarkup(React.createElement(MarkdownContent, {
      content: '```python\npython3 -c "print(42)"\n```',
    }));
    assert.ok(visibleCode.includes('python3 '));
    assert.equal(visibleCode.includes('undefined'), false);
  } finally {
    await vite.close();
  }
});

test('matches a tool result to its open call by name when the returned id is stale', () => {
  const parser = new HermesJsonlParser();
  const during = parser.push(
    line({ type: 'tool_use', name: 'terminal', tool_call_id: 'actual-id', input: { command: 'echo ok' } })
    + line({ type: 'tool_result', name: 'terminal', tool_call_id: 'stale-id', output: 'ok' })
  );
  const finished = parser.finish();
  const completions = [...during, ...finished]
    .filter((event) => event.type === 'segment' && event.segment.type === 'tool_complete')
    .map((event) => event.segment);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].toolId, 'actual-id');
  assert.equal(completions[0].result, 'ok');
  assert.equal(completions[0].error, undefined);
});

test('preserves valid tool results when output is missing or non-string', () => {
  const parser = new HermesJsonlParser();
  const events = parser.push(
    line({ type: 'tool_result', name: 'terminal' })
    + line({ type: 'tool_result', name: 'terminal', output: { output: 'nested' } })
  );
  const results = events
    .filter((event) => event.type === 'segment' && event.segment.type === 'tool_complete')
    .map((event) => event.segment.result);
  assert.equal(results[0], '');
  assert.equal(results[1], '{"output":"nested"}');
});

test('renders multiple-choice, multi-select, and open-ended clarify questions', () => {
  const parser = new HermesJsonlParser();
  const events = parser.push(line({
    type: 'tool_use',
    name: 'clarify',
    input: { questions: [
      { question: 'Choose a style', choices: ['Calm', 'Bold'] },
      { question: 'Pick features', choices: ['Search', 'Voice'], multi_select: true },
      { question: 'Anything else?' },
    ] },
  }));
  const cards = events.filter((event) => event.type === 'segment').map((event) => event.segment);
  assert.deepEqual(cards.map((card) => [card.question, card.choices, card.multiSelect]), [
    ['Choose a style', ['Calm', 'Bold'], false],
    ['Pick features', ['Search', 'Voice'], true],
    ['Anything else?', undefined, false],
  ]);
});

test('captures the Hermes session id and final usage status', () => {
  const parser = new HermesJsonlParser();
  const events = parser.push(
    line({ type: 'system', subtype: 'init', session_id: 'session-123' })
    + line({ type: 'result', session_id: 'session-123', text: 'Done', tokens: { total: 91 }, duration_ms: 1050 })
  );
  assert.deepEqual(events.filter((event) => event.type === 'session').map((event) => event.sessionId), ['session-123', 'session-123']);
  assert.ok(events.some((event) => event.type === 'status' && event.tokens === 91 && event.durationS === 2));
  assert.equal(events.filter((event) => event.type === 'segment').map((event) => event.segment.content).join(''), 'Done');
});

test('captures gateway session announcements written to stderr before a clarify handoff', () => {
  const parser = new HermesJsonlParser();
  const sessionId = `local-${'a'.repeat(64)}`;
  const events = parser.push(`Session: ${sessionId}\n`);
  assert.deepEqual(events, [{ type: 'session', sessionId }]);
});

test('surfaces a structured Hermes run error', () => {
  const parser = new HermesJsonlParser();
  const events = parser.push(line({
    type: 'result',
    error: 'Run budget exceeded',
    text: '',
    tokens: { total: 0 },
    duration_ms: 120000,
  }));
  assert.ok(events.some((event) => event.type === 'error' && event.message === 'Run budget exceeded'));
  assert.ok(events.some((event) => event.type === 'status'));
});

test('does not duplicate final text after streaming deltas and closes unfinished tools', () => {
  const parser = new HermesJsonlParser();
  const during = parser.push(line({ type: 'tool_use', name: 'read_file', tool_call_id: 'tool-2', input: { path: 'README.md' } })
    + line({ type: 'text', text: 'Already streamed' })
    + line({ type: 'result', text: 'Already streamed' }));
  const finished = parser.finish();
  const all = [...during, ...finished];
  assert.equal(all.filter((event) => event.type === 'segment' && event.segment.type === 'text').length, 1);
  const completion = all.find((event) => event.type === 'segment' && event.segment.type === 'tool_complete');
  assert.equal(completion.segment.error, 'Stream ended before the tool completed');
});
