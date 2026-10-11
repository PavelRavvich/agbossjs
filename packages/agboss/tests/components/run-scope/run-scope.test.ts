import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type AppOptions } from "../../../src/app/create-app.js";
import { createMemoryLedger } from "../../../src/finops/ledger.js";
import { createSqliteTernStore } from "../../../src/terns/index.js";
import {
  callTool,
  failWith,
  ModelFailure,
  replyWith,
  testWith,
} from "../../../src/testing/index.js";
import { ScriptBook } from "../../../src/testing/script-book.js";
import { createScriptedGateway } from "../../../src/testing/scripted-gateway.js";
import {
  barrier,
  GreenhouseJobs,
  LeakyJobs,
  log,
  searchWorkflow,
  SearchSession,
  Start,
} from "./fixture.js";

beforeEach(() => {
  log.length = 0;
  barrier.size = 1;
});

const { workflow, agent: Scout } = searchWorkflow(GreenhouseJobs);
const search = testWith(workflow);

/** The tool results of the run, as the tool returned them (`tool-1 session-1 catalog-1 saw a,b`). */
const answers = (): string[] => log.filter((line) => line.startsWith("tool-"));

describe("#184 AC1: a run-scoped tool gets a fresh instance per run", () => {
  search(
    "two runs: each its own tool and session, the app-scoped catalog shared",
    async ({ app, mockLlm }) => {
      mockLlm(Scout).thenReturn(
        callTool(GreenhouseJobs, { text: "a" }),
        callTool(GreenhouseJobs, { text: "b" }),
        replyWith("first done"),
        callTool(GreenhouseJobs, { text: "c" }),
        replyWith("second done"),
      );

      await app.execute(Start, { text: "thread 1" });
      await app.execute(Start, { text: "thread 2" });

      const [first, second, third] = answers();
      // one instance for the whole run: the second call sees the first call's data
      expect(first?.split(" saw ")[1]).toBe("a");
      expect(second?.split(" saw ")[1]).toBe("a,b");
      expect(second?.split(" ").slice(0, 2)).toEqual(first?.split(" ").slice(0, 2));
      // run 2 never sees run 1's data, and gets new instances
      expect(third?.split(" saw ")[1]).toBe("c");
      expect(third?.split(" ")[0]).not.toBe(first?.split(" ")[0]);
      expect(third?.split(" ")[1]).not.toBe(first?.split(" ")[1]);
      // the app-scoped dependency is one for both runs
      expect(new Set(answers().map((line) => line.split(" ")[2])).size).toBe(1);
    },
  );

  search("two concurrent runs never share a run-scoped instance", async ({ app, mockLlm }) => {
    barrier.size = 2; // each tool call waits until both runs are inside the tool
    mockLlm(Scout).thenReturn(
      callTool(GreenhouseJobs, { text: "x" }),
      callTool(GreenhouseJobs, { text: "y" }),
      replyWith("done"),
      replyWith("done"),
    );

    await Promise.all([
      app.execute(Start, { text: "user 1" }),
      app.execute(Start, { text: "user 2" }),
    ]);

    const saw = answers().map((line) => line.split(" saw ")[1]);
    expect(saw.sort()).toEqual(["x", "y"]);
    const [one, two] = answers().map((line) => line.split(" ").slice(0, 2).join(" "));
    expect(one).not.toBe(two);
    expect(log.filter((line) => line.startsWith("destroyed:"))).toHaveLength(4);
  });

  search(
    "onDestroy runs when the run ends, dependants first — also when the run fails",
    async ({ app, mockLlm }) => {
      mockLlm(Scout).thenReturn(
        callTool(GreenhouseJobs, { text: "a" }),
        replyWith("done"),
        callTool(GreenhouseJobs, { text: "b" }),
        failWith(ModelFailure.ServerError),
      );

      await app.execute(Start, { text: "ok" });
      const afterFirst = log.filter((line) => line.startsWith("destroyed:"));
      await expect(app.execute(Start, { text: "fails" })).rejects.toThrow();

      const destroyed = log.filter((line) => line.startsWith("destroyed:"));
      expect(afterFirst).toHaveLength(2);
      expect(afterFirst[0]).toMatch(/^destroyed:tool-/);
      expect(afterFirst[1]).toMatch(/^destroyed:session-/);
      expect(destroyed).toHaveLength(4);
      expect(destroyed.slice(2).every((line) => !afterFirst.includes(line))).toBe(true);
    },
  );

  search("a tool slice call is one run of its own", async ({ app }) => {
    const tool = app.tool(GreenhouseJobs);

    await tool.invoke({ text: "a" });
    await tool.invoke({ text: "b" });

    expect(answers().map((line) => line.split(" saw ")[1])).toEqual(["a", "b"]);
    expect(log.filter((line) => line.startsWith("destroyed:"))).toHaveLength(4);
  });
});

/** Everything external given: scripted models, memory stores. */
const offline = (book: ScriptBook): AppOptions => ({
  processEnv: {},
  gateway: createScriptedGateway(book),
  stores: { terns: createSqliteTernStore(":memory:"), ledger: createMemoryLedger() },
});

describe("#184: scope rules at createApp", () => {
  it("an app-scoped tool depending on a run-scoped service fails assembly", async () => {
    const leaky = searchWorkflow(LeakyJobs).workflow;

    await expect(createApp(leaky, offline(new ScriptBook()))).rejects.toThrow(
      "[di.scope-mismatch] LeakyJobs (app) → SearchSession (run)",
    );
  });

  it("a run-scoped component used outside a run says it exists only during one", async () => {
    const app = await createApp(workflow, offline(new ScriptBook()));
    const session = app.resolve(SearchSession);

    expect(() => session.seen).toThrow(
      '[di.run-scope-outside-run] SearchSession is run-scoped (scope: "run")',
    );
    await app.close();
  });
});
