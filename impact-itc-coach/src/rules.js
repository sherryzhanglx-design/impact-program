// Rules the Worker enforces in code (not just in the prompt).

export const PHASES = ['goal', 'behavior', 'worry', 'commitment', 'assumption', 'experiment'];

// How many coaching questions each phase may ask before the coach must stop asking
// and switch to a summary + suggestion cards. Students can still press the button
// as often as they like; after the limit the coach just stops asking.
export const ROUND_LIMITS = {
  goal: 2,
  behavior: 2,
  worry: 2,
  commitment: 3,
  assumption: 3,
  experiment: 2,
};

// Which page fields a suggestion card may write to, per phase.
export const SUGGESTION_FIELDS = {
  goal: ['goal'],
  behavior: ['behavior'],
  worry: ['worry'],
  commitment: ['commitment'],
  assumption: ['assumption'],
  experiment: ['action', 'prediction', 'evidence', 'surprise'],
};
export const ALL_SUGGESTION_FIELDS = ['goal', 'behavior', 'worry', 'commitment', 'assumption', 'action', 'prediction', 'evidence', 'surprise'];

export const PHASE_FIELDS = {
  goal: ['goal', 'goalWhy', 'importance'],
  behavior: ['behavior'],
  worry: ['worry'],
  commitment: ['commitment'],
  assumption: ['assumption', 'testAssumption'],
  experiment: ['prediction', 'action', 'evidence', 'surprise', 'reviewWhen'],
};

export const FIELD_LABELS = {
  goal: '第一栏 改变目标',
  goalWhy: '为什么对我重要',
  importance: '重要度（1–5）',
  behavior: '第二栏 行为（做 / 没做）',
  worry: '第三栏 第一步 Worry Box',
  commitment: '第三栏 第二步 隐藏承诺',
  assumption: '第四栏 大假设',
  testAssumption: '要检验的那一条大假设',
  prediction: '实验 · 旧假设的预测',
  action: '实验 · 具体低风险行动',
  evidence: '实验 · 要观察的证据',
  surprise: '实验 · 什么算反证或意外',
  reviewWhen: '实验 · 复盘时间',
  d_did: '复盘 · 做了什么',
  d_observed: '复盘 · 观察到什么',
  d_diff: '复盘 · 与预测不同之处',
  d_now: '复盘 · 现在怎么看这个假设',
};

export const PHASE_NAMES = {
  goal: '第一栏 Improvement Goal',
  behavior: '第二栏 Doing / Not Doing',
  worry: '第三栏 第一步 Worry Box',
  commitment: '第三栏 第二步 Hidden Competing Commitment',
  assumption: '第四栏 Big Assumption',
  experiment: 'Safe-to-Fail Experiment',
};

// Words that mean "stop asking me". Matched case-insensitively as substrings.
export const STOP_WORDS = [
  // annoyance
  '烦了', '好烦', '很烦', '真烦', '烦死', '有点烦', '别烦',
  // repetition
  '又在问', '同样的问题', '一样的问题', '问过了', '重复了', '一直重复', '老是重复', '总在重复',
  // stop asking / skip / end
  '别问了', '不要问了', '别再问', '不要再问', '不用再问', '不要追问', '别追问', '不想回答',
  '跳过吧', '先跳过', '我想跳过', '跳过这', '结束吧', '先结束', '到此结束', '就到这', '够了吧', '可以了别', '算了吧',
  // reluctance to disclose
  '不想细说', '不太想细说', '不想说', '不太想说', '不想多说', '不想讲', '不太想讲', '不方便说', '不愿意说', '不想谈', '不太想谈',
];
const STOP_EN = /\b(stop( asking)?|skip( it| this)?|that'?s enough|enough questions|same question|you'?re repeating)\b/i;

export function hitsStopWord(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  if (STOP_EN.test(t) && !/good enough/i.test(t)) return true;
  return STOP_WORDS.some((w) => t.includes(w));
}

export const MAX_INPUT_CHARS = 8000;
export const MAX_HISTORY = 6;
export const MAX_FIELD_CHARS = 1500;
export const MAX_SUGGESTIONS = 3;
export const MAX_CANDIDATES = 2;

/** Validate and normalise the request body. Returns {ok, value} or {ok:false, error}. */
export function parseRequest(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const phase = body.phase;
  if (!PHASES.includes(phase)) return { ok: false, error: 'unknown phase' };

  const fields = {};
  const rawFields = body.fields && typeof body.fields === 'object' ? body.fields : {};
  for (const k of Object.keys(FIELD_LABELS)) {
    const v = rawFields[k];
    if (typeof v === 'string' || typeof v === 'number') {
      const s = String(v).trim();
      if (s) fields[k] = s.slice(0, MAX_FIELD_CHARS);
    }
  }

  const history = Array.isArray(body.history)
    ? body.history
        .filter((h) => h && (h.role === 'coach' || h.role === 'student') && typeof h.text === 'string' && h.text.trim())
        .slice(-MAX_HISTORY)
        .map((h) => ({ role: h.role, text: h.text.trim().slice(0, MAX_FIELD_CHARS), asked: h.role === 'coach' && !!h.asked }))
    : [];

  let rounds = Number.isFinite(+body.rounds) ? Math.max(0, Math.floor(+body.rounds)) : 0;
  // Never trust the client to under-count: the coach turns in history that asked something count too.
  rounds = Math.max(rounds, history.filter((h) => h.asked).length);

  const input = typeof body.input === 'string' ? body.input.trim().slice(0, 2000) : '';
  // Steps where the student said "stop" / "don't want to go into it".
  const declined = Array.isArray(body.declined) ? [...new Set(body.declined.filter((p) => PHASES.includes(p)))] : [];

  return { ok: true, value: { phase, fields, history, rounds, input, declined } };
}

