import type { WorkGoalNotice } from './shared.js';

/** Keep shown notices pending until durable; a locked database gets one attempt per minute. */
export class GoalReceiptQueue {
  private readonly pending = new Map<string, WorkGoalNotice>();
  private retryAfter = 0;

  constructor(
    private readonly persist: (notice: WorkGoalNotice) => void,
    private readonly onError: (error: unknown) => void,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  has(notice: WorkGoalNotice): boolean { return this.pending.has(`${notice.kind}:${notice.period}`); }

  recordShown(notice: WorkGoalNotice): void {
    this.pending.set(`${notice.kind}:${notice.period}`, notice);
    this.flush();
  }

  flush(): void {
    if (this.clock() < this.retryAfter) return;
    for (const [key, notice] of this.pending) {
      try { this.persist(notice); }
      catch (error) {
        // Start the delay after the failed write, which may itself have waited on SQLite.
        // A monotonic clock keeps wall-clock corrections from changing the delay.
        this.retryAfter = this.clock() + 60_000;
        this.onError(error);
        return;
      }
      this.pending.delete(key);
    }
  }
}
