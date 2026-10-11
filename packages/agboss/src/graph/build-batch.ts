import { Send } from "@langchain/langgraph";
import type { FlowModel } from "./check-flow.js";
import type { FlowNodeRef, NextDeclaration } from "./flow-nodes.js";
import type { FlowStateType, FlowStateUpdate } from "./flow-state.js";
import type { GraphDeps } from "./deps.js";
import type { FlowNodeRunner } from "./visit.js";
import {
  batchFinishId,
  batchLoopId,
  batchWorkerId,
  isBatchTarget,
  nodeKeyed,
  type Builder,
} from "./build-shared.js";

type BatchNext = Extract<NextDeclaration, { kind: "batchParallel" }>;
type Strategies = GraphDeps<string>["batchStrategies"];

/** The items of a batch step, from its `@BatchParallelStrategy` (a provider of the workflow). */
async function extractItems(next: BatchNext, strategies: Strategies, state: FlowStateType) {
  // The lookup misses for a strategy that is not among the workflow's providers.
  const strategy: { extract(state: FlowStateType): unknown } | undefined = strategies?.(
    next.strategy,
  );
  if (strategy === undefined) {
    throw new Error(
      `batchParallel strategy ${next.strategy.name} is not a provider of the workflow — add it to @Workflow providers`,
    );
  }
  const items = await strategy.extract(state);
  if (!Array.isArray(items)) {
    throw new TypeError(`batchParallel strategy ${next.strategy.name} must return an array`);
  }
  return items as unknown[];
}

/** Up to `concurrencyLimit` batches of `batchSize` items from the head of the queue. */
function takeBatches(
  queue: unknown[],
  options: BatchNext["options"],
): { activeBatch: unknown[][]; newQueue: unknown[] } {
  const activeBatch: unknown[][] = [];
  let newQueue = queue;
  for (let i = 0; i < options.concurrencyLimit && newQueue.length > 0; i++) {
    activeBatch.push(newQueue.slice(0, options.batchSize));
    newQueue = newQueue.slice(options.batchSize);
  }
  return { activeBatch, newQueue };
}

/** What one worker gets as its item: the element itself for `batchSize: 1`, else its batch. */
const workerItem = (batch: unknown[], options: BatchNext["options"]): unknown =>
  options.batchSize === 1 ? batch[0] : batch;

/**
 * The target's graph nodes besides its own: the worker copy each batch runs in, and the finish
 * node the loop leaves by (its edges are the target's own next step, see `nodeEdges`).
 */
export function addBatchNodes(
  builder: Builder,
  model: FlowModel,
  node: FlowNodeRef,
  worker: FlowNodeRunner,
): void {
  if (!isBatchTarget(model, node.key)) return;
  builder.addNode(batchWorkerId(node), worker);
  builder.addNode(batchFinishId(node), (): FlowStateUpdate => ({}));
}

/** The loop node: the queue (extracted on entry), then the next round of batches; none = done. */
function loopNode(next: BatchNext, strategies: Strategies) {
  const targetKey = next.target;
  return async (state: FlowStateType): Promise<FlowStateUpdate> => {
    const previous = state._batchCursor[targetKey];
    const queue = previous?.queue ?? (await extractItems(next, strategies, state));
    const { activeBatch, newQueue } = takeBatches(queue, next.options);
    // the index of this round's first batch: every batch of the earlier rounds came before it
    const offset = (previous?.offset ?? 0) + (previous?.activeBatch?.length ?? 0);
    // Done: the cursor is cleared, so the next run through this step extracts again.
    const cursor = activeBatch.length === 0 ? undefined : { queue: newQueue, activeBatch, offset };
    return { _batchCursor: { [targetKey]: cursor } };
  };
}

function wireBatchLoop(
  builder: Builder,
  model: FlowModel,
  sourceKey: string,
  next: BatchNext,
  strategies: Strategies,
): void {
  const target = nodeKeyed(model, next.target);
  const loopId = batchLoopId(sourceKey, next.target);
  const workerId = batchWorkerId(target);
  builder.addNode(loopId, loopNode(next, strategies));
  builder.addConditionalEdges(loopId, (state: FlowStateType) => {
    const cursor = state._batchCursor[next.target];
    const activeBatch = cursor?.activeBatch ?? [];
    if (activeBatch.length === 0) return batchFinishId(target);
    const offset = cursor?.offset ?? 0;
    return activeBatch.map(
      (batch, index) =>
        new Send(workerId, {
          ...state,
          batchItem: workerItem(batch, next.options),
          batchIndex: offset + index,
        }),
    );
  });
  builder.addEdge(workerId, loopId);
}

export function compileBatchParallelLoops(
  builder: Builder,
  model: FlowModel,
  strategies: Strategies,
): void {
  for (const t of model.collected.transitions) {
    if (t.next.kind === "batchParallel") wireBatchLoop(builder, model, t.from, t.next, strategies);
  }
}
