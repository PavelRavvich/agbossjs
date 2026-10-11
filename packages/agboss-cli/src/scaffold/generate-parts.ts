import type { GenerateOptions } from "./generate.js";
import { namesOf } from "./names.js";
import { mcpFiles, ragFiles } from "./parts.js";
import { toolFiles } from "./plan.js";
import { need, read } from "./project-files.js";
import { FILESYSTEM_SERVER_PACKAGE, filesystemServerVersion } from "./project.js";
import { wire } from "./wire.js";
import { agentOf, importPath, workflowGraph, type WorkflowGraph } from "./workflow-graph.js";
import type { Changes, FileToWrite } from "./write.js";

/**
 * `package.json` with more scripts and a dependency. A script already there is kept and reported as
 * skipped (a conflict without `--force`, never overwritten).
 */
export function withScripts(
  root: string,
  scripts: Record<string, string>,
  dependency?: readonly [string, string],
): FileToWrite {
  const pkg = JSON.parse(read(root, "package.json").content) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const existing = Object.keys(scripts).filter((k) => pkg.scripts?.[k] !== undefined);
  const added = Object.fromEntries(
    Object.entries(scripts).filter(([key]) => !existing.includes(key)),
  );
  const deps =
    dependency === undefined
      ? pkg.dependencies
      : {
          ...pkg.dependencies,
          [dependency[0]]: pkg.dependencies?.[dependency[0]] ?? dependency[1],
        };
  return {
    path: "package.json",
    content: `${JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, ...added }, dependencies: deps }, null, 2)}\n`,
    skipped: existing.map((key) => `package.json: script "${key}" already there`),
  };
}

/** The agent file `--agent <name>` names in the workflow. */
const agentFileOf = (root: string, graph: WorkflowGraph, name: string): FileToWrite =>
  read(root, agentOf(graph, name).path);

/** `agboss g tool <name> --workflow … --agent …`: the tool and its test, wired into the agent. */
export function planTool(root: string, name: string, o: GenerateOptions): Changes {
  const graph = workflowGraph(root, o.workflow, "tool");
  const agent = agentFileOf(root, graph, need(o.agent, "--agent <name>", "tool"));
  const n = namesOf(name);
  const files = toolFiles(`${graph.dir}/tools`, n);
  const tool = `${n.pascal}Tool`;
  const from = importPath(agent.path, `${graph.dir}/tools/${n.kebab}.tool.ts`);
  return { create: files, modify: [wire(agent, "Agent", "tools", tool, tool, from)] };
}

const mcpSpecOf = (name: string, o: GenerateOptions) =>
  o.dir !== undefined
    ? { kind: "filesystem" as const, name, dir: o.dir }
    : {
        kind: "command" as const,
        name,
        command: need(o.command, "--dir <folder> or --command <cmd>", "mcp"),
        tool: need(o.tool, "--tool <name>", "mcp"),
      };

/** `agboss g mcp <name> --workflow … [--agent …]`: the server in the workflow's `mcp`, its tool in the agent. */
export function planMcp(root: string, name: string, o: GenerateOptions): Changes {
  const graph = workflowGraph(root, o.workflow, "mcp");
  const spec = mcpSpecOf(name, o);
  const mcp = mcpFiles(graph.dir, spec);
  const serverPath = `${graph.dir}/${mcp.serverModule}.ts`;
  const modify = [
    wire(
      graph.module,
      "Workflow",
      "mcp",
      mcp.server,
      mcp.server,
      importPath(graph.module.path, serverPath),
    ),
  ];
  if (o.agent !== undefined) {
    const agent = agentFileOf(root, graph, o.agent);
    const from = importPath(agent.path, `${graph.dir}/${mcp.toolModule}.ts`);
    modify.push(wire(agent, "Agent", "tools", mcp.tool, mcp.tool, from));
  }
  if (spec.kind === "filesystem")
    modify.push(withScripts(root, {}, [FILESYSTEM_SERVER_PACKAGE, filesystemServerVersion()]));
  return { create: mcp.files, modify };
}

/** `agboss g rag <name> --workflow … --folder … [--agent …]`: the knowledge base, a tool of the agent. */
export function planRag(root: string, name: string, o: GenerateOptions): Changes {
  const graph = workflowGraph(root, o.workflow, "rag");
  const workflow = namesOf(graph.module.path.replace(/^.*\//, "").replace(/\.workflow\.ts$/, ""));
  const rag = ragFiles(graph.dir, workflow, {
    name,
    folder: need(o.folder, "--folder <dir>", "rag"),
  });
  if (o.agent === undefined) return { create: rag.files, modify: [] };
  const agent = agentFileOf(root, graph, o.agent);
  const from = importPath(agent.path, `${graph.dir}/rag/${namesOf(name).kebab}.rag.ts`);
  const element = `{ use: ${rag.knowledge}, mode: "tool" }`;
  return { create: rag.files, modify: [wire(agent, "Agent", "rag", element, rag.knowledge, from)] };
}
