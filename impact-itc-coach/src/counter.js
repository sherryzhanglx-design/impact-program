import { DurableObject } from 'cloudflare:workers';

/**
 * One global counter for the daily request cap. Keeps only today's count;
 * stores no student content.
 */
export class DailyCounter extends DurableObject {
  async hit(day, cap) {
    const cur = (await this.ctx.storage.get('day')) === day ? (await this.ctx.storage.get('count')) || 0 : 0;
    if (cur >= cap) return { allowed: false, count: cur };
    await this.ctx.storage.put({ day, count: cur + 1 });
    return { allowed: true, count: cur + 1 };
  }
}
