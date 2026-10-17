import type { ComponentName } from "../registry.js";
import type { ResolvedField } from "./fields.js";
import { outgoingEdges, type FlowEdge, type FlowGraph } from "./flow-graph.js";
import {
  afterWrites,
  EMPTY_SCOPE,
  scopeKey,
  slotOf,
  SlotStatus,
  type AbstractScope,
  type SlotKey,
} from "./scope.js";

/**
 * The one data-flow engine of the path rules (#272 S10): every node keeps the **set** of abstract
 * scopes that reach it, iterated to a fixed point. The worklist is breadth-first over
 * (node, abstract scope) from the starts, so the first way a state is found is a shortest one — the
 * witness path a message names. The domain is finite (slots × producers), so the iteration ends;
 * `maxVisits` takes no part (a graph wrong on any iteration is wrong).
 */

/** More abstract scopes than this at one node → `[flow.analysis-too-large]` (S10). */
export const MAX_SCOPES_PER_NODE = 4096;

/** Where a state was found from: the node before and its state. */
export interface ScopeRef {
  readonly node: ComponentName;
  readonly key: string;
}

export interface ScopeState {
  readonly scope: AbstractScope;
  readonly key: string;
  /** Edges from a start on the shortest way here. */
  readonly depth: number;
  readonly parent?: ScopeRef;
}

export interface NodeScopes {
  /** In the order found (breadth-first: by depth). */
  readonly states: ReadonlyMap<string, ScopeState>;
  /** More scopes reached the node than `MAX_SCOPES_PER_NODE`; the rest were not explored. */
  readonly isTooLarge: boolean;
  /** The first scope past the limit (it shows which slots multiply the scopes). */
  readonly rejected?: AbstractScope;
}

/** A node's scopes while the engine runs. */
interface GrowingScopes {
  readonly states: Map<string, ScopeState>;
  isTooLarge: boolean;
  rejected?: AbstractScope;
}

export interface Dataflow {
  /** Every node reached from a start; an unreachable node has no entry. */
  readonly scopes: ReadonlyMap<ComponentName, NodeScopes>;
}

/** The slots a producer read when it built its value: its fields' slots that hold a value. */
const builtFrom = (fields: readonly ResolvedField[], scope: AbstractScope): readonly SlotKey[] =>
  [
    ...new Set(
      fields
        .filter((field) => slotOf(scope, field.slot).status === SlotStatus.Current)
        .map((field) => field.slot),
    ),
  ].sort();

class Worklist {
  readonly scopes = new Map<ComponentName, GrowingScopes>();
  private readonly queue: ScopeRef[] = [];
  private next = 0;

  add(node: ComponentName, scope: AbstractScope, depth: number, parent?: ScopeRef): void {
    const entry: GrowingScopes = this.scopes.get(node) ?? { states: new Map(), isTooLarge: false };
    this.scopes.set(node, entry);
    const key = scopeKey(scope);
    if (entry.states.has(key)) return;
    if (entry.states.size >= MAX_SCOPES_PER_NODE) {
      entry.isTooLarge = true;
      entry.rejected ??= scope;
      return;
    }
    entry.states.set(
      key,
      parent === undefined ? { scope, key, depth } : { scope, key, depth, parent },
    );
    this.queue.push({ node, key });
  }

  take(): ScopeRef | undefined {
    const ref = this.queue[this.next];
    this.next += 1;
    return ref;
  }

  state(ref: ScopeRef): ScopeState | undefined {
    return this.scopes.get(ref.node)?.states.get(ref.key);
  }
}

function follow(
  edge: FlowEdge,
  state: ScopeState,
  fields: readonly ResolvedField[],
): readonly AbstractScope[] {
  return afterWrites(state.scope, edge.writes, {
    producer: edge.from,
    builtFrom: builtFrom(fields, state.scope),
  });
}

/** Runs the engine to its fixed point. */
export function runDataflow(
  graph: FlowGraph,
  fields: ReadonlyMap<ComponentName, readonly ResolvedField[]>,
): Dataflow {
  const edges = outgoingEdges(graph);
  const worklist = new Worklist();
  for (const start of graph.starts) worklist.add(start, EMPTY_SCOPE, 0);
  for (let ref = worklist.take(); ref !== undefined; ref = worklist.take()) {
    const state = worklist.state(ref);
    if (state === undefined) continue;
    for (const edge of edges.get(ref.node) ?? []) {
      for (const scope of follow(edge, state, fields.get(edge.from) ?? [])) {
        worklist.add(edge.to, scope, state.depth + 1, ref);
      }
    }
  }
  return { scopes: worklist.scopes };
}

/** The shortest path from a start to a state: the node names, the start first. */
export function witnessPath(dataflow: Dataflow, at: ScopeRef): readonly ComponentName[] {
  const path: ComponentName[] = [];
  for (let ref: ScopeRef | undefined = at; ref !== undefined;) {
    path.unshift(ref.node);
    ref = dataflow.scopes.get(ref.node)?.states.get(ref.key)?.parent;
  }
  return path;
}

/** The states of a node, shallowest first. */
export const statesOf = (dataflow: Dataflow, node: ComponentName): readonly ScopeState[] => [
  ...(dataflow.scopes.get(node)?.states.values() ?? []),
];
