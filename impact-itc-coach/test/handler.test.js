import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/handler.js';
import { ROUND_LIMITS, stripQuestions, validateReply } from '../src/rules.js';

const ORIGIN = 'https://sherryzhanglx-design.github.io';
const baseEnv = { ANTHROPIC_API_KEY: 'test-key', CLASS_CODE: 'itc2026' };

function req(body, { code = 'itc2026', origin = ORIGIN, method = 'POST', path = '/api/coach' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (code !== null) headers['X-Class-Code'] = code;
  if (origin) headers.Origin = origin;
  return new Request(`https://coach.example${path}`, { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
}

/** A fake Messages API: returns the given replies in order and records what it was sent. */
function fakeApi(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Response) return r;
    if (typeof r === 'string') {
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: r }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(r) }] }), { status: 200 });
  };
  fn.calls = calls;
  return fn;
}

const good = (o = {}) => ({ message: '你的目标指向你自己，也有提升空间。', question: '这件事为什么对你重要？', suggestions: [], candidates: [], ready: false, ...o });

test('wrong class code returns 401 and never calls the model', async () => {
  const api = fakeApi(good());
  const res = await handle(req({ phase: 'goal' }, { code: 'nope' }), baseEnv, { fetch: api });
  assert.equal(res.status, 401);
  const b = await res.json();
  assert.equal(b.error, 'bad_code');
  assert.equal(api.calls.length, 0);
});

test('missing class code returns 401', async () => {
  const res = await handle(req({ phase: 'goal' }, { code: null }), baseEnv, { fetch: fakeApi(good()) });
  assert.equal(res.status, 401);
});

test('Worker without secrets reports not_configured', async () => {
  const res = await handle(req({ phase: 'goal' }), {}, { fetch: fakeApi(good()) });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'not_configured');
});

test('CORS: allowed origin echoed, other origins refused', async () => {
  const pre = await handle(req(null, { method: 'OPTIONS' }), baseEnv);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Class-Code/);
  const bad = await handle(req({ phase: 'goal' }, { origin: 'https://evil.example' }), baseEnv, { fetch: fakeApi(good()) });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});

test('normal reply passes through with one question', async () => {
  const api = fakeApi(good());
  const res = await handle(req({ phase: 'goal', fields: { goal: '我致力于更好地倾听' }, input: '' }), baseEnv, { fetch: api });
  const b = await res.json();
  assert.equal(b.ok, true);
  assert.equal(b.question, '这件事为什么对你重要？');
  assert.equal(b.limitReached, false);
  const sent = api.calls[0];
  assert.equal(sent.model, 'claude-sonnet-5-5');
  assert.equal(sent.output_config.format.type, 'json_schema');
  assert.equal(sent.tool_choice, undefined, 'forced tool_choice is rejected by this model, must not be sent');
  assert.match(sent.messages[0].content, /我致力于更好地倾听/);
});

test('round limit: prompt forbids questions and any question is removed', async () => {
  for (const [phase, limit] of Object.entries(ROUND_LIMITS)) {
    const api = fakeApi(good({ message: '你写得很清楚。要不要再想想？', question: '还有别的吗？' }));
    const res = await handle(req({ phase, rounds: limit, input: '嗯' }), baseEnv, { fetch: api });
    const b = await res.json();
    assert.equal(b.question, null, `${phase}: question must be null at the limit`);
    assert.doesNotMatch(b.message, /[?？]/, `${phase}: no questions hidden in message`);
    assert.equal(b.limitReached, true);
    assert.match(api.calls[0].messages[0].content, /不要再提任何问题/);
  }
});

test('round limit uses rounds from history if client under-counts', async () => {
  const api = fakeApi(good());
  const history = [
    { role: 'coach', text: 'q1', asked: true }, { role: 'student', text: 'a1' },
    { role: 'coach', text: 'q2', asked: true }, { role: 'student', text: 'a2' },
  ];
  const b = await (await handle(req({ phase: 'goal', rounds: 0, history }), baseEnv, { fetch: api })).json();
  assert.equal(b.limitReached, true);
  assert.equal(b.question, null);
});

