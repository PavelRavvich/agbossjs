import { BaseMemoryStrategy, type MemoryContext, type MemoryView } from "./types.js";

/** A window size; unset fields use the agent's configured limits. */
export interface MemoryWindow {
  readonly turns?: number;
  readonly summaries?: number;
}

const lastOf = <T>(items: readonly T[], limit: number): readonly T[] =>
  limit > 0 ? items.slice(-limit) : [];

/**
 * The built-in strategy: the agent sees the last `turns` earlier turns and the last `summaries`
 * summaries. By default the window is the agent's `historyLimit` / `historySummaries` (else the
 * workflow's `defaults.history`); a subclass may fix it: `super({ turns: 3 })`. The thread store
 * loads at most the deepest configured limit, so a wider window sees no more than that.
 */
export class SlidingWindowStrategy extends BaseMemoryStrategy {
  constructor(private readonly window: MemoryWindow = {}) {
    super();
  }

  buildContext({ history, summaries, limits }: MemoryContext): MemoryView {
    return {
      history: lastOf(history, this.window.turns ?? limits.turns),
      summaries: lastOf(summaries, this.window.summaries ?? limits.summaries),
    };
  }
}
