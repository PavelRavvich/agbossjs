import { FakeListChatModel } from "@langchain/core/utils/testing";
import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import type { AgentsConfigOf } from "../../../src/config/types.js";
import { WorkflowStartText, WorkflowFinishText } from "../../../src/dto/index.js";
import { WorkflowFinish } from "../../../src/graph/workflow-finish.decorator.js";
import { WorkflowStart } from "../../../src/graph/workflow-start.decorator.js";
import { from, type Flow } from "../../../src/graph/flow.js";
import { Router } from "../../../src/graph/router.decorator.js";
import { flowRouterFactory } from "../../../src/graph/router-model.js";
import { NO_GUARDS, type GuardSet } from "../../../src/guards/index.js";
import type { RunDeps } from "../../../src/index.js";
import { createModelRegistry } from "../../../src/llm/registry.js";

import type { KnowledgeSource } from "../../../src/rag/types.js";
import { createSqliteTernStore } from "../../../src/terns/index.js";
import { defineTool } from "../../../src/tools/index.js";
import { usd } from "../../../src/units/index.js";
import { ScriptedChatModel, type Reply } from "../../fakes/scripted-model.js";
import { fakeGateway, memoryLedger, testConfig } from "../../helpers.js";
import { testNode } from "./nodes.js";

@WorkflowStart({
  name: "chat",
  description: "A message from the job seeker",
  input: WorkflowStartText,
})
class ChatWorkflowStart {
  declare readonly input: WorkflowStartText;
}

@testNode("agent", "profiler")
class Profiler {}

@testNode("agent", "scout")
class Scout {}

@testNode("agent", "shortlist")
class Shortlist {}

@WorkflowFinish({ name: "chat", description: "The replyWith", output: WorkflowFinishText })
class ChatWorkflowFinish {}

/** job-scout's router, on a scripted chat model ("test/router") instead of Jev. */
@Router({
  name: "main",
  description: "Sends the job seeker's message to the right agent, or sends the replyWith",
  prompt: "Pick who handles the job seeker's message.",
  model: "test/router",
  maxVisits: 3,
  routes: [
    { prompt: "Reading the resume and proposing a search brief", target: Profiler },
    { prompt: "Finding and ranking jobs", target: Scout },
    { prompt: "Saving chosen jobs to the shortlist, or showing it", target: Shortlist },
    { prompt: "The last replyWith fully covers the message", target: ChatWorkflowFinish },
  ],
})
class MainRouter {}

/** The job-scout flow (#116 approved shape) over test nodes. */
export const jobScoutFlow: Flow = [
  from(ChatWorkflowStart).next(MainRouter),
  from(MainRouter).routes(),
  from(Profiler, Scout, Shortlist).next(MainRouter),
];

type JobScoutAgent = "profiler" | "scout" | "shortlist";

const price = { inputPerMTok: 3, outputPerMTok: 6 };
const agent = (model: string, description: string) => ({ model, description, price });

const config: AgentsConfigOf<JobScoutAgent> = {
  ...testConfig,
  name: "job-scout",
  compaction: { every: 2, keep: 5, model: { model: "test/compactor", price } },
  agents: {
    profiler: agent("test/profiler", "Reads the resume"),
    scout: agent("test/scout", "Finds jobs"),
    shortlist: { ...agent("test/shortlist", "Saves jobs"), tools: ["save_shortlist"] },
  },
};

/** What the scripted job-scout run is given: replies per model, guards, knowledge. */
export interface JobScoutScript {
  readonly router: readonly string[];
  readonly agents: Partial<Record<JobScoutAgent, readonly Reply[]>>;
  readonly guards?: GuardSet;
  readonly knowledge?: readonly KnowledgeSource[];
}

/** RunDeps of the job-scout shape: a pause seam, a shortlist write tool, compaction, $0.10 / $1. */
export interface JobScoutRun {
  readonly deps: RunDeps<JobScoutAgent>;
  /** Jobs the shortlist tool saved. */
  readonly saved: string[];
  readonly ledger: ReturnType<typeof memoryLedger>;
  /** The agents' scripted models by model id (what they were sent). */
  readonly models: ReadonlyMap<string, ScriptedChatModel>;
}

export function jobScoutDeps(script: JobScoutScript): JobScoutRun {
  const saved: string[] = [];
  const models = new Map(
    Object.entries(script.agents).map(([name, replies]) => [
      `test/${name}`,
      new ScriptedChatModel(replies),
    ]),
  );
  const router = new FakeListChatModel({ responses: [...script.router] });
  const compactor = new FakeListChatModel({ responses: ["S1", "S2", "S3"] });
  const chatModel = (settings: { readonly model: string }) =>
    settings.model === "test/router" ? router : (models.get(settings.model) ?? compactor);
  const saveShortlist = defineTool({
    name: "save_shortlist",
    description: "Save jobs",
    channel: "terminal",
    input: z.object({ jobs: z.array(z.string()) }),
    output: z.string(),
    run: ({ jobs }) => {
      saved.push(...jobs);
      return Promise.resolve(`saved ${String(jobs.length)}`);
    },
  });
  const ledger = memoryLedger();
  const deps: RunDeps<JobScoutAgent> = {
    config,
    registry: createModelRegistry(config, fakeGateway(chatModel)),
    prompts: {
      profiler: async () => "You profile.",
      scout: async () => "You scout.",
      shortlist: async () => "You save.",
    },
    tools: () => saveShortlist,
    guards: script.guards ?? NO_GUARDS,
    pause: { checkpointer: new MemorySaver() },
    knowledge: (name) => (name === "scout" ? (script.knowledge ?? []) : []),
    flow: jobScoutFlow,
    limits: { perRun: { steps: 12, cost: usd(0.1) }, perDay: { cost: usd(1) } },
    routers: [],
    routerFor: flowRouterFactory({
      gateway: fakeGateway(chatModel),
      chatDefaults: config.defaults.models,
      chatModelSettings: (model) => ({ model, price: { inputPerMTok: 1, outputPerMTok: 2 } }),
    }),
    ledger,
    terns: createSqliteTernStore(":memory:"),
  };
  return { deps, saved, ledger, models };
}
