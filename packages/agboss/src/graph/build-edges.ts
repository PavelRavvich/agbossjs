import { END, START, Send } from "@langchain/langgraph";
import type { FlowModel } from "./check-flow.js";
import type { FlowNodeRef, NextDeclaration } from "./flow-nodes.js";
import type { FlowStateType } from "./flow-state.js";
import { predecessorsOf } from "./router-rules.js";
import {
  batchFinishId,
  batchLoopId,
  graphNodeId,
  isBatchTarget,
  nodeKeyed,
  pathMap,
  type Builder,
} from "./build-shared.js";
import { caughtErrorTarget } from "./build-catch.js";

export class UnknownWorkflowStartError extends Error {
  override name = "UnknownWorkflowStartError";
}

type ChooseNext = Extract<NextDeclaration, { kind: "choose" }>;
type Route = string | string[] | Send[];

export function startEdges(builder: Builder, model: FlowModel): void {
  const starts = [...model.nodes.values()].filter((ref) => ref.kind === "workflow-start");
  const [only] = starts;
  if (starts.length === 1 && only !== undefined) {
    builder.addEdge(START, graphNodeId(only));
    return;
  }
  const names = starts.map((ref) => ref.name);
  const pick = (state: FlowStateType): string => {
    if (names.includes(state.start)) return state.start;
    throw new UnknownWorkflowStartError(
      `Unknown workflow start "${state.start}"; workflow starts: ${names.join(", ")}`,
    );
  };
  builder.addConditionalEdges(
    START,
    pick,
    Object.fromEntries(starts.map((ref) => [ref.name, graphNodeId(ref)])),
  );
}

export function nodeEdges(builder: Builder, model: FlowModel, node: FlowNodeRef): void {
  const next = model.next.get(node.key);
  const id = graphNodeId(node);
  wireEdgesForId(builder, model, node, next, id);

  // A batch target also leaves by its own next step once the loop has no batch left.
  if (isBatchTarget(model, node.key))
    wireEdgesForId(builder, model, node, next, batchFinishId(node));
}

/** Every key a router's choice can lead to: its targets, `Self`, `Return` and `End`. */
function chooseKeys(model: FlowModel, node: FlowNodeRef, next: ChooseNext): string[] {
  const self = next.self ? predecessorsOf(model.collected, node.key).map((ref) => ref.key) : [];
  const ret = next.return ? ["skip-wrap"] : [];
  const end = next.end || next.quorumRouter ? [END] : [];
  return [...new Set([...next.targets, ...self, ...ret, ...end])];
}

/** The sends of the parallel group the router chose, if it chose one. */
function parallelSends(
  model: FlowModel,
  next: ChooseNext,
  state: FlowStateType,
): Send[] | undefined {
  const match = next.parallelTargets.find((p) => p.optionName === state.next);
  return match?.targets.map((t) => new Send(graphNodeId(nodeKeyed(model, t)), state));
}

function catchingChooseRoute(
  model: FlowModel,
  node: FlowNodeRef,
  next: ChooseNext,
  state: FlowStateType,
): Route {
  const map = pathMap(model, chooseKeys(model, node, next));
  // `Return` is only chosen when the choice declares it, so the path map has "skip-wrap".
  if (state.next === "Return") return "skip-wrap";
  if (state.next === "End") return END;
  const sends = parallelSends(model, next, state);
  if (sends) return sends;
  return map[state.next] ?? state.next;
}

/** The route of a node with catch handlers when no error was caught. */
function catchingHappyRoute(
  model: FlowModel,
  node: FlowNodeRef,
  next: NextDeclaration | undefined,
  state: FlowStateType,
): Route {
  if (node.kind === "workflow-finish" || (next === undefined && node.kind !== "agent")) {
    return END;
  }
  if (next === undefined) return END;
  switch (next.kind) {
    case "to":
      return next.targets.map((t) => graphNodeId(nodeKeyed(model, t)));
    case "choose":
      return catchingChooseRoute(model, node, next, state);
    case "join":
      return `join-wrap.${graphNodeId(nodeKeyed(model, next.target))}.${node.key}`;
    case "batchParallel":
      return batchLoopId(node.key, next.target);
    case "catch":
      return END;
  }
}

function wireStartTo(builder: Builder, node: FlowNodeRef, id: string, targets: string[]): void {
  const first = targets[0];
  builder.addConditionalEdges(
    id,
    targets.length === 1 && first !== undefined
      ? (state) =>
          state.guarded ? END : state.optionalBranches.includes(node.key) ? "__skip__" : first
      : (state) =>
          state.guarded
            ? [END]
            : state.optionalBranches.includes(node.key)
              ? ["__skip__"]
              : targets,
  );
}

function wireTo(
  builder: Builder,
  model: FlowModel,
  node: FlowNodeRef,
  keys: readonly string[],
  id: string,
): void {
  const targets = keys.map((t) => graphNodeId(nodeKeyed(model, t)));
  if (node.kind === "workflow-start") wireStartTo(builder, node, id, targets);
  else for (const t of targets) builder.addEdge(id, t);
}

function wireChoose(
  builder: Builder,
  model: FlowModel,
  node: FlowNodeRef,
  next: ChooseNext,
  id: string,
): void {
  const map = pathMap(model, chooseKeys(model, node, next));
  builder.addConditionalEdges(
    id,
    (state: FlowStateType) => {
      if (!state.next) return END;
      if (state.next === "Return") return "skip-wrap";
      if (state.next === "End") return END;
      const sends = parallelSends(model, next, state);
      if (sends) return sends;
      // Check if state.next is a key in pathMap keys! If not, fallback to END.
      return state.next in map ? state.next : END;
    },
    map,
  );
}

/** Original fast-path wiring (a node without catch handlers). */
function wirePlainEdges(
  builder: Builder,
  model: FlowModel,
  node: FlowNodeRef,
  next: NextDeclaration | undefined,
  id: string,
): void {
  if (node.kind === "workflow-finish" || (next === undefined && node.kind !== "agent")) {
    builder.addEdge(id, END);
    return;
  }
  if (next === undefined) return;
  if (next.kind === "to") {
    wireTo(builder, model, node, next.targets, id);
  } else if (next.kind === "choose") {
    wireChoose(builder, model, node, next, id);
  } else if (next.kind === "join") {
    const targetId = graphNodeId(nodeKeyed(model, next.target));
    builder.addEdge(id, `join-wrap.${targetId}.${node.key}`);
  } else if (next.kind === "batchParallel") {
    builder.addEdge(id, batchLoopId(node.key, next.target));
  }
}

function wireEdgesForId(
  builder: Builder,
  model: FlowModel,
  node: FlowNodeRef,
  next: NextDeclaration | undefined,
  id: string,
): void {
  const catches = model.catches.get(node.key) ?? [];
  if (catches.length === 0) {
    wirePlainEdges(builder, model, node, next, id);
    return;
  }
  // If we have catch blocks, we MUST use conditional edges
  builder.addConditionalEdges(id, (state: FlowStateType) =>
    state.lastError
      ? caughtErrorTarget(model, catches, state.lastError)
      : catchingHappyRoute(model, node, next, state),
  );
}