test('worry box allows 2 rounds, hidden commitment 3', () => {
  assert.equal(ROUND_LIMITS.worry, 2);
  assert.equal(ROUND_LIMITS.commitment, 3);
  assert.equal(ROUND_LIMITS.assumption, 3);
});

test('stop words: no model call, no question, editable summary', async () => {
  for (const input of ['你又在问同样的问题', '我有点烦了', '别问了', 'skip', '够了，结束吧', 'STOP']) {
    const api = fakeApi(good());
    const b = await (await handle(req({ phase: 'commitment', fields: { commitment: '我致力于不显得无能' }, input }), baseEnv, { fetch: api })).json();
    assert.equal(api.calls.length, 0, input);
    assert.equal(b.stopped, true);
    assert.equal(b.question, null);
    assert.match(b.summary, /我致力于不显得无能/);
    assert.match(b.message, /下一步/);
  }
});

test('only one question: extra questions in message are stripped', async () => {
  const api = fakeApi(good({ message: '你提到了沉默。你是什么时候开始这样的？这让你想到什么？', question: '那一刻最不舒服的是什么？还有呢？' }));
  const b = await (await handle(req({ phase: 'worry' }), baseEnv, { fetch: api })).json();
  assert.equal(b.question, '那一刻最不舒服的是什么？');
  assert.doesNotMatch(b.message, /[?？]/);
});

test('question hidden only in message is lifted into question field', async () => {
  const api = fakeApi(good({ message: '你写了两条行为。哪一条最有感觉？', question: null }));
  const b = await (await handle(req({ phase: 'worry' }), baseEnv, { fetch: api })).json();
  assert.equal(b.question, '哪一条最有感觉？');
  assert.doesNotMatch(b.message, /[?？]/);
});

test('invalid structure: retried once, then friendly fallback', async () => {
  const api = fakeApi('not json at all', '{"message": 3}');
  const b = await (await handle(req({ phase: 'goal' }), baseEnv, { fetch: api })).json();
  assert.equal(api.calls.length, 2);
  assert.equal(b.ok, true);
  assert.equal(b.fallback, true);
  assert.equal(b.question, null);
  assert.match(b.message, /手动继续/);
});

test('invalid then valid: second attempt is used', async () => {
  const api = fakeApi('oops', good());
  const b = await (await handle(req({ phase: 'goal' }), baseEnv, { fetch: api })).json();
  assert.equal(api.calls.length, 2);
  assert.equal(b.fallback, undefined);
  assert.equal(b.question, '这件事为什么对你重要？');
});

test('refusal is treated like an invalid reply', async () => {
  const refusal = () => new Response(JSON.stringify({ stop_reason: 'refusal', content: [] }), { status: 200 });
  const api = fakeApi(refusal(), refusal());
  const b = await (await handle(req({ phase: 'goal' }), baseEnv, { fetch: api })).json();
  assert.equal(b.fallback, true);
});

test('upstream overload returns 503 with a retry message', async () => {
  const api = fakeApi(new Response('{}', { status: 529 }), new Response('{}', { status: 529 }));
  const res = await handle(req({ phase: 'goal' }), baseEnv, { fetch: api });
  assert.equal(res.status, 503);
  assert.match((await res.json()).message, /稍后再点/);
});

test('suggestions limited to the phase fields; candidates only in Big Assumption', async () => {
  const sugg = [
    { field: 'commitment', text: '我致力于不显得无能', reason: '草稿' },
    { field: 'goal', text: '不该出现', reason: 'x' },
  ];
  let b = await (await handle(req({ phase: 'commitment' }), baseEnv, { fetch: fakeApi(good({ suggestions: sugg, candidates: ['a', 'b'] })) })).json();
  assert.deepEqual(b.suggestions.map((s) => s.field), ['commitment']);
  assert.deepEqual(b.candidates, []);
  b = await (await handle(req({ phase: 'assumption' }), baseEnv, { fetch: fakeApi(good({ candidates: ['如果……那么……', '我一直相信……', '第三条'] })) })).json();
  assert.equal(b.candidates.length, 2);
});

