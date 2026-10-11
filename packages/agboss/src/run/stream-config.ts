import type { Serialized } from "@langchain/core/load/serializable";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { QuorumManager } from "../concurrency/quorum-manager.js";
import { newRunContext, type RunContext } from "../core/run-context.js";
import { runConfig } from "./paused.js";
import type { RunDeps, RunOptions, RunStreamEvent } from "./types.js";

class StreamingCallbackHandler extends BaseCallbackHandler {
  name = "StreamingCallbackHandler";
  constructor(private readonly onStream: (event: RunStreamEvent) => void) {
    super();
  }
  override handleLLMNewToken(token: string) {
    this.onStream({ kind: "textDelta", delta: token });
  }
  override handleToolStart(tool: Serialized, input: string) {
    this.onStream({ kind: "toolCall", tool: tool.id.at(-1) ?? "unknown", args: input });
  }
}

/** What a run streams with besides its options: its ids and the quorum votes it keeps. */
export interface RunIdentity {
  readonly threadId: string;
  readonly runId: string;
  readonly quorumManager: QuorumManager;
  /** The start's validated input (`ctx.run.input`). */
  readonly input?: Readonly<Record<string, unknown>> | undefined;
}

/** The run's `RunContext`: built once here, read by every node through `configurable.run`. */
const runContextOf = (identity: RunIdentity, options: RunOptions): RunContext =>
  newRunContext({
    runId: identity.runId,
    threadId: identity.threadId,
    signal: options.signal,
    metadata: options.metadata,
    owner: options.owner,
    input: identity.input,
  });

/**
 * Stream config: checkpoint thread = run id, the run's context and services, every step
 * checkpointed before the next one starts (`durability: "sync"` — what a resume after a crash
 * continues from); tracing callbacks when on, token streaming when `onStream` is given.
 */
export function streamConfig<TName extends string>(
  deps: RunDeps<TName>,
  identity: RunIdentity,
  options: RunOptions = {},
): ReturnType<typeof runConfig> & {
  streamMode: "values";
  durability: "sync";
  runName: string;
  callbacks: BaseCallbackHandler[];
  signal?: AbortSignal;
} {
  const { threadId, runId, quorumManager } = identity;
  const callbacks = deps.tracing?.callbacks({ bundle: deps.config.name, threadId, runId }) ?? [];
  if (options.onStream !== undefined) {
    callbacks.push(new StreamingCallbackHandler(options.onStream));
  }
  const run = runContextOf(identity, options);
  const services = { run, executionContext: options.executionContext, quorumManager };
  return {
    ...runConfig(runId, services, options.configurable),
    streamMode: "values",
    durability: "sync",
    runName: deps.config.name,
    callbacks,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}
