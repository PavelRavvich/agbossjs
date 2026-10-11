import { interrupt, isGraphInterrupt } from "@langchain/langgraph";
import { redactedArguments } from "../../dto/redact.js";
import { validate } from "../../dto/schema.js";
import {
  ToolCallApprovalDecision,
  type ToolCallApprovalAsk,
} from "../../dto/standard/framework.js";
import type { PendingPause } from "../../pause/index.js";
import type { AnyTool } from "../../tools/index.js";
import type { ChannelRequest, InboundChannelAdapter } from "../../components/decorators.js";
import type { ObserverManager } from "../../core/observer-manager.js";

/**
 * How the loop gets a decision on a tool call before it runs — one call per ask. It is backed by the
 * pause seam: the run pauses, the tool's channel is asked, and `resume` brings the decision.
 */
export interface ToolCallApproval {
  readonly requestApproval: (
    ask: ToolCallApprovalAsk,
    agent: string,
    tool: AnyTool,
    run: { readonly runId: string; readonly threadId: string },
    metadata: Record<string, unknown>,
    executionContext?: unknown,
  ) => Promise<ToolCallApprovalDecision>;
}

/** Where an ask goes and how a reply comes back: the workflow's channels and their adapters. */
export interface ApprovalChannels {
  readonly dispatch?: (channelName: string, req: ChannelRequest) => Promise<void>;
  readonly adapterOf?: (channel: string) => InboundChannelAdapter | undefined;
  readonly observer?: ObserverManager;
}

interface AskContext {
  readonly ask: ToolCallApprovalAsk;
  readonly agent: string;
  readonly tool: AnyTool;
  readonly runId: string;
  readonly threadId: string;
  readonly metadata: Record<string, unknown>;
  readonly executionContext?: unknown;
}

const appStateOf = (ctx: AskContext) => ({
  runId: ctx.runId,
  threadId: ctx.threadId,
  activeNode: ctx.agent,
});

/**
 * The run just paused at the ask: the tool's channel gets the request (once per pause), its
 * arguments with the input DTO's `sensitive` fields masked — a channel shows them to people (#202).
 */
async function askChannel(channels: ApprovalChannels, ctx: AskContext): Promise<void> {
  const channel = ctx.tool.channel;
  if (channel === undefined || channels.dispatch === undefined) return;
  const shown = redactedArguments(ctx.tool.input, ctx.ask.arguments);
  await channels.observer?.onChannelStart({ name: channel, input: shown, state: appStateOf(ctx) });
  await channels.dispatch(channel, {
    runId: ctx.runId,
    agentName: ctx.agent,
    toolName: ctx.tool.name,
    toolArguments: shown,
    metadata: ctx.metadata,
    executionContext: ctx.executionContext,
  });
}

/** The reply `resume` brought, read by the channel's inbound adapter when it has one. */
async function interpretReply(
  channels: ApprovalChannels,
  ctx: AskContext,
  raw: unknown,
): Promise<unknown> {
  const channel = ctx.tool.channel;
  if (channel === undefined) return raw;
  await channels.observer?.onChannelEnd({ name: channel, update: raw, state: appStateOf(ctx) });
  const adapter = channels.adapterOf?.(channel);
  if (adapter === undefined) return raw;
  const interpreted: unknown = await adapter.interpret(raw);
  return interpreted;
}

/**
 * The pause seam as an approval: `interrupt` pauses the run at the call (the checkpoint is the
 * boundary — nothing ran before it) and the tool's channel is asked; on resume `interrupt` returns
 * the reply, which the channel's adapter interprets and which is validated like any external input.
 */
export function pauseSeamApproval(channels: ApprovalChannels = {}): ToolCallApproval {
  return {
    requestApproval: async (ask, agent, tool, run, metadata, executionContext) => {
      const ctx: AskContext = { ask, agent, tool, ...run, metadata, executionContext };
      const pending: PendingPause = {
        kind: "approval",
        agent,
        callId: ask.callId,
        tool: ask.tool,
        // what the caller and the paused-run store see: `sensitive` fields masked (#202)
        args: redactedArguments(tool.input, ask.arguments),
      };
      let raw: unknown;
      try {
        raw = interrupt<PendingPause, unknown>(pending);
      } catch (e) {
        if (isGraphInterrupt(e)) await askChannel(channels, ctx);
        throw e;
      }
      return validate(ToolCallApprovalDecision, await interpretReply(channels, ctx, raw));
    },
  };
}
