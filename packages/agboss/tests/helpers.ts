import { FakeListChatModel } from "@langchain/core/utils/testing";
import { MODEL_MAX, type AgentsConfigOf } from "../src/config/types.js";
import type { UsageRecord } from "../src/finops/usage.js";
import type { SpendLedger } from "../src/finops/ledger.js";
import type { AgentStateType } from "../src/graph/state.js";
import type { FlowStateType } from "../src/graph/flow-state.js";
import type { JevClient } from "../src/llm/jev-client.js";
import { createModelRegistry, type ModelFactory } from "../src/llm/registry.js";
import { createModelGateway, type ModelGateway } from "../src/llm/gateway.js";
import type { RunDeps } from "../src/index.js";
import type { RouteRequest } from "../src/routers/index.js";
import { flowRouterFactory } from "../src/graph/router-model.js";
import type { WorkflowLimits } from "../src/graph/settings.js";
import { usd } from "../src/units/index.js";
import { testFlow, testRouters } from "./fixtures/test-flow/test.flow.js";
import { NO_GUARDS } from "../src/guards/index.js";
import { createSqliteTernStore } from "../src/terns/index.js";
import { toolOf } from "../src/testing/index.js";
import type { AnyTool } from "../src/tools/index.js";
import { Clock } from "./fixtures/test-workflow/test.workflow.js";

export type TestAgent = "alpha" | "beta";

/** The test agents' config; their flow (`testFlow`) routes through an LLM router ("test/router"). */
export const testConfig: AgentsConfigOf<TestAgent> = {
  name: "test-bundle",
  version: "1.0.0",
  defaults: {
    models: { temperature: 0, maxTokens: MODEL_MAX, thinking: "default", cache: true },
    router: { kind: "jev", model: "typesafe/jev-test" },
    tools: { maxToolCalls: 3 },
    history: { limit: 2 },
  },
  agents: {
    alpha: {
      model: "test/alpha",
      description: "Handles alpha work",
      price: { inputPerMTok: 3, outputPerMTok: 6 },
    },
    beta: {
      model: "test/beta",
      description: "Handles beta work",
      price: { inputPerMTok: 3, outputPerMTok: 6 },
    },
  },
};

/** The test workflow's limits: $1 per run, $10 per day; steps by default ((2 + 1) × 3). */
export const testLimits: WorkflowLimits = { perRun: { cost: usd(1) }, perDay: { cost: usd(10) } };

/** Scripted responses per model slug. */
export type ModelScript = Readonly<Record<string, string[]>>;

export const fakeChatFactory =
  (script: ModelScript): ModelFactory =>
  (settings) =>
    new FakeListChatModel({ responses: script[settings.model] ?? [] });

export const unusedJevClient: JevClient = () => Promise.reject(new Error("jev not used"));

/** The default gateway over fake clients: chat models from `chatModel`, Jev from `jevClient`. */
export const fakeGateway = (
  chatModel: ModelFactory,
  jevClient: JevClient = unusedJevClient,
): ModelGateway => createModelGateway({ chatModel, jevClient });

/** In-memory ledger: starts at `spentToday`, remembers what runs record. */
export function memoryLedger(spentToday = 0): SpendLedger & { readonly recorded: UsageRecord[] } {
  const recorded: UsageRecord[] = [];
  return {
    recorded,
    spentToday: () =>
      Promise.resolve(spentToday + recorded.reduce((sum, record) => sum + record.costUsd, 0)),
    record: (_bundle, records) => {
      recorded.push(...records);
      return Promise.resolve();
    },
  };
}

/** The test flow, its routers on `chatModel` ("test/router" scripts them) and the given limits. */
export function flowDeps(
  chatModel: ModelFactory,
  limits: WorkflowLimits = testLimits,
): Pick<RunDeps<TestAgent>, "flow" | "limits" | "routers" | "routerFor"> {
  return {
    flow: testFlow,
    limits,
    routers: testRouters,
    routerFor: flowRouterFactory({
      gateway: fakeGateway(chatModel),
      chatDefaults: testConfig.defaults.models,
      chatModelSettings: (model) => ({ model, price: { inputPerMTok: 1, outputPerMTok: 2 } }),
    }),
  };
}

export function fakeDeps(
  script: ModelScript,
  ledger: SpendLedger = memoryLedger(),
): RunDeps<TestAgent> {
  const chatModel = fakeChatFactory(script);
  return {
    config: testConfig,
    registry: createModelRegistry(testConfig, fakeGateway(chatModel)),
    ...flowDeps(chatModel),
    prompts: { alpha: async () => "You are alpha.", beta: async () => "You are beta." },
    tools: libraryTool,
    ledger,
    terns: createSqliteTernStore(":memory:"),
    guards: NO_GUARDS,
  };
}

export const routeTo = (next: string, reason = "test"): string => JSON.stringify({ next, reason });

export const usageRecord = (caller: string, costUsd: number): UsageRecord => ({
  caller,
  model: "test/m",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd,
  costSource: "price-table",
});

export function baseState(overrides: Partial<AgentStateType> = {}): AgentStateType {
  return {
    task: "Do the thing",
    startInput: { text: "Do the thing" },
    history: [],
    runId: "run-test",
    next: "",
    routeReason: "",
    contributions: [],
    usage: [],
    budgetUsd: Number.POSITIVE_INFINITY,
    replyWith: "",
    finishes: {},
    guarded: "",
    approvals: [],
    summaries: [],
    payload: {},
    batchItem: undefined,
    _batchCursor: {},
    cancelRequested: false,
    batchIndex: undefined,

    ...overrides,
  };
}

/** The core's library tools by name (what agents in test configs may list). */
export function libraryTool(name: string): AnyTool {
  if (name === "current_time") return toolOf(new Clock());
  throw new Error(`Unknown tool "${name}"`);
}

/** The deps with every router request recorded (what the routers saw, in order). */
export function recordingRouters<TDeps extends RunDeps<TestAgent>>(
  deps: TDeps,
): { readonly deps: TDeps; readonly requests: RouteRequest[] } {
  const requests: RouteRequest[] = [];
  const routerFor: TDeps["routerFor"] = (loaded) => {
    const router = deps.routerFor(loaded);
    return {
      name: router.name,
      route: (request) => {
        requests.push(request);
        return router.route(request);
      },
    };
  };
  return { deps: { ...deps, routerFor }, requests };
}

/** A flow state: `baseState` plus the engine's fields, before any node ran. */
export function flowState(overrides: Partial<FlowStateType> = {}): FlowStateType {
  return {
    optionalBranches: [],
    ...baseState(),
    start: "",
    previousAgent: "",
    payload: {},
    forks: {},
    visits: {},
    steps: 0,
    path: [],
    daySpentBeforeRunUsd: null,
    lastError: null,
    ...overrides,
  };
}
