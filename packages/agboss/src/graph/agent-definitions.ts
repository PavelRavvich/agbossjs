import type { PromptInput } from "../components/prompt-input.js";
import type { AgentSettingsOf, AgentsConfigOf } from "../config/types.js";
import { resolveAgentLimits, type AgentDefinition, type AgentJudge } from "./agent-loop/index.js";
import type { GraphDeps } from "./deps.js";

export class MissingAgentPromptError extends Error {
  override name = "MissingAgentPromptError";
}

/** A wiring bug: an agent names a judge the app did not create. */
export class MissingJudgeError extends Error {
  override name = "MissingJudgeError";
}

/** Summaries a reader sees by default: defaults.history.summaries, else compaction.keep, else none. */
export const defaultSummaries = <TName extends string>(config: AgentsConfigOf<TName>): number =>
  config.defaults.history.summaries ?? config.compaction?.keep ?? 0;

/** An agent's limits and memory with defaults applied. */
const limitsOf = <TName extends string>(
  agent: AgentSettingsOf<string> | undefined,
  config: AgentsConfigOf<TName>,
): Pick<AgentDefinition, "limits" | "historyLimit" | "summariesLimit"> => ({
  limits: resolveAgentLimits(agent?.maxToolCalls, config.defaults.tools?.maxToolCalls).limits,
  historyLimit: agent?.historyLimit ?? config.defaults.history.limit,
  summariesLimit: agent?.historySummaries ?? defaultSummaries(config),
});

/** An agent's judges (`agents.<name>.judges`): each one's instance and its own model. */
function judgesOf<TName extends string>(
  agent: AgentSettingsOf<string> | undefined,
  deps: GraphDeps<TName>,
): Pick<AgentDefinition, "judges" | "maxRetries"> {
  const judges = (agent?.judges ?? []).map((name): AgentJudge => {
    const handler = deps.judges?.get(name);
    const binding = deps.registry.judges.get(name);
    if (handler === undefined || binding === undefined) {
      throw new MissingJudgeError(`Judge "${name}" has no instance or no model`);
    }
    return { name, handler, binding };
  });
  return { judges, maxRetries: agent?.maxRetries ?? 0 };
}

/** Every configured agent with its model, prompt, tools, limits, knowledge and judges. */
export function agentDefinitions<TName extends string>(
  deps: GraphDeps<TName>,
): ReadonlyMap<string, AgentDefinition> {
  const prompts = new Map(Object.entries(deps.prompts));
  const settings = new Map<string, AgentSettingsOf<string>>(Object.entries(deps.config.agents));
  const definitions = new Map<string, AgentDefinition>();
  for (const [name, binding] of deps.registry.agents) {
    const instructions = prompts.get(name);
    if (instructions === undefined) throw new MissingAgentPromptError(`No prompt for ${name}`);
    const agent = settings.get(name);
    const memory = deps.memory?.get(name);
    definitions.set(name, {
      name,
      binding,
      instructions: instructions as PromptInput,
      tools: (agent?.tools ?? []).map(deps.tools),
      ...limitsOf(agent, deps.config),
      ...judgesOf(agent, deps),
      knowledge: deps.knowledge?.(name) ?? [],
      ...(memory === undefined ? {} : { memory }),
    });
  }
  return definitions;
}
