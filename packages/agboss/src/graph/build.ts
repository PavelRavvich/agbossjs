import { quorumRouterMetaOf } from "../concurrency/quorum.decorator.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { StateGraph } from "@langchain/langgraph";

import { requireComponent } from "../components/metadata.js";
import type { RouterEngine } from "../routers/index.js";
import { checkFlow, type FlowModel } from "./check-flow.js";

import { WorkflowGraphValidator } from "./validator.js";
import type { Flow } from "./flow.js";
import type { FlowNodeRef } from "./flow-nodes.js";
import { FlowState, type FlowStateType, type FlowStateUpdate } from "./flow-state.js";
import { resolveLimits, type ResolvedLimits } from "./limits.js";
import { makeFlowRouterNode, type MemoryLimits } from "./nodes/flow-router.js";
import { routersOf, type LoadedRouter } from "./router-texts.js";
import type { WorkflowLimits } from "./settings.js";
import { visitNode, type FlowNodeRunner, type SpentToday, type VisitDeps } from "./visit.js";
import type { GraphDeps } from "./deps.js";
import { graphNodeId, type Builder } from "./build-shared.js";
import { nodeEdges, startEdges } from "./build-edges.js";
import { catchCodesOf } from "./build-catch.js";
import { compileJoinBarriers } from "./build-joins.js";
import { addBatchNodes, compileBatchParallelLoops } from "./build-batch.js";
import { quorumContextOf, quorumRouterRunner } from "./build-quorum.js";
import { nestedRunner } from "./nested-workflow.js";

export { graphNodeId } from "./build-shared.js";
export { UnknownWorkflowStartError } from "./build-edges.js";

/** What the engine needs from the outside to run a flow. */
export interface FlowRuntime {
  /** The runner of a workflow start, agent or workflow finish (routers are the engine's own). */
  readonly runnerFor: (node: FlowNodeRef) => FlowNodeRunner;
  /** The routing strategy of a router (its own model). */
  readonly routerFor: (router: LoadedRouter) => RouterEngine;
  /** The routers as assembled (texts rendered with the workflow's variables); absent = load from the flow. */
  readonly routers?: readonly LoadedRouter[];
  readonly routerMemory: MemoryLimits;
  readonly limits: WorkflowLimits;
  readonly spentToday: SpentToday;
  readonly checkpointer?: BaseCheckpointSaver;
  readonly observer?: import("../core/observer-manager.js").ObserverManager;

  readonly container?: GraphDeps<string>["container"];
  readonly quorumRouters?: GraphDeps<string>["quorumRouters"];
  readonly batchStrategies?: GraphDeps<string>["batchStrategies"];
}

/** LangGraph's `recursionLimit` is a safety net far above the steps limit, never the limit a user sees. */
const RECURSION_SAFETY_FACTOR = 10;

function runnerOf(
  node: FlowNodeRef,
  model: FlowModel,
  runtime: FlowRuntime,
  routers: ReadonlyMap<string, LoadedRouter>,
  subgraphs: ReadonlyMap<string, FlowGraph>,
): { readonly runner: FlowNodeRunner; readonly maxVisits?: number } {
  if (node.kind === "workflow") return { runner: nestedRunner(node, subgraphs) };
  const loaded = routers.get(node.key);
  if (node.kind !== "router" || loaded === undefined) return { runner: runtime.runnerFor(node) };

  const isQuorumRouter = Array.from(model.nodes.values()).some(
    (n) => n.key === node.key && quorumRouterMetaOf(n.use),
  );
  if (isQuorumRouter) return { runner: quorumRouterRunner(node, runtime) };
  const finish = loaded.routes.find(
    (item) => model.nodes.get(item.option)?.kind === "workflow-finish",
  )?.option;
  const runner = makeFlowRouterNode({
    router: runtime.routerFor(loaded),
    loaded,
    memory: runtime.routerMemory,
    observer: runtime.observer,
    ...(finish === undefined ? {} : { finish }),
  });
  const skipping = reportingSkippedBranches(runner, loaded, joinSourceKeys(model));
  return loaded.maxVisits === undefined
    ? { runner: skipping }
    : { runner: skipping, maxVisits: loaded.maxVisits };
}

/** Keys of every node that feeds a join barrier. */
function joinSourceKeys(model: FlowModel): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const t of model.collected.transitions) {
    if (t.next.kind === "join") {
      keys.add(t.from);
    }
  }
  return keys;
}

/**
 * A router that does not choose a branch leading into a join barrier would leave the barrier
 * waiting for it forever. After each decision, the unchosen join sources are reported to the
 * barrier as `skipped` (they count as arrived, and the join handler sees their status).
 */