test('long input: oldest history dropped to stay under 8000 chars', async () => {
  const big = 'x'.repeat(1400);
  const history = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'student' : 'coach', text: `${i}-${big}` }));
  const fields = { goal: big, behavior: big, worry: big };
  const api = fakeApi(good());
  await handle(req({ phase: 'worry', fields, history, input: '嗯' }), baseEnv, { fetch: api });
  const content = api.calls[0].messages[0].content;
  assert.ok(!content.includes('0-x'), 'oldest history entry dropped');
  assert.ok(content.includes('5-x'), 'newest history entry kept');
});

test('rate limiter and daily cap are enforced', async () => {
  const limited = { ...baseEnv, RATE_LIMITER: { limit: async () => ({ success: false }) } };
  let res = await handle(req({ phase: 'goal' }), limited, { fetch: fakeApi(good()) });
  assert.equal(res.status, 429);
  const capped = { ...baseEnv, DAILY: { idFromName: () => 'id', get: () => ({ hit: async () => ({ allowed: false }) }) } };
  const api = fakeApi(good());
  res = await handle(req({ phase: 'goal' }), capped, { fetch: api });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'daily_cap');
  assert.equal(api.calls.length, 0);
});

test('bad phase rejected', async () => {
  const res = await handle(req({ phase: 'childhood' }), baseEnv, { fetch: fakeApi(good()) });
  assert.equal(res.status, 400);
});

test('stripQuestions and validateReply helpers', () => {
  assert.equal(stripQuestions('好的。你怎么看？我们继续。'), '好的。我们继续。');
  const v = validateReply({ message: 'm', question: 5, suggestions: [], candidates: [], ready: true }, 'goal', { limitReached: false });
  assert.equal(v.ok, false);
});

test('after EXPIRES_AT the coach answers 410 and never calls the model', async () => {
  const env = { ...baseEnv, EXPIRES_AT: '2026-11-22T00:00:00+08:00' };
  const before = Date.parse('2026-11-21T23:59:00+08:00');
  const after = Date.parse('2026-11-22T00:00:01+08:00');
  let api = fakeApi(good());
  let res = await handle(req({ phase: 'goal' }), env, { fetch: api, now: () => before });
  assert.equal(res.status, 200);
  api = fakeApi(good());
  res = await handle(req({ phase: 'goal' }), env, { fetch: api, now: () => after });
  assert.equal(res.status, 410);
  assert.equal((await res.json()).error, 'expired');
  assert.equal(api.calls.length, 0);
});

test('ready=true drops any question', async () => {
  const b = await (await handle(req({ phase: 'assumption' }), baseEnv, { fetch: fakeApi(good({ ready: true, message: 'Good Enough to Test。要用这条吗？', question: '你愿意用这一条吗？' })) })).json();
  assert.equal(b.question, null);
  assert.doesNotMatch(b.message, /[?？]/);
});

test('reluctance phrases take the stop branch', async () => {
  for (const input of ['不太想细说，大概就是担心不好吧', '这个我不想多说']) {
    const api = fakeApi(good());
    const b = await (await handle(req({ phase: 'worry', input }), baseEnv, { fetch: api })).json();
    assert.equal(api.calls.length, 0, input);
    assert.equal(b.stopped, true);
  }
});

test('stop words do not fire on ordinary answers', async () => {
  const { hitsStopWord } = await import('../src/rules.js');
  for (const s of ['会议结束后我会再补充', '我会反复重复检查', 'it is not good enough to test yet', '我不太想被人看低', '我担心老板会觉得烦', '我想跳出舒适区', '这让我很烦躁不安'.replace('很烦躁不安','焦虑')]) {
    assert.equal(hitsStopWord(s), false, s);
  }
  for (const s of ['你又在问同样的问题', '我有点烦了', '别问了', 'skip', 'STOP', '够了吧', '先跳过', '不太想细说', "that's enough"]) {
    assert.equal(hitsStopWord(s), true, s);
  }
});

test('declined Worry Box: no questions in Hidden Commitment, and the prompt says so', async () => {
  const api = fakeApi(good({ question: '那一刻最让你不舒服的是什么？' }));
  const b = await (await handle(req({ phase: 'commitment', declined: ['worry', 'bogus'] }), baseEnv, { fetch: api })).json();
  assert.equal(b.question, null);
  assert.match(api.calls[0].messages[0].content, /不想细谈的栏目】第三栏 第一步 Worry Box。/);
});
