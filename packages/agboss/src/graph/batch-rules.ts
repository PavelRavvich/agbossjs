import { batchParallelStrategyMetaOf } from "../concurrency/batch.decorator.js";
import type { CollectedFlow, NextDeclaration, Transition } from "./flow-nodes.js";
import { violation, type RuleViolation } from "./rule-error.js";

type BatchTransition = Transition & {
  readonly next: Extract<NextDeclaration, { kind: "batchParallel" }>;
};

const isBatch = (t: Transition): t is BatchTransition => t.next.kind === "batchParallel";

/** A count option of `batchParallel` must be a whole number of at least 1. */
const isCount = (value: number): boolean => Number.isInteger(value) && value >= 1;

function batchViolations(flow: CollectedFlow, t: BatchTransition): RuleViolation[] {
  const { next } = t;
  const label = flow.nodes.get(next.target)?.label ?? next.target;
  const found: RuleViolation[] = [];
  if (!isCount(next.options.batchSize)) {
    const message = `batchParallel to ${label}: batchSize must be a whole number >= 1 (got ${String(next.options.batchSize)})`;
    found.push(violation("batch.invalid-batch-size", message, [label]));
  }
  if (!isCount(next.options.concurrencyLimit)) {
    const message = `batchParallel to ${label}: concurrencyLimit must be a whole number >= 1 (got ${String(next.options.concurrencyLimit)})`;
    found.push(violation("batch.invalid-concurrency-limit", message, [label]));
  }
  if (batchParallelStrategyMetaOf(next.strategy) === undefined) {
    const message = `batchParallel to ${label}: strategy ${next.strategy.name} is not a @BatchParallelStrategy`;
    found.push(violation("batch.strategy-not-decorated", message, [label, next.strategy.name]));
  }
  return found;
}

/** `batchParallel` options: batch size and concurrency of at least 1, a decorated strategy. */
export const batchRules = (flow: CollectedFlow): RuleViolation[] =>
  flow.transitions.filter(isBatch).flatMap((t) => batchViolations(flow, t));
