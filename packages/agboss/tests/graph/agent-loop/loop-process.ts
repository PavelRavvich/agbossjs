/**
 * A separate process for the kill-and-resume tests:
 * `node --import tsx loop-process.ts <dir> <start|resume|recover> <approval|parallel>`.
 * Effects and model calls are appended to files in <dir>, so they add up across processes; the
 * checkpoints live in <dir>/checkpoints.json.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../src/tools/index.js";
import { FileCheckpointSaver } from "./file-checkpointer.js";
import {
  replyWith,
  callTools,
  decision,
  harness,
  read,
  repoTools,
  runLoop,
  startInput,
  write,
  type ScriptedMove,
} from "./fixtures.js";

const Args = z.tuple([
  z.string(),
  z.enum(["start", "resume", "recover"]),
  z.enum(["approval", "parallel"]),
]);
const [dir, mode, scenario] = Args.parse(process.argv.slice(2));
const THREAD = "run-1";

const log = (effect: string): void => {
  appendFileSync(join(dir, "effects.log"), `${effect}\n`);
};

/** Hangs as long as SLOW_MS says: long in the process that gets killed, short after. */
const slowStep = defineTool({
  name: "slow_step",
  description: "A slow step",
  input: z.object({}),
  output: z.string(),
  timeoutMs: 120_000,
  run: async (_input, ctx) => {
    log(`slow started ${ctx.callId}`);
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.SLOW_MS ?? "1")));
    log(`slow finished ${ctx.callId}`);
    return "slow done";
  },
});

const scripts: Record<typeof scenario, readonly ScriptedMove[]> = {
  approval: [
    callTools(read("r1", "a.ts")),
    callTools(write("w1", "a.ts", "new")),
    replyWith("written"),
  ],
  parallel: [
    callTools(read("fast", "fast.ts"), { id: "slow", name: "slow_step", args: {} }),
    replyWith("both done"),
  ],
};

const { graph } = harness(
  {
    moves: scripts[scenario],
    log,
    tools: (effect) => [...repoTools(effect), slowStep],
    onModelCall: (move) => {
      appendFileSync(join(dir, "model-calls.log"), `${String(move)}\n`);
    },
  },
  new FileCheckpointSaver(join(dir, "checkpoints.json")),
);

const input =
  mode === "start"
    ? startInput()
    : mode === "resume"
      ? decision({ approved: true, by: "lead" })
      : null;

process.stdout.write(`${JSON.stringify(await runLoop(graph, input, THREAD))}\n`);
// a paused run waits for its decision: the process stays up until it is killed
if (mode === "start") setInterval(() => undefined, 60_000);
