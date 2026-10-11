import { renderTemplate } from "agboss/internal";
import { readFileSync } from "node:fs";
import { ScaffoldError, ScaffoldUsageError } from "./errors.js";
import { namesOf, type Names } from "./names.js";
import { mcpFiles, ragFiles } from "./parts.js";
import { agentRoute, endpointFiles, finishRoute, MAIN_ROUTER, routerFile } from "./flow-files.js";
import { wire } from "./wire.js";
import type { FileToWrite } from "./write.js";

const TEMPLATES = new URL("../../templates/", import.meta.url);

/** A template of the package rendered with `variables`; an unknown variable is a bug in the template. */
export const render = (path: string, variables: Readonly<Record<string, string>>): string =>
  renderTemplate(
    readFileSync(new URL(path, TEMPLATES), "utf8"),
    variables,
    (key) => new ScaffoldError(`template ${path}: unknown variable {{${key}}}`),
  );

export const vars = (n: Names): Record<string, string> => ({
  kebab: n.kebab,
  snake: n.snake,
  pascal: n.pascal,
  title: n.title,
});

export interface AgentSpec {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
}
export type McpSpec =
  | { readonly kind: "none" }
  | { readonly kind: "filesystem"; readonly name: string; readonly dir: string }
  | {
      readonly kind: "command";
      readonly name: string;
      readonly command: string;
      readonly tool: string;
    };
export interface WorkflowSpec {
  readonly name: string;
  readonly agents: readonly AgentSpec[];
  readonly mcp: McpSpec;
  readonly rag?: { readonly name: string; readonly folder: string } | undefined;
}

/** Where a workflow's files live: `src/<workflow>/`. */
export const workflowDir = (workflow: Names): string => `src/${workflow.kebab}`;

/** What the tools of `agboss create` add (#239): they inject the project's `ApiService`. */
const apiVariables = (tool: Names): Record<string, string> => ({
  serviceImport: 'import { ApiService } from "../services/api.service.js";',
  deps: "  deps: [ApiService],\n",
  constructor: "  constructor(private readonly api: ApiService) {}\n\n",
  serviceUse: `, API: \${this.api.url("/${tool.kebab}")}`,
});

const NO_API = { serviceImport: "", deps: "", constructor: "", serviceUse: "" };

/**
 * A tool and its test in `folder` (`<workflow>/tools`). With `workflow` (`agboss create`, #239) the tool
 * injects the project's `ApiService` and its test runs it in the workflow's app, on its environment.
 */
export function toolFiles(folder: string, tool: Names, workflow?: Names): FileToWrite[] {
  const variables = { ...vars(tool), ...(workflow === undefined ? NO_API : apiVariables(tool)) };
  const test =
    workflow === undefined
      ? render("tool/tool.test.ts.tmpl", variables)
      : render("tool/tool-api.test.ts.tmpl", {
          ...variables,
          workflowPascal: workflow.pascal,
          workflowKebab: workflow.kebab,
        });
  return [
    { path: `${folder}/${tool.kebab}.tool.ts`, content: render("tool/tool.ts.tmpl", variables) },
    { path: `${folder}/${tool.kebab}.tool.test.ts`, content: test },
  ];
}

