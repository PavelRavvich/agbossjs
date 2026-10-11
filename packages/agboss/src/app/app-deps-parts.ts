import type {
  ChannelRequest,
  Guardrail,
  InboundChannelAdapter,
  PiiPolicy,
} from "../components/decorators.js";
import type { BatchParallelStrategy } from "../concurrency/batch.decorator.js";
import type { QuorumStrategy } from "../concurrency/quorum.decorator.js";
import type { Class } from "../components/injection.js";
import { stopAll } from "../components/lifecycle.js";
import { ObserverManager } from "../core/observer-manager.js";
import type { TernStore } from "../terns/index.js";
import type { McpConnections } from "../tools/index.js";
import type { RunTracing } from "../tracing/index.js";
import type {
  AssembledWorkflow,
  ResolvedPolicies,
  StrategiesByKey,
  WorkflowServices,
} from "../workflow.js";

/**
 * Dispatches an approval request to the workflow's channel of that name. The channels are created
 * here, with the app (so their lifecycle hooks run and a missing dependency fails at start).
 */
export const approvalRequester = (bundle: AssembledWorkflow, services: WorkflowServices) => {
  const channels = bundle.channels?.(services);
  return async (channelName: string, req: ChannelRequest): Promise<void> => {
    const channel = channels?.get(channelName);
    if (!channel) throw new Error(`Unknown channel: ${channelName}`);
    await channel.requestApproval(req);
  };
};

/** No policies of its own: the workflow's apply. */
const noPolicies = (): ResolvedPolicies<never> => ({ override: false, instances: [], disable: [] });

/** Per agent and per tool: its PII policies and guardrails; the workflow's own; channel adapters. */
export interface PolicyDeps {
  readonly piiPolicies: (agent: string) => ResolvedPolicies<PiiPolicy>;
  readonly toolPiiPolicies: (tool: string) => ResolvedPolicies<PiiPolicy>;
  readonly toolGuardrails: (tool: string) => ResolvedPolicies<Guardrail>;
  readonly workflowPiiPolicies: readonly PiiPolicy[];
  readonly workflowGuardrails: readonly Guardrail[];
  readonly guardrails: (agent: string) => ResolvedPolicies<Guardrail>;
  readonly channelAdapters: (channel: string) => InboundChannelAdapter | undefined;
}

export const policyDepsOf = (
  bundle: AssembledWorkflow,
  services: WorkflowServices,
  adapters = bundle.channelAdapters?.(services),
): PolicyDeps => ({
  piiPolicies: (agent: string) => bundle.piiPolicies?.(services).get(agent) ?? noPolicies(),
  toolPiiPolicies: (tool: string) => bundle.toolPiiPolicies?.(services).get(tool) ?? noPolicies(),
  toolGuardrails: (tool: string) => bundle.toolGuardrails?.(services).get(tool) ?? noPolicies(),
  workflowPiiPolicies: bundle.workflowPiiPolicies?.(services) ?? [],
  workflowGuardrails: bundle.workflowGuardrails?.(services) ?? [],
  guardrails: (agent: string) => bundle.guardrails?.(services).get(agent) ?? noPolicies(),
  channelAdapters: (channel: string) => adapters?.get(channel),
});

/** A strategy by its name or class, looked up in the workflow's container on every call. */
const strategyLookup =
  <T>(
    strategiesOf: ((services: WorkflowServices) => StrategiesByKey<T>) | undefined,
    services: WorkflowServices,
  ) =>
  (key: Class | string): T | undefined =>
    strategiesOf?.(services).get(key);

const isInstanceOf = (instance: unknown, token: unknown): boolean =>
  typeof instance === "object" && instance !== null && instance.constructor === token;

/** The container's instances: lookup by class, strategies, and the observers (created eagerly). */
export interface ContainerDeps {
  readonly container: { readonly get: <T>(token: Class<T>) => T };
  readonly quorumRouters: (key: Class | string) => QuorumStrategy | undefined;
  readonly batchStrategies: (
    key: Class | string,
  ) => BatchParallelStrategy<unknown, unknown> | undefined;
  readonly observer: ObserverManager;
}

export function containerDepsOf(
  bundle: AssembledWorkflow,
  services: WorkflowServices,
  created: unknown[],
): ContainerDeps {
  return {
    container: {
      get: <T>(token: Class<T>): T => {
        const resolve = bundle.resolve?.(services);
        return (
          typeof token === "function" && resolve !== undefined
            ? resolve(token)
            : created.find((c) => isInstanceOf(c, token))
        ) as T;
      },
    },
    quorumRouters: strategyLookup(bundle.quorumRouters, services),
    batchStrategies: strategyLookup(bundle.batchStrategies, services),
    // created now (eagerly), so their `onStart` runs with the app's
    observer: new ObserverManager(bundle.observers?.(services) ?? []),
  };
}

/** Runs `onStop` of the components, then closes MCP, tracing and the Tern store the app opened. */
export const closeOf =
  (
    created: unknown[],
    mcp: McpConnections,
    tracing: RunTracing | undefined,
    ownedTerns: TernStore | undefined,
  ) =>
  async (): Promise<void> => {
    try {
      await stopAll(created);
    } finally {
      await mcp.close();
      await tracing?.shutdown();
      ownedTerns?.close();
    }
  };
