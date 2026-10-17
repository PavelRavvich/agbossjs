import { callerFile } from "../../components/call-site.js";
import type { Class, Provider } from "../../components/injection.js";
import type { AgentMeta } from "../../components/meta-types.js";
import type { Reasoning } from "../../models/reasoning.js";
import { NodeKind, type FlowPath } from "../ast.js";
import { declared, recordDeclaration } from "./declaration.js";

/** Defaults of every chat model (agents, model routers): no `thinking` strings (#269). */
export interface ModelDefaults {
  readonly temperature?: number;
  readonly maxTokens?: AgentMeta["maxTokens"];
  readonly reasoning?: Reasoning;
  readonly cache?: AgentMeta["cache"];
}

/** The model of routers without their own `model` (#261: `defaults.router` keeps only `model`). */
export interface RouterDefaults {
  readonly model: string;
}

export interface ToolDefaults {
  readonly maxToolCalls?: number;
}

export interface HistoryDefaults {
  readonly limit: number;
  readonly summaries?: number;
}

/** Flow checks: a path nesting more levels warns `[flow.path-too-deep]` (default 4). */
export interface FlowDefaults {
  readonly maxPathDepth?: number;
}

export interface WorkflowDefaults {
  readonly models?: ModelDefaults;
  readonly router?: RouterDefaults;
  readonly tools?: ToolDefaults;
  readonly history?: HistoryDefaults;
  readonly flow?: FlowDefaults;
}

/** `@Workflow` — the graph as paths (`flow`), the workflow's count limits and its services. */
export interface WorkflowOptions {
  /** Ends with `-workflow` (`offer-workflow`). */
  readonly name: string;
  readonly version: string;
  readonly flow: readonly FlowPath[];
  /** Steps per execution (#261). */
  readonly maxSteps?: number;
  /** Nesting of child workflows (#263, #264). */
  readonly maxDepth?: number;
  readonly maxConcurrentExecutions?: number;
  readonly defaults?: WorkflowDefaults;
  /** The workflow's own services for DI: classes, or values bound with `provide(TOKEN, value)`. */
  readonly providers?: readonly Provider[];
}

/** The flow is recorded as plain data: each path's source and steps, never the builder objects. */
const plainPath = (path: FlowPath): FlowPath => ({ source: path.source, steps: path.steps });

export function Workflow(options: WorkflowOptions) {
  const source = callerFile();
  const recorded: WorkflowOptions = { ...options, flow: options.flow.map(plainPath) };
  return <TClass extends Class>(value: TClass): TClass => {
    recordDeclaration(value, declared(NodeKind.Workflow, recorded, source));
    return value;
  };
}