/** An agent and its prompt in `folder` (`<workflow>/agents`), its tools in `../tools`. */
export function agentFiles(
  folder: string,
  agent: Names,
  description: string,
  tools: readonly Names[],
): FileToWrite[] {
  const imports = tools
    .map((t) => `import { ${t.pascal}Tool } from "../tools/${t.kebab}.tool.js";`)
    .join("\n");
  const variables = {
    ...vars(agent),
    description: description.replace(/"/g, "'"),
    imports,
    tools: tools.map((t) => `${t.pascal}Tool`).join(", "),
  };
  return [
    {
      path: `${folder}/${agent.kebab}.agent.ts`,
      content: render("agent/agent.ts.tmpl", variables).replace(/\n\n\n/g, "\n\n"),
    },
    {
      path: `${folder}/${agent.kebab}.prompt.md`,
      content: render("agent/agent.prompt.md.tmpl", variables),
    },
  ];
}

/** MCP server and knowledge base of a new workflow — both wired into its first agent. */
function extras(
  spec: WorkflowSpec,
  dir: string,
  firstAgent: FileToWrite,
): { files: FileToWrite[]; agent: FileToWrite; server: string } {
  const workflow = namesOf(spec.name);
  const files: FileToWrite[] = [];
  let agent = firstAgent;
  let server = "";
  if (spec.mcp.kind !== "none") {
    const mcp = mcpFiles(dir, spec.mcp);
    files.push(...mcp.files);
    server = mcp.server;
    agent = wire(agent, "Agent", "tools", mcp.tool, mcp.tool, `../${mcp.toolModule}.js`);
  }

  if (spec.rag !== undefined) {
    const rag = ragFiles(dir, workflow, spec.rag);
    files.push(...rag.files);
    agent = wire(
      agent,
      "Agent",
      "rag",
      `{ use: ${rag.knowledge}, mode: "tool" }`,
      rag.knowledge,
      `../rag/${namesOf(spec.rag.name).kebab}.rag.js`,
    );
  }
  return { files, agent, server };
}

/**
 * Every file of one new workflow (agents, tools with tests, MCP, knowledge base, the module); `api`:
 * its tools inject the project's `ApiService` (`agboss create`, #239).
 */
export function planWorkflow(spec: WorkflowSpec, api = false): FileToWrite[] {
  const workflow = namesOf(spec.name);
  const dir = workflowDir(workflow);
  const agents = spec.agents.map((a) => ({
    spec: a,
    names: namesOf(a.name),
    tools: a.tools.map(namesOf),
  }));
  const [firstAgent, ...otherAgentFiles] = agents.flatMap((a) =>
    agentFiles(`${dir}/agents`, a.names, a.spec.description, a.tools),
  );
  if (firstAgent === undefined) throw new ScaffoldUsageError("A workflow needs at least one agent");
  const more = extras(spec, dir, firstAgent);
  const imports = [
    ...agents.map(
      (a) => `import { ${a.names.pascal}Agent } from "./agents/${a.names.kebab}.agent.js";`,
    ),
    ...(spec.mcp.kind === "none"
      ? []
      : [`import { ${more.server} } from "./mcp/${namesOf(spec.mcp.name).kebab}.server.js";`]),
    ...(api ? ['import { ApiService } from "./services/api.service.js";'] : []),
  ].join("\n");
  const module = render("workflow/workflow.ts.tmpl", {
    ...vars(workflow),
    imports,
    agents: agents.map((a) => `${a.names.pascal}Agent`).join(", "),
    servers: more.server,
    // the service the tools inject (`deps: [ApiService]`) — the container creates registered ones
    providers: api ? "  providers: [ApiService],\n" : "",
  });
  const router = routerFile(`${dir}/routers`, namesOf("main"), MAIN_ROUTER, [
    ...agents.map((a) => agentRoute(a.names, a.spec.description)),
    finishRoute("TextWorkflowFinish", "../workflow-finishes/text.workflow-finish.js"),
  ]);
  return [
    { path: `${dir}/models.ts`, content: render("workflow/models.ts.tmpl", {}) },
    {
      path: `${dir}/model-providers/openrouter.model-provider.ts`,
      content: render("workflow/openrouter.model-provider.ts.tmpl", {}),
    },
    ...endpointFiles(dir),
    router,
    ...agents.flatMap((a) =>
      a.tools.flatMap((t) => toolFiles(`${dir}/tools`, t, api ? workflow : undefined)),
    ),
    ...more.files,
    more.agent,
    ...otherAgentFiles,
    { path: `${dir}/${workflow.kebab}.workflow.ts`, content: module },
  ];
}
