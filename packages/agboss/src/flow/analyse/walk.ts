import { violation, type RuleViolation } from "../../graph/rule-error.js";
import {
  NodeKind,
  StepKind,
  type ChooseOneStep,
  type ErrorClass,
  type FlowPath,
  type OnErrorStep,
  type PathSource,
  type Step,
  type SwitchStep,
  type ToStep,
} from "../ast.js";
import { declarationOf } from "../decorators/declaration.js";
import type { ComponentName } from "../registry.js";
import { EdgeKind, edgeKey, type FlowEdge, type FlowGraph, type ValueWrite } from "./flow-graph.js";
import { dtoLabel } from "./labels.js";
import {
  MentionKind,
  type BranchSite,
  type Mention,
  type Placement,
  type WalkedFlow,
} from "./walked-flow.js";
import { NodeTable } from "./nodes.js";

/**
 * Walks the paths of a flow once (#272 PR 2): builds the graph (nodes, edges with what each step
 * returns), and records what the syntactic rules read — where every node is mentioned (placement),
 * how deep (depth), and every `switch` / `chooseOne` / `onError` with the node it follows.
 */

/** Where a walk stands: the node the next step follows, and what the edge to the next node carries. */
interface Cursor {
  readonly current: ComponentName | undefined;
  readonly writes: readonly ValueWrite[];
  readonly entry: EdgeKind;
  readonly error?: ErrorClass;
  readonly depth: number;
  readonly path: PathSource;
}

class FlowWalker {
  readonly table = new NodeTable();
  readonly edges: FlowEdge[] = [];
  readonly starts: ComponentName[] = [];
  readonly mentions: Mention[] = [];
  readonly placements: Placement[] = [];
  readonly switches: BranchSite<SwitchStep>[] = [];
  readonly choices: BranchSite<ChooseOneStep>[] = [];
  readonly errorHandlers: BranchSite<OnErrorStep>[] = [];
  readonly violations: RuleViolation[] = [];

  walkPath(path: FlowPath): void {
    const source = this.table.resolve(path.source.node, path.source.kind);
    if (source !== undefined) {
      this.placements.push({ node: source, depth: 0, path: path.source });
      if (path.source.kind === NodeKind.Start) this.starts.push(source);
      else this.mentions.push({ node: source, kind: MentionKind.OwnPath, isContinued: true });
    }
    const cursor: Cursor = {
      current: source,
      writes: [],
      entry: EdgeKind.Next,
      depth: 0,
      path: path.source,
    };
    this.walkSteps(path.steps, cursor);
  }

  /** Walks a step list; returns whether it reached a node of its own (a `.to…` step). */
  private walkSteps(steps: readonly Step[], start: Cursor): boolean {
    let cursor = start;
    steps.forEach((step, index) => {
      cursor = this.walkStep(step, cursor, index < steps.length - 1);
    });
    return steps.some((step) => step.kind === StepKind.To);
  }

  /** One step; returns where the walk stands after it (every kind of step has its case). */
  private walkStep(step: Step, cursor: Cursor, isFollowed: boolean): Cursor {
    switch (step.kind) {
      case StepKind.Returns:
        return { ...cursor, writes: [...cursor.writes, ...returned(step.values)] };
      case StepKind.To:
        return this.enter(step, cursor, isFollowed);
      case StepKind.Switch:
        this.walkSwitch(step, cursor);
        return cursor;
      case StepKind.ChooseOne:
        this.walkChooseOne(step, cursor);
        return cursor;
      case StepKind.OnError:
        this.walkOnError(step, cursor);
        return cursor;
    }
  }

  private enter(step: ToStep, cursor: Cursor, isContinued: boolean): Cursor {
    const target = this.table.resolve(step.target, step.targetKind);
    if (target !== undefined) this.arrive(target, cursor, isContinued);
    return {
      current: target,
      writes: [],
      entry: EdgeKind.Next,
      depth: cursor.depth,
      path: cursor.path,
    };
  }

