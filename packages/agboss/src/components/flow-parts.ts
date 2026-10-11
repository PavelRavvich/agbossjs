import { checkFlow } from "../graph/check-flow.js";
import { loadRouters, type LoadedRouter } from "../graph/router-texts.js";
import type { WorkflowDefinition, WorkflowSettings } from "../graph/settings.js";
import type { Class } from "./injection.js";
import type { PromptLoader } from "./prompt-render.js";
import { ComponentError, requireComponent } from "./metadata.js";
import type { AgentMeta, WorkflowMeta } from "./meta-types.js";
import type { WorkflowModule } from "./nested-modules.js";

/** What a workflow's flow gives assembly: its agents (named as their nodes) and its routers. */
export interface FlowParts {
  readonly actions: readonly { readonly name: string; readonly cls: Class }[];
  readonly agents: readonly AgentMeta[];
  readonly routers: readonly LoadedRouter[];
}

/** Nodes by name, each once; one name used for two different classes is an error. */
class NodesByName<TValue> {
  readonly #byName = new Map<string, { readonly cls: Class; readonly value: TValue }>();

  add(name: string, cls: Class, value: () => TValue, workflow: string): void {
    const taken = this.#byName.get(name);
    if (taken === undefined) {
      this.#byName.set(name, { cls, value: value() });
      return;
    }
    if (taken.cls !== cls) {
      throw new ComponentError(
        `[workflow.duplicate-node] @Workflow "${workflow}": the node "${name}" is ${cls.name}, but a parent or nested workflow already uses "${name}" for ${taken.cls.name}`,
      );
    }
  }

  values(): TValue[] {
    return [...this.#byName.values()].map((entry) => entry.value);
  }
}

/**
 * Checks each flow of the workflow tree (every rule, all violations at once — before any model
 * call) and reads its parts: each agent node's `@Agent` settings under the node's name, the
 * actions, and every router with its texts loaded. A node shared by parent and child counts once.
 */
export async function flowOf(
  tree: readonly WorkflowModule[],
  loader: PromptLoader,
): Promise<FlowParts> {
  const actions = new NodesByName<{ name: string; cls: Class }>();
  const agents = new NodesByName<AgentMeta>();
  const routers = new NodesByName<LoadedRouter>();
  for (const { meta } of tree) {
    const model = checkFlow(meta.flow);
    const loaded = await loadRouters(model, loader);
    for (const ref of model.nodes.values()) {
      const router = ref.kind === "router" ? loaded.get(ref.name) : undefined;
      if (router !== undefined) routers.add(ref.name, ref.use, () => router, meta.name);
      if (ref.kind === "action") {
        actions.add(ref.name, ref.use, () => ({ name: ref.name, cls: ref.use }), meta.name);
      } else if (ref.kind === "agent") {
        const agent = requireComponent(ref.use, "agent", `@Workflow "${meta.name}"`).meta;
        agents.add(ref.name, ref.use, () => ({ ...agent, name: ref.name }), meta.name);
      }
    }
  }
  return { agents: agents.values(), actions: actions.values(), routers: routers.values() };
}

const isDefinition = (value: unknown): value is WorkflowDefinition =>
  typeof value === "object" &&
  value !== null &&
  "settings" in value &&
  typeof value.settings === "function";

/** The workflow's `settings()` (`implements WorkflowDefinition`): limits, model providers. */
export function settingsOf(bundleClass: Class, bundle: WorkflowMeta): WorkflowSettings {
  // a @Workflow class is constructed with no arguments (the decorator's type requires it)
  const instance: unknown = new (bundleClass as unknown as new () => unknown)();
  if (!isDefinition(instance)) {
    throw new ComponentError(
      `@Workflow "${bundle.name}": the class must implement WorkflowDefinition (settings())`,
    );
  }
  return instance.settings();
}
