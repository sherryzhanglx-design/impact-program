# impact-itc-coach

Cloudflare Worker behind the AI coach on the ITC exercise page (`mindset-itc/`).
It forwards the student's current answers to the Anthropic Messages API and returns
one short, structured reply. It stores nothing: no conversations, no student text,
and logs carry status codes only.

## Endpoint

`POST /api/coach`

Headers: `Content-Type: application/json`, `X-Class-Code: <class code>`

```json
{
  "phase": "goal | behavior | worry | commitment | assumption | experiment",
  "fields": { "goal": "...", "behavior": "...", "worry": "...", "...": "..." },
  "history": [{ "role": "coach", "text": "...", "asked": true }, { "role": "student", "text": "..." }],
  "rounds": 1,
  "input": "what the student typed this time (optional)"
}
```

Reply (`200`):

```json
{
  "ok": true,
  "message": "at most three sentences, no questions",
  "question": "one question, or null",
  "suggestions": [{ "field": "commitment", "text": "...", "reason": "..." }],
  "candidates": ["only in the Big Assumption phase, at most 2"],
  "ready": false,
  "limitReached": false
}
```

Extra keys: `stopped: true` and `summary` when the student asked the coach to stop;
`fallback: true` when the model's answer could not be used twice in a row.

Errors carry `{ ok: false, error, message }`, where `message` is a friendly Chinese
sentence the page can show as-is: `401 bad_code`, `429 rate_limited`,
`410 expired`, `503 daily_cap | not_configured | busy | timeout`, `400 bad_request`, `403 origin_not_allowed`.

## Rules enforced in code

| Rule | Where |
|---|---|
| Question limits: goal 2, behavior 2, worry 2, commitment 3, assumption 3, experiment 2. At the limit the prompt forbids questions and any question is removed from the reply. The student can still ask for help as often as they like. | `src/rules.js` `ROUND_LIMITS`, `validateReply` |
| Stop words (烦、重复、别问了、跳过、够了、stop、skip …) answer at once without calling the model: acknowledge, no question, show the student's own text, point to "next step". | `hitsStopWord`, `stopReply` |
| At most one question per reply; questions hidden in `message` are removed or lifted into `question`. | `validateReply` |
| Reply shape validated; one retry; then a fixed friendly message. | `handler.js` |
| Suggestions only for the current phase's fields; candidates only in Big Assumption (max 2). | `validateReply` |
| Prompt kept under 8000 characters by dropping the oldest history first. | `fitToBudget` |
| 28 s total budget (the page waits 30 s). | `handler.js` |
| Class code checked against the `CLASS_CODE` secret. | `handler.js` |
| 30 requests per IP per minute (one classroom Wi-Fi shares an IP); 1500 requests per day in total (Asia/Shanghai day). | `wrangler.toml`, `src/counter.js` |
| Expiry: after `EXPIRES_AT` (default 2026-12-01 00:00 Beijing time, i.e. usable through 11/30) every request gets `410 expired` and nothing reaches the model. | `wrangler.toml`, `handler.js` |
| CORS only for `https://sherryzhanglx-design.github.io` (+ localhost:8000 for testing). | `ALLOWED_ORIGINS` |

## Model settings

`MODEL` (default `claude-sonnet-5-5`), `EFFORT` (default `low`), `MAX_TOKENS` (default `2000`)
are plain variables in `wrangler.toml`. The reply format is enforced with structured
outputs (`output_config.format`); this model rejects forced `tool_choice`.
Refusal fallback is on (`fallbacks: "default"`).

## Tests

```bash
npm install
npm test
```

The tests use a fake Messages API, so they need no key and cost nothing.

## Secrets

Two secrets, never written into any file in this repository:

- `ANTHROPIC_API_KEY` – a key made only for this project, with a monthly spend limit set in the Anthropic Console.
- `CLASS_CODE` – the class code students type on the page.

Set them in the Cloudflare dashboard (Workers & Pages → impact-itc-coach → Settings →
Variables and Secrets → Add → type "Secret"), or with `npx wrangler secret put ANTHROPIC_API_KEY`.

## Deploy

```bash
npx wrangler deploy
```

© Minds at Work for the Immunity to Change method.
