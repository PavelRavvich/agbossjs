import { MemorySaver } from "@langchain/langgraph";
import type { Mocked } from "vitest";
import { buildApp, type AppOptions, type BuiltApp } from "../app/create-app.js";
import { createMemoryPausedRunRepository } from "../app/paused-runs.js";
import { flowNodesByKey } from "../app/result.js";
import { workflowTreeOf } from "../components/nested-modules.js";
import { workflowOf } from "../components/assemble.js";
import type { Environment } from "../environments/define.js";
import {
  environmentFor,
  TEST_DEFAULT_ENVIRONMENTS,
  workflowFileOf,
  type EnvironmentSelection,
} from "../environments/load.js";
import type { Class } from "../components/injection.js";
import type { McpServerClient, ServerTools } from "../components/mcp-client.js";
import { createMemoryLedger } from "../finops/ledger.js";
import { isNamedNode, labelOf, type FlowNode } from "../graph/flow.js";
import { nodeInfoOf } from "../graph/node-kind.js";
import { createSqliteTernStore } from "../terns/index.js";
import { createTestClock } from "./clock.js";
import { TestSetupError } from "./errors.js";
import { nodeNameOf } from "./failure-facts.js";
import { McpStubs, stubbedMcpConnect, type McpStub } from "./mcp-stubs.js";
import { mockInstanceOf } from "./mocks.js";
import { ScriptBook, type ModelScript } from "./script-book.js";
import {
  createScriptedGateway,
  judgeScriptKeyOf,
  routerKeyOf,
  type ModelTarget,
} from "./scripted-gateway.js";
import { mcpServersOf, usedComponentsOf } from "./workflow-parts.js";
import { createVcrGateway, type VcrConfig } from "./vcr.js";

/** What `testWith` takes besides the workflow. */
export interface TestWithOptions extends EnvironmentSelection {
  /** Components kept real: MCP server classes connect through their configured transports. */
  readonly real?: readonly Class[];
  /** Hosts a test may reach (`localhost` covers every loopback address); everything else is blocked. */
  readonly allowNetwork?: readonly string[];
  /**
   * Models answer from a recorded cassette instead of scripts: recorded once with real models,
   * replayed in every later run (REPLAY by default under `CI`: no key, no network).
   */
  readonly vcr?: VcrConfig;
}

/** The process env without tracing keys: tests never export traces. */
const testEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("LANGFUSE_")));

/** The script key of a flow node that calls a model (an agent or a router). */
function scriptKeyOf(target: FlowNode): string | undefined {
  const kind = nodeInfoOf(isNamedNode(target) ? target.use : target)?.kind;
  if (kind === "agent") return `agent:${nodeNameOf(target)}`;
  if (kind === "router") return routerKeyOf(nodeNameOf(target));
  return undefined;
}

/** The names of the MCP servers kept real; anything else in `real` is a setup error. */
function realServers(servers: ReadonlyMap<Class, string>, real: readonly Class[]): Set<string> {
  return new Set(
    real.map((cls) => {
      const name = servers.get(cls);
      if (name === undefined) {
        throw new TestSetupError(`real: [${cls.name}] — not an MCP server of this workflow`);
      }
      return name;
    }),
  );
}

/**
 * Everything one test owns: scripts, mocks, MCP stubs, a controllable clock, deterministic ids and
 * memory stores (checkpoints, spend, Terns, paused runs) — shared by every app of the test, so a
 * run resumed after `recoverApp()` continues; never shared between tests.
 */
