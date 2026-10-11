import { mcpServer } from "../tools/index.js";
import { type McpFacade } from "../tools/index.js";
import type { AgentsConfigOf } from "../config/types.js";
import { validateAgentsConfig } from "../config/types.js";
import type { AssembledWorkflow } from "../workflow.js";
import { objectSchemaOf } from "../dto/schema.js";
import { checkGraph, dependencyTree } from "./container.js";
import {
  checkToolData,
  CORE_TOKENS,
  ragParts,
  rememberServers,
  toolBuilder,
  containerFor,
} from "./runtime.js";
import type { IWorkflowAction } from "./decorators.js";
import type { McpServerClient, ServerTools } from "./mcp-client.js";
import type { Token } from "./injection.js";
import { ragClassesOf } from "./rag.js";
import { type Class } from "./injection.js";
import { ComponentError, componentOf, requireComponent } from "./metadata.js";
import { containerPartsOf, policyMapsOf } from "./assemble-parts.js";
import {
  checkProviderClasses,
  checkToolChannels,
  componentClassesOf,
  promptsOf,
  toolNames,
} from "./assemble-checks.js";
import type { AgentMeta, WorkflowMeta } from "./meta-types.js";
import { flowOf, settingsOf } from "./flow-parts.js";
import { channelPartsOf } from "./channel-parts.js";
import { PromptLoader } from "./prompt-render.js";
import { startInputFieldsOf } from "./prompt-input-fields.js";
import { checkMemoryStrategies, memoryPartsOf } from "./memory-parts.js";
import { moduleOf, workflowTreeOf } from "./nested-modules.js";
import { checkObservers } from "./observer-checks.js";
import { judgeClassesOf, judgePartsOf, judgeSettingsOf, type JudgeClass } from "./judge-parts.js";
import { agentSettings } from "./agent-settings.js";

function toolsOf(bundle: WorkflowMeta, agents: readonly AgentMeta[]) {
  const classes = [...new Set(agents.flatMap((agent) => agent.tools ?? []))];
  for (const cls of classes) {
    const kind = componentOf(cls)?.kind;
    if (kind !== "tool" && kind !== "mcp-tool") {
      throw new ComponentError(
        `@Workflow "${bundle.name}": ${cls.name} in an agent's tools is not a @Tool or @McpTool`,
      );
    }
    checkToolData(cls, kind);
  }
  return {
    local: classes.filter((cls) => componentOf(cls)?.kind === "tool"),
    mcp: classes.filter((cls) => componentOf(cls)?.kind === "mcp-tool"),
  };
}

function mcpOf(bundle: WorkflowMeta, mcpTools: readonly Class[]) {
  const servers = (bundle.mcp ?? []).map((cls) => ({
    cls,
    ...requireComponent(cls, "mcp-server", `@Workflow "${bundle.name}"`).meta,
  }));
  const handles = [];
  const serverTools: McpFacade[] = [];
  const instances = new Map<Token, unknown>();
  for (const server of servers) {
    const handle = mcpServer(server.name);
    handles.push(handle);
    const facades = new Map(
      Object.entries(server.tools).map(([tool, schemas]) => [
        tool,
        handle.tool({
          tool,
          description: `${server.name}: ${tool}`,
          input: objectSchemaOf(schemas.input),
          output: objectSchemaOf(schemas.output),
        }),
      ]),
    );
    serverTools.push(...facades.values());
    const instance = new (server.cls as unknown as new () => McpServerClient<ServerTools>)();
    instance.attachServerTools(facades);
    instances.set(server.cls, instance);
  }
  for (const cls of mcpTools) {
    const { meta } = requireComponent(cls, "mcp-tool", `@Workflow "${bundle.name}"`);
    if (!instances.has(meta.server)) {
      throw new ComponentError(
        `@McpTool ${cls.name}: its server ${meta.server.name} is not in @Workflow({ mcp })`,
      );
    }
  }
  return {
    servers,
    handles,
    serverTools,
    instances,
    names: new Map(servers.map((s) => [s.cls, s.name] as const)),
  };
}

type Mcp = ReturnType<typeof mcpOf>;