function reportingSkippedBranches(
  runner: FlowNodeRunner,
  loaded: LoadedRouter,
  joinSources: ReadonlySet<string>,
): FlowNodeRunner {
  const skippable = loaded.routes.map((r) => r.option).filter((o) => joinSources.has(o));
  if (skippable.length === 0) return runner;
  return async (state, config) => {
    const update = await runner(state, config);
    const chosen = update.next;
    const skipped = skippable.filter((key) => key !== chosen);
    if (skipped.length === 0) return update;
    const forks = Object.fromEntries(
      skipped.map((key) => [key, { data: "", name: key, status: "skipped" as const }]),
    );
    return { ...update, forks: { ...(update.forks ?? {}), ...forks } };
  };
}

/** Adds the graph node(s) of one flow node: its visited runner (and its batch clone). */
function addFlowNode(
  builder: Builder,
  model: FlowModel,
  node: FlowNodeRef,
  runner: FlowNodeRunner,
  visitDeps: VisitDeps,
): void {
  const quorumContext = quorumContextOf(model, node);
  builder.addNode(graphNodeId(node), visitNode(node, runner, visitDeps, quorumContext));

  addBatchNodes(builder, model, node, visitNode(node, runner, visitDeps, quorumContext));
}

function compileFlow(
  model: FlowModel,
  runtime: FlowRuntime,
  routers: ReadonlyMap<string, LoadedRouter>,
  limits: ResolvedLimits,
  compiledSubgraphs: ReadonlyMap<string, FlowGraph>,
) {
  const builder: Builder = new StateGraph<
    typeof FlowState.spec,
    FlowStateType,
    FlowStateUpdate,
    string
  >(FlowState);
  const sharedDeps = {
    limits,
    spentToday: runtime.spentToday,
    quorumRouters: runtime.quorumRouters,
    container: runtime.container,
    keyOf: model.collected.keyOf,
  };
  for (const node of model.nodes.values()) {
    const { runner, maxVisits } = runnerOf(node, model, runtime, routers, compiledSubgraphs);
    const visitDeps = {
      ...sharedDeps,
      ...(maxVisits === undefined ? {} : { maxVisits }),
      catchCodes: catchCodesOf(model, node.key),
    };
    addFlowNode(builder, model, node, runner, visitDeps);
  }
  startEdges(builder, model);
  for (const node of model.nodes.values()) nodeEdges(builder, model, node);
  compileJoinBarriers(builder, model);
  compileBatchParallelLoops(builder, model, runtime.batchStrategies);
  const recursionLimit = (limits.steps + model.nodes.size) * RECURSION_SAFETY_FACTOR;
  const compiled = builder.compile(
    runtime.checkpointer === undefined ? {} : { checkpointer: runtime.checkpointer },
  );
  return { graph: compiled.withConfig({ recursionLimit }), recursionLimit };
}

export type CompiledFlowGraph = ReturnType<typeof compileFlow>["graph"];

/** A flow assembled into a LangGraph graph. */
export interface FlowGraph {
  readonly graph: CompiledFlowGraph;
  readonly model: FlowModel;
  readonly limits: ResolvedLimits;
  readonly recursionLimit: number;
}

/** Checks the flow's workflows for cycles (a workflow nested in itself). */
function validateAcyclic(flow: Flow): void {
  const validator = new WorkflowGraphValidator();
  for (const step of flow) {
    if ("from" in step) {
      const [u] = step.from;
      if (typeof u === "function") validator.validateAcyclic(u);
    }
  }
}

/**
 * Every nested workflow of the model assembled into its own graph, by node key. It runs on the
 * parent's counters, so it is held to the parent's limits.
 */
async function compileSubgraphs(
  model: FlowModel,
  runtime: FlowRuntime,
  limits: ResolvedLimits,
): Promise<Map<string, FlowGraph>> {
  const subgraphs = new Map<string, FlowGraph>();
  for (const node of model.nodes.values()) {
    if (node.kind !== "workflow") continue;
    const { meta } = requireComponent(node.use, "workflow", "assembleFlowGraph");
    subgraphs.set(node.key, await assembleFlowGraph(meta.flow, runtime, limits));
  }
  return subgraphs;
}

/**
 * Checks the flow (all rules, before any model call), loads router texts and builds the LangGraph
 * graph: one graph node per flow node; `to` → edges; `choose` → a conditional edge on the router's
 * decision; workflow starts from `START`, workflow finishes to `END`.
 */
export async function assembleFlowGraph(
  flow: Flow,
  runtime: FlowRuntime,
  inherited?: ResolvedLimits,
): Promise<FlowGraph> {
  validateAcyclic(flow);
  const model = checkFlow(flow);
  const routers = await routersOf(model, runtime.routers);
  const limits = inherited ?? resolveLimits(runtime.limits, model);
  const compiledSubgraphs = await compileSubgraphs(model, runtime, limits);

  const { graph, recursionLimit } = compileFlow(model, runtime, routers, limits, compiledSubgraphs);
  return { graph, model, limits, recursionLimit };
}
