import { handle } from './handler.js';

export { DailyCounter } from './counter.js';

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      console.log('unhandled error', e && e.name);
      return new Response(JSON.stringify({ ok: false, error: 'internal', message: 'AI 暂时不可用，可以按每栏的提示手动完成。' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  },
};