export class TestEnvironment {
  readonly book = new ScriptBook();
  readonly clock = createTestClock();
  readonly mcp = new McpStubs(this.book);
  readonly #mocks = new Map<Class, unknown>();
  readonly #apps: BuiltApp[] = [];
  readonly #nodes: ReadonlySet<FlowNode>;
  readonly #judges: ReadonlySet<string>;
  readonly #options: AppOptions;
  #threads = 0;
  #runs = 0;
  readonly #terns = createSqliteTernStore(":memory:", this.clock.now, () => {
    this.#threads += 1;
    return `thread-${String(this.#threads)}`;
  });

  private constructor(
    readonly workflow: Class,
    nodes: readonly FlowNode[],
    options: TestWithOptions,
    assembled: import("../workflow.js").AssembledWorkflow,
    environment: Environment | undefined,
  ) {
    this.#nodes = new Set(nodes);
    this.#judges = new Set(Object.keys(assembled.config.judges ?? {}));
    for (const node of nodes) {
      const key = scriptKeyOf(node);
      if (key !== undefined) this.book.name(key, labelOf(node));
    }
    const servers = mcpServersOf(workflow);
    const real = realServers(servers, options.real ?? []);
    const labels = new Map([...servers].map(([cls, name]) => [name, cls.name] as const));
    this.#options = {
      processEnv: testEnv(),
      ...(environment === undefined ? {} : { environment }),
      gateway: options.vcr
        ? createVcrGateway(assembled, options.vcr, testEnv(), (failure) =>
            this.book.report(failure),
          )
        : createScriptedGateway(this.book),
      connectMcp: stubbedMcpConnect(this.mcp, labels, real),
      stores: {
        checkpointer: new MemorySaver(),
        ledger: createMemoryLedger(this.clock.now),
        terns: this.#terns,
      },
      clock: this.clock.now,
      newRunId: () => {
        this.#runs += 1;
        return `run-${String(this.#runs)}`;
      },
      container: { overrides: this.#mocks },
      pausedRuns: createMemoryPausedRunRepository(),
    };
  }

  /**
   * Assembles the workflow and resolves its environment once up front: every assembly error, a
   * missing environment or variable fails the test before it runs.
   */
  static async of(workflow: Class, options: TestWithOptions = {}): Promise<TestEnvironment> {
    const assembled = await workflowOf(workflow);
    const environment = await environmentFor(
      workflowFileOf(workflow),
      options,
      testEnv(),
      TEST_DEFAULT_ENVIRONMENTS,
    );
    return new TestEnvironment(
      workflow,
      // the nodes of the workflow and of every workflow it nests or compensates with
      workflowTreeOf(workflow).flatMap(({ meta }) => [...flowNodesByKey(meta.flow).values()]),
      options,
      assembled,
      environment,
    );
  }

  /** A new app over this test's state (the real container and graph, everything external replaced). */
  async newApp(): Promise<BuiltApp> {
    const built = await buildApp(await workflowOf(this.workflow), this.#options);
    this.#apps.push(built);
    return built;
  }

  mockLlm(target: ModelTarget): ModelScript {
    const label = typeof target === "function" ? target.name : labelOf(target);
    const judge = judgeScriptKeyOf(target, this.#judges);
    if (judge !== undefined) {
      this.book.name(judge, label);
      return this.book.scriptOf(judge);
    }
    const node = [...this.#nodes].find((item) => item === target);
    const key = node === undefined ? undefined : scriptKeyOf(node);
    if (key === undefined) {
      throw new TestSetupError(`mockLlm(${label}): not an agent, router or judge of this workflow`);
    }
    return this.book.scriptOf(key);
  }

  mockOf<T>(cls: Class<T>): Mocked<T> {
    const existing = this.#mocks.get(cls);
    // the mock stored for this class was created by mockInstanceOf(cls) below
    if (existing !== undefined) return existing as Mocked<T>;
    if (!usedComponentsOf(this.workflow).has(cls)) {
      throw new TestSetupError(`mockOf(${cls.name}): not a component of this workflow`);
    }
    if (this.#apps.length > 0) {
      throw new TestSetupError(
        `mockOf(${cls.name}) after the app started: call it before the first app.execute(…)`,
      );
    }
    const mock = mockInstanceOf(cls);
    this.#mocks.set(cls, mock);
    return mock;
  }

  mcpOf<TServer extends McpServerClient<ServerTools>>(server: new () => TServer): McpStub<TServer> {
    const name = mcpServersOf(this.workflow).get(server);
    if (name === undefined) {
      throw new TestSetupError(`mcpOf(${server.name}): not an MCP server of this workflow`);
    }
    return this.mcp.stubOf<TServer>(name);
  }

  /** Closes every app (their `onStop` hooks) and the test's stores. */
  async close(): Promise<void> {
    try {
      for (const built of this.#apps) await built.app.close();
    } finally {
      this.#terns.close();
    }
  }
}