/** Keep the total prompt size under MAX_INPUT_CHARS by dropping the oldest history first. */
export function fitToBudget(req) {
  const size = (r) =>
    Object.values(r.fields).reduce((n, v) => n + v.length, 0) +
    r.history.reduce((n, h) => n + h.text.length, 0) +
    r.input.length;
  const out = { ...req, fields: { ...req.fields }, history: [...req.history] };
  while (size(out) > MAX_INPUT_CHARS && out.history.length) out.history.shift();
  if (size(out) > MAX_INPUT_CHARS) {
    // Still too long: shorten fields not belonging to the current phase, then everything.
    const own = new Set(PHASE_FIELDS[out.phase]);
    for (const k of Object.keys(out.fields)) if (!own.has(k)) out.fields[k] = out.fields[k].slice(0, 400);
    if (size(out) > MAX_INPUT_CHARS) for (const k of Object.keys(out.fields)) out.fields[k] = out.fields[k].slice(0, 800);
    if (size(out) > MAX_INPUT_CHARS) out.input = out.input.slice(0, 500);
  }
  return out;
}

const Q_MARK = /[?？]/;

/** Remove sentences that end in a question mark. */
export function stripQuestions(text) {
  if (!text) return '';
  const parts = String(text).split(/(?<=[。！!？?；;\n])/);
  return parts.filter((p) => !Q_MARK.test(p)).join('').trim();
}

/** Keep only the first question if the model squeezed several into one string. */
export function firstQuestion(q) {
  if (typeof q !== 'string') return null;
  const s = q.trim();
  if (!s) return null;
  const m = s.match(/^[^?？]*[?？]/);
  return (m ? m[0] : s).trim();
}

/**
 * Check the model's JSON against the contract and clean it up.
 * Returns {ok:true, value} or {ok:false, error}.
 */
export function validateReply(raw, phase, { limitReached }) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  if (typeof raw.message !== 'string' || !raw.message.trim()) return { ok: false, error: 'missing message' };
  if (!(raw.question === null || typeof raw.question === 'string')) return { ok: false, error: 'bad question' };
  if (!Array.isArray(raw.suggestions)) return { ok: false, error: 'bad suggestions' };
  if (!Array.isArray(raw.candidates)) return { ok: false, error: 'bad candidates' };
  if (typeof raw.ready !== 'boolean') return { ok: false, error: 'bad ready' };

  const allowed = SUGGESTION_FIELDS[phase];
  const suggestions = raw.suggestions
    .filter((s) => s && typeof s === 'object' && allowed.includes(s.field) && typeof s.text === 'string' && s.text.trim())
    .slice(0, MAX_SUGGESTIONS)
    .map((s) => ({ field: s.field, text: s.text.trim(), reason: typeof s.reason === 'string' ? s.reason.trim() : '' }));

  const candidates =
    phase === 'assumption'
      ? raw.candidates.filter((c) => typeof c === 'string' && c.trim()).slice(0, MAX_CANDIDATES).map((c) => c.trim())
      : [];

  let question = firstQuestion(raw.question);
  let message = raw.message.trim();

  if (limitReached) {
    question = null;
    message = stripQuestions(message) || message.replace(/[?？]/g, '。');
  } else if (raw.ready && question) {
    // The coach says this step makes sense: then it should not keep asking.
    question = null;
    message = stripQuestions(message) || message.replace(/[?？]/g, '。');
  } else if (question) {
    // At most one question per reply: the message itself must not ask anything else.
    message = stripQuestions(message) || message.replace(/[?？]/g, '。');
  } else if (Q_MARK.test(message)) {
    // Model put its question inside the message: lift the first one out.
    const parts = message.split(/(?<=[。！!？?；;\n])/);
    const qi = parts.findIndex((p) => Q_MARK.test(p));
    question = parts[qi].trim();
    message = parts.filter((p, i) => i !== qi && !Q_MARK.test(p)).join('').trim() || '我想多了解一点。';
  }

  return { ok: true, value: { message, question, suggestions, candidates, ready: raw.ready } };
}

/** The deterministic reply when the student says stop: no model call, no question. */
export function stopReply(phase, fields) {
  const own = PHASE_FIELDS[phase].filter((k) => fields[k]);
  const summary = own.map((k) => `${FIELD_LABELS[k]}：${fields[k]}`).join('\n');
  return {
    message: summary
      ? '好的，不再追问了。上面框里是你目前写下的内容，随时可以自己改；准备好了就点「这一栏可以了，下一步」。'
      : '好的，不再追问了。这一栏可以先空着或按提示自己写，准备好了就点「这一栏可以了，下一步」。',
    question: null,
    suggestions: [],
    candidates: [],
    ready: false,
    stopped: true,
    limitReached: true,
    summary,
  };
}

export const FALLBACK_MESSAGE = '教练这次没能给出完整的回应。你已填的内容都还在，可以再点一次「请教练看看」，或按这一栏的提示手动继续。';