  /** A mention of `target` reached from the cursor: its placement, mention and incoming edge. */
  private arrive(target: ComponentName, cursor: Cursor, isContinued: boolean): void {
    this.placements.push({ node: target, depth: cursor.depth, path: cursor.path });
    this.mentions.push({ node: target, kind: MentionKind.Entry, isContinued });
    if (isContinued && this.table.node(target).kind === NodeKind.Finish) {
      const message = `${target} is a finish — nothing follows .toFinish(…) or route(…) of a finish`;
      this.violations.push(violation("graph.next-after-workflow-finish", message, [target]));
    }
    const from = cursor.current;
    if (from === undefined || this.table.node(from).kind === NodeKind.Finish) return;
    const { entry: kind, writes, error } = cursor;
    this.edges.push(
      error === undefined
        ? { from, to: target, kind, writes }
        : { from, to: target, kind, writes, error },
    );
  }

  private walkSwitch(step: SwitchStep, cursor: Cursor): void {
    if (cursor.current === undefined) return;
    this.switches.push({ node: cursor.current, step });
    for (const branch of step.cases) {
      const write: ValueWrite = {
        shape: branch.dto,
        isCase: true,
        ...(branch.tag === undefined ? {} : { tag: branch.tag }),
      };
      const inner: Cursor = {
        ...cursor,
        writes: [write],
        entry: EdgeKind.Case,
        depth: cursor.depth + 1,
      };
      if (!this.walkSteps(branch.path.steps, inner)) {
        const message = `${cursor.current}: caseOf(${dtoLabel(branch.dto)}) leads nowhere — continue it with .to…(…)`;
        this.violations.push(violation("graph.dead-end", message, [cursor.current]));
      }
    }
  }

  private walkChooseOne(step: ChooseOneStep, cursor: Cursor): void {
    if (cursor.current !== undefined) this.choices.push({ node: cursor.current, step });
    const depth = cursor.depth + 1;
    for (const route of step.routes) {
      const target = this.table.resolve(route.target, kindOfTarget(route.target));
      if (target === undefined) continue;
      this.arrive(target, { ...cursor, entry: EdgeKind.Route, depth }, route.path.steps.length > 0);
      this.walkSteps(route.path.steps, {
        current: target,
        writes: [],
        entry: EdgeKind.Next,
        depth,
        path: cursor.path,
      });
    }
  }

  private walkOnError(step: OnErrorStep, cursor: Cursor): void {
    if (cursor.current === undefined) return;
    this.errorHandlers.push({ node: cursor.current, step });
    const inner: Cursor = {
      ...cursor,
      writes: [],
      entry: EdgeKind.Error,
      error: step.error,
      depth: cursor.depth + 1,
    };
    if (!this.walkSteps(step.path.steps, inner)) {
      const message = `${cursor.current}: .onError(${step.error.name}, …) leads nowhere — start it with toAction(…) or toFinish(…)`;
      this.violations.push(violation("graph.dead-end", message, [cursor.current]));
    }
  }
}

/** A route target's kind is the kind its class is declared with (the builder checked it). */
const kindOfTarget = (target: ToStep["target"]): NodeKind =>
  declarationOf(target)?.kind ?? NodeKind.Agent;

const returned = (
  values: readonly { readonly shape: ValueWrite["shape"]; readonly as?: string }[],
) =>
  values.map((value): ValueWrite =>
    value.as === undefined
      ? { shape: value.shape, isCase: false }
      : { shape: value.shape, tag: value.as, isCase: false },
  );

/** Walks every path of a flow. */
export function walkFlow(flow: readonly FlowPath[]): WalkedFlow {
  const walker = new FlowWalker();
  for (const path of flow) walker.walkPath(path);
  const edges = [...walker.edges].sort((first, second) =>
    edgeKey(first).localeCompare(edgeKey(second)),
  );
  const graph: FlowGraph = {
    nodes: walker.table.nodes,
    edges,
    starts: [...new Set(walker.starts)].sort(),
  };
  return {
    graph,
    mentions: walker.mentions,
    placements: walker.placements,
    switches: walker.switches,
    choices: walker.choices,
    errorHandlers: walker.errorHandlers,
    violations: [...walker.table.violations, ...walker.violations],
  };
}
