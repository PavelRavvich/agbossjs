import { batchParallelStrategyMetaOf } from "../concurrency/batch.decorator.js";
import type { BatchParallelStrategy } from "../concurrency/batch.decorator.js";
import { quorumRouterMetaOf } from "../concurrency/quorum.decorator.js";
import type { QuorumStrategy } from "../concurrency/quorum.decorator.js";
import type {
  AssembledWorkflow,
  ResolvedPolicies,
  StrategiesByKey,
  WorkflowServices,
} from "../workflow.js";
import type { Guardrail, PiiPolicy } from "./decorators.js";
import type { Class, Provider } from "./injection.js";
import { componentOf } from "./metadata.js";
import type { AgentMeta, PolicyFields, WorkflowMeta } from "./meta-types.js";
import { containerFor } from "./runtime.js";
import type { WorkflowObserver } from "../core/observer-hooks.js";

/** Per agent or tool: its policy classes, and whether they replace the workflow's own. */
interface PolicyClasses {
  readonly override: boolean;
  readonly classes: readonly Class[];
  readonly disable: readonly Class[];
}

/** Policy classes by agent name and by tool name. */
export interface PolicyMaps {
  readonly agentPii: ReadonlyMap<string, PolicyClasses>;
  readonly agentGuardrails: ReadonlyMap<string, PolicyClasses>;
  readonly toolPii: ReadonlyMap<string, PolicyClasses>;
  readonly toolGuardrails: ReadonlyMap<string, PolicyClasses>;
}

const piiClassesOf = (fields: PolicyFields): PolicyClasses =>
  fields.overridePiiPolicies
    ? {
        override: true,
        classes: fields.overridePiiPolicies,
        disable: fields.disablePiiPolicies ?? [],
      }
    : {
        override: false,
        classes: fields.piiPolicies ?? [],
        disable: fields.disablePiiPolicies ?? [],
      };

const guardrailClassesOf = (fields: PolicyFields): PolicyClasses =>
  fields.overrideGuardrails
    ? {
        override: true,
        classes: fields.overrideGuardrails,
        disable: fields.disableGuardrails ?? [],
      }
    : {
        override: false,
        classes: fields.guardrails ?? [],
        disable: fields.disableGuardrails ?? [],
      };

/** A tool's policy settings, as `@Tool` recorded them in its `ToolMeta`. */
function toolPolicyFields(cls: Class): PolicyFields {
  const component = componentOf(cls);
  return component?.kind === "tool" ? component.meta : {};
}

/** The policy classes of every agent and every local tool (tools by their tool name). */
export function policyMapsOf(
  agents: readonly AgentMeta[],
  localTools: readonly Class[],
  names: ReadonlyMap<Class, string>,
): PolicyMaps {
  const toolName = (cls: Class): string => names.get(cls) ?? cls.name;
  return {
    agentPii: new Map(agents.map((a) => [a.name, piiClassesOf(a)])),
    agentGuardrails: new Map(agents.map((a) => [a.name, guardrailClassesOf(a)])),
    toolPii: new Map(localTools.map((t) => [toolName(t), piiClassesOf(toolPolicyFields(t))])),
    toolGuardrails: new Map(
      localTools.map((t) => [toolName(t), guardrailClassesOf(toolPolicyFields(t))]),
    ),
  };
}

function resolvePolicies<TPolicy>(
  map: ReadonlyMap<string, PolicyClasses>,
  instanceOf: (cls: Class) => TPolicy,
): Map<string, ResolvedPolicies<TPolicy>> {
  return new Map(
    Array.from(map.entries()).map(([key, value]) => [
      key,
      {
        override: value.override,
        instances: value.classes.map(instanceOf),
        disable: value.disable,
      },
    ]),
  );
}

/** The key of a strategy: its declared name, else its class name. */
const strategyName = (name: string | undefined, cls: Class): string =>
  name === undefined || name === "" ? cls.name : name;

/** Every provider class with strategy metadata, by its strategy name, its class and its class name. */
function strategiesOf<TStrategy>(
  providers: readonly Provider[],
  metaOf: (cls: Class) => { readonly name?: string } | undefined,
  instanceOf: (cls: Class) => TStrategy,
): StrategiesByKey<TStrategy> {
  const map = new Map<Class | string, TStrategy>();
  for (const provider of providers) {
    const cls = "provide" in provider ? provider.provide : provider;
    if (typeof cls !== "function") continue;
    const meta = metaOf(cls);
    if (meta === undefined) continue;
    const instance = instanceOf(cls);
    map.set(strategyName(meta.name, cls), instance);
    map.set(cls, instance);
    map.set(cls.name, instance);
  }
  return map;
}

/** The parts of a workflow whose instances come from its container (per `services`). */
export type ContainerParts = Pick<
  AssembledWorkflow,
  | "observers"
  | "resolve"
  | "piiPolicies"
  | "guardrails"
  | "toolPiiPolicies"
  | "toolGuardrails"
  | "workflowPiiPolicies"
  | "workflowGuardrails"
  | "quorumRouters"
  | "batchStrategies"
>;

/** The workflow's providers plus the strategies its `batchParallel` steps name (no need to list them twice). */
const batchStrategyProviders = (bundle: WorkflowMeta): readonly Provider[] => [
  ...(bundle.providers ?? []),
  ...bundle.flow.flatMap((step) => (step.kind === "batchParallel" ? [step.strategy] : [])),
];

/** Observers, policies and strategies of a workflow, created by its container. */
export function containerPartsOf(bundle: WorkflowMeta, policies: PolicyMaps): ContainerParts {
  const get = (services: WorkflowServices, cls: Class): unknown =>
    containerFor(bundle, services).get(cls);
  const pii = (services: WorkflowServices) => (cls: Class) => get(services, cls) as PiiPolicy;
  const guardrail = (services: WorkflowServices) => (cls: Class) => get(services, cls) as Guardrail;
  const observers = bundle.observers ?? [];
  const wfPii = bundle.piiPolicies ?? [];
  const wfGuardrails = bundle.guardrails ?? [];
  const providers = bundle.providers ?? [];
  return {
    resolve: (services) => (cls) => get(services, cls),
    observers: (services) => observers.map((cls) => get(services, cls) as WorkflowObserver),
    piiPolicies: (services) => resolvePolicies(policies.agentPii, pii(services)),
    guardrails: (services) => resolvePolicies(policies.agentGuardrails, guardrail(services)),
    toolPiiPolicies: (services) => resolvePolicies(policies.toolPii, pii(services)),
    toolGuardrails: (services) => resolvePolicies(policies.toolGuardrails, guardrail(services)),
    workflowPiiPolicies: (services) => wfPii.map(pii(services)),
    workflowGuardrails: (services) => wfGuardrails.map(guardrail(services)),
    quorumRouters: (services) =>
      strategiesOf(providers, quorumRouterMetaOf, (cls) => get(services, cls) as QuorumStrategy),
    batchStrategies: (services) =>
      strategiesOf(
        batchStrategyProviders(bundle),
        batchParallelStrategyMetaOf,
        (cls) => get(services, cls) as BatchParallelStrategy<unknown, unknown>,
      ),
  };
}
