// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { input, select } from "@inquirer/prompts";
import { namesOf } from "./names.js";
import type { AgentSpec, McpSpec, WorkflowSpec } from "./plan.js";

async function askAgents(): Promise<AgentSpec[]> {
  const agents: AgentSpec[] = [];
  for (;;) {
    const name = (
      await input({
        message:
          agents.length === 0 ? "First agent's name:" : "Next agent's name (empty to finish):",
      })
    ).trim();
    if (name === "") {
      if (agents.length > 0) return agents;
      continue;
    }
    const description = await input({
      message: `What does ${name} do?`,
      default: `${namesOf(name).title} (TODO: describe the role)`,
    });
    const tools = await input({ message: `${name}'s tools (comma-separated, empty for none):` });
    agents.push({
      name,
      description,
      tools: tools
        .split(",")
        .map((t: string) => t.trim())
        .filter((t: string) => t !== ""),
    });
  }
}

async function askMcp(workflow: string): Promise<McpSpec> {
  const kind = await select({
    message: "An MCP server?",
    choices: [
      { name: "none", value: "none" },
      { name: "filesystem — read files in a folder", value: "filesystem" },
      { name: "my own command", value: "command" },
    ],
  });
  if (kind === "filesystem")
    return {
      kind,
      name: `${workflow} files`,
      dir: await input({ message: "Folder (absolute path):" }),
    };
  if (kind === "command") {
    const command = await input({ message: "Command that starts the server:" });
    return {
      kind,
      name: `${workflow} server`,
      command,
      tool: await input({ message: "One of its tools, by name:" }),
    };
  }
  return { kind: "none" };
}

/** The questionnaire (structure only) for whatever the flags did not answer. */
export async function askMissing(
  partial: Partial<WorkflowSpec> & { name: string },
): Promise<WorkflowSpec> {
  const agents = partial.agents ?? (await askAgents());
  const mcp = partial.mcp ?? (await askMcp(partial.name));
  const ragChoice =
    partial.agents === undefined
      ? await select({
          message: "A knowledge base?",
          choices: [
            { name: "none", value: "none" },
            { name: "notes in a folder (full-text search)", value: "notes" },
          ],
        })
      : "none";
  const rag =
    partial.rag ??
    (ragChoice === "notes"
      ? {
          name: `${partial.name} notes`,
          folder: await input({ message: "Folder:", default: "notes" }),
        }
      : undefined);
  return { name: partial.name, agents, mcp, rag };
}
