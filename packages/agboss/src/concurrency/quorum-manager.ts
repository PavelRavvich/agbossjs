export class QuorumCancelledError extends Error {
  constructor() {
    super("Quorum reached by parallel branch; execution cancelled.");
    this.name = "QuorumCancelledError";
  }
}

export interface BranchCancelToken {
  cancelled: boolean;
}

interface QuorumState {
  min: number;
  max: number;
  votes: number;
  finished: number;
  tokens: Set<BranchCancelToken>;
  timer?: ReturnType<typeof setTimeout>;
}

export class QuorumManager {
  private activeQuorums = new Map<string, QuorumState>();

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  registerBranch(
    quorumId: string,
    min: number,
    token: BranchCancelToken,
    max?: number,
    timeoutSeconds?: number,
  ) {
    if (!this.activeQuorums.has(quorumId)) {
      const q: QuorumState = {
        min,
        max: max ?? min,
        votes: 0,
        finished: 0,
        tokens: new Set(),
      };

      if (timeoutSeconds) {
        q.timer = setTimeout(() => {
          this.cancelAll(q);
        }, timeoutSeconds * 1000);
      }

      this.activeQuorums.set(quorumId, q);
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const quorum = this.activeQuorums.get(quorumId)!;
    quorum.tokens.add(token);

    if (quorum.votes >= quorum.max) {
      token.cancelled = true;
    }
  }

  isQuorumMet(quorumId: string): boolean {
    const quorum = this.activeQuorums.get(quorumId);
    return quorum ? quorum.votes >= quorum.min : false;
  }

  addVote(quorumId: string, isValid: boolean): boolean {
    const quorum = this.activeQuorums.get(quorumId);
    if (!quorum) return false;

    quorum.finished++;
    if (isValid) quorum.votes++;

    // Condition 1: Reached Max
    if (quorum.votes >= quorum.max) {
      this.cancelAll(quorum);
      return true;
    }

    // Condition 2: Fail Fast (impossible to reach min)
    const failed = quorum.finished - quorum.votes;
    if (failed > quorum.tokens.size - quorum.min) {
      this.cancelAll(quorum);
      return false;
    }

    // Condition 3: All finished naturally
    if (quorum.finished === quorum.tokens.size) {
      this.cancelAll(quorum);
    }

    return quorum.votes >= quorum.min;
  }

  private cancelAll(quorum: QuorumState) {
    if (quorum.timer) clearTimeout(quorum.timer);
    for (const token of quorum.tokens) {
      token.cancelled = true;
    }
  }
}
