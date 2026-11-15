import {
  ROUND_LIMITS, parseRequest, fitToBudget, hitsStopWord, validateReply, stopReply, FALLBACK_MESSAGE,
} from './rules.js';
import { SYSTEM_PROMPT, buildUserMessage, OUTPUT_SCHEMA } from './prompt.js';

const DEFAULT_ORIGINS = ['https://sherryzhanglx-design.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'];
const TOTAL_BUDGET_MS = 28000; // the page gives up at 30 s
const ATTEMPT_TIMEOUT_MS = 22000;

function allowedOrigins(env) {
  return env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
}

function corsHeaders(origin, env) {
  const h = { Vary: 'Origin' };
  if (origin && allowedOrigins(env).includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, X-Class-Code';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(status, body, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
}

function sameString(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function shanghaiDay(now = Date.now()) {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Call the Messages API once. Returns {ok, data} or {ok:false, kind}. */
async function callModel(env, userText, fetchImpl, signal) {
  const body = {
    model: env.MODEL || 'claude-sonnet-5-5',
    max_tokens: +(env.MAX_TOKENS || 2000),
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userText }],
    output_config: { effort: env.EFFORT || 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    fallbacks: 'default',
  };
  let res;
  try {
    res = await fetchImpl(`${env.API_BASE || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    return { ok: false, kind: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  }
  if (!res.ok) {
    // Status only - never log request or response bodies (they contain student writing).
    console.log(`anthropic status ${res.status}`);
    if (res.status === 429 || res.status === 529 || res.status >= 500) return { ok: false, kind: 'busy' };
    if (res.status === 401 || res.status === 403) return { ok: false, kind: 'config' };
    return { ok: false, kind: 'bad_request' };
  }
  let data;
  try { data = await res.json(); } catch { return { ok: false, kind: 'invalid' }; }
  if (data.stop_reason === 'refusal') return { ok: false, kind: 'refusal' };
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: false, kind: 'invalid' }; }
}

/**
 * Main request handler. `deps.fetch` is injectable for tests.
 */
export async function handle(request, env, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now || Date.now;
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env);
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname !== '/api/coach') return json(404, { ok: false, error: 'not_found' }, cors);
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, cors);
  if (origin && !cors['Access-Control-Allow-Origin']) return json(403, { ok: false, error: 'origin_not_allowed' }, cors);

  // The coach is only for this class: after EXPIRES_AT nothing reaches the model.
  if (env.EXPIRES_AT && now() >= Date.parse(env.EXPIRES_AT)) {
    return json(410, { ok: false, error: 'expired', message: '本次课堂的 AI 教练已经结束。你写的内容都还在，可以继续手动修改和导出。' }, cors);
  }

  if (!env.ANTHROPIC_API_KEY || !env.CLASS_CODE) {
    return json(503, { ok: false, error: 'not_configured', message: 'AI 暂时不可用，可以按每栏的提示手动完成。' }, cors);
  }
  if (!sameString(request.headers.get('X-Class-Code'), env.CLASS_CODE)) {
    return json(401, { ok: false, error: 'bad_code', message: '课堂口令不对，请再核对一下。你仍然可以按每栏的提示手动完成。' }, cors);
  }

  // Per-IP rate limit (Cloudflare rate limiting binding).
  if (env.RATE_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return json(429, { ok: false, error: 'rate_limited', message: '请求有点快，请稍等一分钟再点。' }, cors);
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: 'bad_json' }, cors); }
  const parsed = parseRequest(body);
  if (!parsed.ok) return json(400, { ok: false, error: 'bad_request', detail: parsed.error }, cors);
  const req = fitToBudget(parsed.value);

  // Stop branch: the student wants the questions to stop. Answered without calling the model.
  if (hitsStopWord(req.input)) return json(200, { ok: true, ...stopReply(req.phase, req.fields) }, cors);

  // Daily total cap (counts only requests that will reach the model).
  if (env.DAILY) {
    const stub = env.DAILY.get(env.DAILY.idFromName('global'));
    const { allowed } = await stub.hit(shanghaiDay(now()), +(env.DAILY_LIMIT || 1500));
    if (!allowed) return json(503, { ok: false, error: 'daily_cap', message: '今天的 AI 教练次数已经用完了，可以按每栏的提示手动完成，明天再来。' }, cors);
  }

  const limit = ROUND_LIMITS[req.phase];
  // No questions once the limit is reached, after a stop in this step, or in Hidden
  // Commitment when the student declined to go into the Worry Box.
  const limitReached = req.rounds >= limit || req.declined.includes(req.phase)
    || (req.phase === 'commitment' && req.declined.includes('worry'));
  const userText = buildUserMessage(req, { limitReached, limit });

  const started = now();
  let lastKind = 'invalid';
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = TOTAL_BUDGET_MS - (now() - started);
    if (attempt > 0 && left < 8000) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(ATTEMPT_TIMEOUT_MS, left));
    const r = await callModel(env, userText, fetchImpl, ctrl.signal);
    clearTimeout(timer);
    if (r.ok) {
      const v = validateReply(r.data, req.phase, { limitReached });
      if (v.ok) return json(200, { ok: true, ...v.value, limitReached }, cors);
      lastKind = 'invalid';
    } else {
      lastKind = r.kind;
      if (r.kind === 'config' || r.kind === 'bad_request' || r.kind === 'timeout') break;
    }
  }
  console.log(`coach fallback: ${lastKind}`);
  if (lastKind === 'timeout' || lastKind === 'busy' || lastKind === 'network') {
    return json(503, { ok: false, error: lastKind, message: '教练暂时没有回应，可以稍后再点一次，或按这一栏的提示手动继续。你已填的内容不受影响。' }, cors);
  }
  return json(200, { ok: true, fallback: true, message: FALLBACK_MESSAGE, question: null, suggestions: [], candidates: [], ready: false, limitReached }, cors);
}
