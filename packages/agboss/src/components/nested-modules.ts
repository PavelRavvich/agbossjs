import { collectFlow } from "../graph/flow-nodes.js";
import { tokenName, type Class, type Provider, type Token } from "./injection.js";
import { ComponentError, componentOf, requireComponent } from "./metadata.js";
import type { WorkflowMeta } from "./meta-types.js";

/** A `@Workflow` class with its settings. */
export interface WorkflowModule {
  readonly cls: Class;
  readonly meta: WorkflowMeta;
}

/** The compensation declared on an agent or action class, if any. */
const compensationOf = (cls: Class): Class | undefined => {
  const component = componentOf(cls);
  return component?.kind === "agent" || component?.kind === "action"
    ? component.meta.compensate
    : undefined;
};

/** The workflows a flow runs: its nested `@Workflow` nodes and the workflows compensating its nodes. */
const childrenOf = (meta: WorkflowMeta): Class[] =>
  [...collectFlow(meta.flow).nodes.values()]
    .flatMap((ref) => [ref.use, compensationOf(ref.use)])
    .filter((cls): cls is Class => cls !== undefined && componentOf(cls)?.kind === "workflow");

/** The workflow and every workflow under it (nested or compensating), each once by class, root first. */
export function workflowTreeOf(root: Class): readonly WorkflowModule[] {
  const seen = new Map<Class, WorkflowMeta>();
  const visit = (cls: Class): void => {
    if (seen.has(cls)) return;
    const { meta } = requireComponent(cls, "workflow", "workflowOf");
    seen.set(cls, meta);
    for (const child of childrenOf(meta)) visit(child);
  };
  visit(root);
  return [...seen].map(([cls, meta]) => ({ cls, meta }));
}

const tokenOf = (provider: Provider): Token =>
  "provide" in provider ? provider.provide : provider;

const sameProvider = (left: Provider, right: Provider): boolean =>
  left === right ||
  ("provide" in left && "provide" in right && Object.is(left.useValue, right.useValue));

/** Every module's providers once by token; a token two modules register differently is an error. */
function mergedProviders(modules: readonly WorkflowMeta[]): Provider[] {
  const byToken = new Map<Token, { readonly provider: Provider; readonly owner: WorkflowMeta }>();
  for (const module of modules) {
    for (const provider of module.providers ?? []) {
      const token = tokenOf(provider);
      const taken = byToken.get(token);
      if (
        taken !== undefined &&
        taken.owner !== module &&
        !sameProvider(taken.provider, provider)
      ) {
        throw new ComponentError(
          `[di.duplicate-token] ${tokenName(token)} is registered differently by @Workflow "${taken.owner.name}" and its nested @Workflow "${module.name}": register it in one of them, or with the same value`,
        );
      }
      byToken.set(token, { provider, owner: module });
    }
  }
  return [...byToken.values()].map((entry) => entry.provider);
}

/** Every module's prompt variables; a key two modules set to different values is an error. */
function mergedVariables(modules: readonly WorkflowMeta[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const module of modules) {
    for (const [key, value] of Object.entries(module.promptVariables ?? {})) {
      if (key in merged && merged[key] !== value) {
        throw new ComponentError(
          `[workflow.prompt-variable-conflict] {{${key}}} has different values in @Workflow "${modules[0]?.name ?? ""}" and its nested @Workflow "${module.name}"`,
        );
      }
      merged[key] = value;
    }
  }
  return merged;
}

/** The parent's settings with the DI parts of every nested module merged in. */
function mergedModule(own: WorkflowMeta, children: readonly WorkflowMeta[]): WorkflowMeta {
  const all = [own, ...children];
  const union = <T>(pick: (meta: WorkflowMeta) => readonly T[] | undefined): T[] => [
    ...new Set(all.flatMap((meta) => pick(meta) ?? [])),
  ];
  return {
    ...own,
    mcp: union((meta) => meta.mcp),
    piiPolicies: union((meta) => meta.piiPolicies),
    guardrails: union((meta) => meta.guardrails),
    channelClasses: union((meta) => meta.channelClasses),
    observers: union((meta) => meta.observers),
    providers: mergedProviders(all),
    promptVariables: mergedVariables(all),
  };
}

const modules = new WeakMap<Class, WorkflowMeta>();

/**
 * The module a workflow is assembled from: its own settings, with the providers, MCP servers,
 * channels, observers, policies and prompt variables of every nested (or compensating) workflow
 * merged in. One object per workflow class (its container is keyed on it).
 */
export function moduleOf(root: Class): WorkflowMeta {
  const cached = modules.get(root);
  if (cached !== undefined) return cached;
  const own = requireComponent(root, "workflow", "workflowOf").meta;
  const children = workflowTreeOf(root)
    .slice(1)
    .map((module) => module.meta);
  const module = children.length === 0 ? own : mergedModule(own, children);
  modules.set(root, module);
  return module;
}
