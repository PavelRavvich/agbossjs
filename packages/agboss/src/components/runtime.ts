import type { AssembledWorkflow, WorkflowServices } from "../workflow.js";
import type { RagConnector } from "../rag/types.js";
import type { RouterEngine } from "../routers/index.js";
import { schemaOf } from "../dto/schema.js";
import { defineTool, type AnyTool, type Tool, type ToolContext } from "../tools/index.js";
import type { Environment } from "../environments/define.js";
import { createContainer, UnavailableValue, type Container } from "./container.js";
import type { ToolHandler } from "./decorators.js";
import { InjectionToken, type Class, type Token } from "./injection.js";
import { componentOf, requireComponent, type ToolMeta } from "./metadata.js";
import type { AgentMeta, WorkflowMeta } from "./meta-types.js";
import { contextSources, ragMeta, searchTool } from "./rag.js";

/** What a workflow creates per run of the app: the container, tool instances, knowledge sources. */

/** Core services a component can depend on. */
export const ROUTER_FACTORY = new InjectionToken<(name: string) => RouterEngine>("ROUTER_FACTORY");
/**
 * The app's environment (#182): the values of `environments/<name>.environment.ts`, typed by the
 * `Environment` contract — `@Injectable({ deps: [ENV] })`, `constructor(env: Environment)`.
 */
export const ENV = new InjectionToken<Environment>("ENV");

const missingEnvironment = new UnavailableValue(
  (dependant) =>
    `[di.missing-environment] ${dependant} injects ENV, but the app has no environment: add environments/dev.environment.ts next to the workflow file (export default defineEnvironment({ … })), or pass one to testWith(…, { environment })`,
);
export const CORE_TOKENS = [ROUTER_FACTORY, ENV];

/**
 * A tool component instance as the core's tool (validation, timeout, errors to the model), typed
 * from its `run` — e.g. in tests: `toolOf(new GreenhouseJobs(fakeJudge, search, fakeFetch))`.
 */
export function toolOf<TInput, TOutput>(instance: {
  run: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}): Tool<string, TInput, TOutput> {
  const cls = instance.constructor as Class;
  const { meta } =
    componentOf(cls)?.kind === "mcp-tool"
      ? requireComponent(cls, "mcp-tool", "toolOf")
      : requireComponent(cls, "tool", "toolOf");
  // The decorator's DTOs are erased in metadata; `run` is what they validate for.
  return adapt(instance, meta) as unknown as Tool<string, TInput, TOutput>;
}

/** The startup check of a tool's DTOs (undecorated fields, behaviour) — before any run. */
export const checkToolData = (cls: Class, kind: "tool" | "mcp-tool"): void => {
  const { meta } = requireComponent(cls, kind, "workflowOf");
  schemaOf(meta.input);
  schemaOf(meta.output);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const adapt = (handler: ToolHandler<any, any>, meta: ToolMeta): AnyTool =>
  defineTool({
    name: meta.name,
    description: meta.description,
    input: schemaOf(meta.input),
    output: schemaOf(meta.output),
    ...(meta.channel === undefined
      ? {}
      : { channel: requireComponent(meta.channel, "channel", "toolOf").meta.name }),
    ...(meta.timeoutMs === undefined ? {} : { timeoutMs: meta.timeoutMs }),
    run: (input, ctx) => handler.run(input, ctx),
  });

/** Each workflow's MCP server instances (with their connected tools): injected like any dependency. */
const serverInstances = new WeakMap<WorkflowMeta, ReadonlyMap<Token, unknown>>();
export const rememberServers = (
  bundle: WorkflowMeta,
  instances: ReadonlyMap<Token, unknown>,
): void => {
  serverInstances.set(bundle, instances);
};

/** One container per workflow and app services: its tools, knowledge and index share instances. */
const containers = new WeakMap<WorkflowMeta, WeakMap<WorkflowServices, Container>>();
export const containerFor = (bundle: WorkflowMeta, services: WorkflowServices): Container => {
  const perBundle = containers.get(bundle) ?? new WeakMap<WorkflowServices, Container>();
  containers.set(bundle, perBundle);
  const existing = perBundle.get(services);
  if (existing !== undefined) return existing;
  const core = new Map<Token, unknown>([
    [ROUTER_FACTORY, services.router],
    [ENV, services.environment ?? missingEnvironment],
  ]);
  for (const [token, instance] of serverInstances.get(bundle) ?? []) core.set(token, instance);
  const container = createContainer(bundle.providers ?? [], core, services.container);
  perBundle.set(services, container);
  return container;
};

/** Tools per run of the app: tools and MCP tools (created by the container), knowledge-base search tools. */
export const toolBuilder =
  (
    bundle: WorkflowMeta,
    agents: readonly AgentMeta[],
    local: readonly Class[],
    mcpTools: readonly Class[],
    serverNames: ReadonlyMap<Class, string>,
  ) =>
  (services: WorkflowServices): readonly AnyTool[] => {
    const container = containerFor(bundle, services);
    const instances = local.map((cls) =>
      adapt(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        container.get(cls) as ToolHandler<any, any>,
        requireComponent(cls, "tool", "workflowOf").meta,
      ),
    );
    const mcp = mcpTools.map((cls) => {
      const { meta } = requireComponent(cls, "mcp-tool", "workflowOf");
      const tool = adapt(container.get(cls) as ToolHandler<unknown, unknown>, meta);
      return { ...tool, mcp: { server: serverNames.get(meta.server) ?? "", tool: meta.name } };
    });
    const searched = [
      ...new Set(
        agents.flatMap((a) => (a.rag ?? []).filter((b) => b.mode === "tool").map((b) => b.use)),
      ),
    ];
    const search = searched.map((cls) =>
      searchTool(ragMeta(cls), container.get(cls) as RagConnector),
    );
    return [...instances, ...mcp, ...search];
  };

export const ragParts = (
  bundle: WorkflowMeta,
  agents: readonly AgentMeta[],
  rags: readonly Class[],
): Required<Pick<AssembledWorkflow, "knowledge" | "knowledgeBases">> => ({
  knowledge: (services: WorkflowServices) =>
    contextSources(agents, (cls) => containerFor(bundle, services).get(cls) as RagConnector),
  knowledgeBases: (services: WorkflowServices) =>
    rags.map((cls) => ({
      name: ragMeta(cls).name,
      connector: containerFor(bundle, services).get(cls) as RagConnector,
    })),
});