function configOf(
  bundle: WorkflowMeta,
  agents: readonly AgentMeta[],
  names: ReadonlyMap<Class, string>,
  mcp: Mcp,
  judges: ReadonlyMap<string, JudgeClass>,
): AgentsConfigOf<string> {
  return {
    name: bundle.name,
    version: bundle.version,
    defaults: bundle.defaults,
    ...(bundle.guards === undefined ? {} : { guards: bundle.guards }),
    ...(bundle.compaction === undefined ? {} : { compaction: bundle.compaction }),
    ...(mcp.servers.length === 0
      ? {}
      : { mcpServers: Object.fromEntries(mcp.servers.map((s) => [s.name, s.config])) }),
    ...(judges.size === 0 ? {} : { judges: judgeSettingsOf(judges) }),
    agents: Object.fromEntries(agents.map((agent) => [agent.name, agentSettings(agent, names)])),
  };
}

/** Each tool's dependency tree by tool name (tools without dependencies are left out). */
const toolDependenciesOf = (
  bundle: WorkflowMeta,
  tools: readonly Class[],
  names: ReadonlyMap<Class, string>,
): Record<string, string> =>
  Object.fromEntries(
    tools.flatMap((cls) => {
      const tree = dependencyTree(cls, bundle.providers ?? []);
      return tree === "" ? [] : [[names.get(cls) ?? cls.name, tree] as const];
    }),
  );

/**
 * Assembles a `@Workflow` class into the workflow the core runs: its flow checked against every rule
 * (all violations at once), router texts loaded, limits from `settings()`, config, prompts, tools, MCP.
 * Nested workflows (and compensating ones) bring their agents, actions, routers and module config
 * (providers, MCP servers, channels, observers, policies) into the parent's (`moduleOf`).
 */
export async function workflowOf(bundleClass: Class): Promise<AssembledWorkflow> {
  const bundle = moduleOf(bundleClass);
  const loader = new PromptLoader(bundle.promptVariables ?? {}, startInputFieldsOf(bundle.flow));
  const graph = await flowOf(workflowTreeOf(bundleClass), loader);
  const agents = graph.agents;
  const tools = toolsOf(bundle, agents);
  const mcp = mcpOf(bundle, tools.mcp);
  const rags = ragClassesOf(bundle, agents);
  checkProviderClasses(bundle);
  checkMemoryStrategies(agents);
  const judges = judgeClassesOf(agents);
  checkGraph(
    componentClassesOf(bundle, agents, tools, rags, graph.actions),
    bundle.providers ?? [],
    [...CORE_TOKENS, ...mcp.instances.keys()],
  );
  rememberServers(bundle, mcp.instances);
  const names = toolNames(tools, rags);
  const prompts = await promptsOf(agents, loader);
  loader.throwIfAny();
  const config = configOf(bundle, agents, names, mcp, judges);
  const settings = settingsOf(bundleClass, bundle);

  validateAgentsConfig(config, [...names.values()]);
  checkToolChannels(bundle, tools);
  checkObservers(bundle.observers ?? []);

  return {
    config,
    flow: bundle.flow,
    ...containerPartsOf(bundle, policyMapsOf(agents, tools.local, names)),
    ...channelPartsOf(bundle),
    limits: settings.limits,
    models: settings.models,
    onIncompatibleResume: settings.onIncompatibleResume,
    routers: graph.routers,
    prompts,
    tools: toolBuilder(bundle, agents, tools.local, tools.mcp, mcp.names),
    actions: (services) => {
      const container = containerFor(bundle, services);
      return new Map(graph.actions.map((a) => [a.name, container.get(a.cls) as IWorkflowAction]));
    },
    ...(rags.length === 0 ? {} : ragParts(bundle, agents, rags)),
    ...memoryPartsOf(bundle, agents),
    ...judgePartsOf(bundle, judges),
    mcpServers: mcp.handles,
    serverTools: mcp.serverTools,
    toolDependencies: toolDependenciesOf(bundle, [...tools.local, ...tools.mcp], names),
    ...(bundle.compactionPrompt === undefined ? {} : { compactionPrompt: bundle.compactionPrompt }),
  };
}
