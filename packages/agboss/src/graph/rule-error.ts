/** Codes of the assembly rules — stable, for people and for tests. */
export type RuleCode =
  | "graph.not-a-node"
  | "graph.two-next-steps"
  | "graph.choose-from-non-router"
  | "graph.router-not-last-in-chain"
  | "graph.cycle-without-router"
  | "graph.duplicate-node"
  | "graph.duplicate-node-name"
  | "graph.no-workflow-start"
  | "graph.unreachable-node"
  | "graph.dead-end"
  | "graph.next-after-workflow-finish"
  | "batch.invalid-batch-size"
  | "batch.invalid-concurrency-limit"
  | "batch.strategy-not-decorated"
  | "router.routes-mismatch"
  | "router.self-without-agent-before"
  | "router.no-prompt"
  | "router.empty-route-text"
  | "router.unbounded-cycle";

/** One broken rule: its code, what is wrong, and the nodes (classes) involved. */
export interface RuleViolation {
  readonly code: RuleCode;
  readonly message: string;
  readonly nodes: readonly string[];
}

export const violation = (
  code: RuleCode,
  message: string,
  nodes: readonly string[],
): RuleViolation => ({ code, message, nodes });

/** The flow breaks assembly rules — every violation found, reported at once, before any model call. */
export class GraphRuleError extends Error {
  override name = "GraphRuleError";
  readonly violations: readonly RuleViolation[];

  constructor(violations: readonly RuleViolation[]) {
    const lines = violations.map((item) => `  - [${item.code}] ${item.message}`);
    super(`The workflow's flow breaks ${String(violations.length)} rule(s):\n${lines.join("\n")}`);
    this.violations = violations;
  }
}

/** Throws when anything was found. */
export function throwIfViolated(violations: readonly RuleViolation[]): void {
  if (violations.length > 0) throw new GraphRuleError(violations);
}
