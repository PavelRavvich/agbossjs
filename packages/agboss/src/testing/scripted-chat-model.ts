import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { ResolvedModelSettings } from "../config/types.js";
import { asError, TestFailure } from "./errors.js";
import { ModelCallFailedError, type ScriptedTurn } from "./script.js";
import type { ChatLine, ComponentScript, ModelRequest, ScriptBook } from "./script-book.js";
import { extractText } from "../graph/multimodal.js";

/** Output tokens that cost `usd` at the model's output price (no price or a free model → none). */
const tokensFor = (usd: number, settings: ResolvedModelSettings): number =>
  settings.price === undefined || settings.price.outputPerMTok === 0
    ? 0
    : (usd * 1_000_000) / settings.price.outputPerMTok;

/** A model without a price reports its cost in the replyWith, as the provider would. */
const costMetadataOf = (usd: number, settings: ResolvedModelSettings) =>
  settings.price === undefined ? { usage: { cost: usd } } : {};

const usageOf = (outputTokens: number) => ({
  input_tokens: 0,
  output_tokens: outputTokens,
  total_tokens: outputTokens,
});

const lineOf = (message: BaseMessage): ChatLine => ({
  role: message.type,
  text: message.content,
});

/** What an agent sent: its system prompt, its input (the first human message), every message. */
export function chatRequestOf(messages: readonly BaseMessage[]): ModelRequest {
  const lines = messages.map(lineOf);
  return {
    kind: "chat",
    system: (() => {
      const sys = lines.find((line) => line.role === "system")?.text;
      return sys ? extractText(sys) : "";
    })(),
    input: lines.find((line) => line.role === "human")?.text ?? "",
    messages: lines,
  };
}

/** One scripted turn as the model's reply. */
function replyOf(
  turn: ScriptedTurn,
  script: ComponentScript,
  book: ScriptBook,
  settings: ResolvedModelSettings,
): AIMessage {
  switch (turn.kind) {
    case "replyWith":
      return new AIMessage({
        content: turn.text,
        usage_metadata: usageOf(tokensFor(turn.details.cost ?? 0, settings)),
        response_metadata: {
          ...costMetadataOf(turn.details.cost ?? 0, settings),
          ...(turn.details.truncated === true ? { finish_reason: "length" } : {}),
        },
      });
    case "tool-call":
      script.toolCalls.push(turn.tool);
      return new AIMessage({
        content: "",
        usage_metadata: usageOf(0),
        response_metadata: costMetadataOf(0, settings),
        tool_calls: [{ id: book.nextToolCallId(), name: turn.tool, args: { ...turn.args } }],
      });
    case "failure":
      throw new ModelCallFailedError(turn.failure, script.label);
    case "decision":
    case "decide":
      throw new TestFailure(
        "test.wrong-script",
        `${script.label} chats: script it with replyWith(…) / callTool(…), not routeTo(…) / decideWith(…)`,
      );
  }
}

/**
 * A chat model that answers by its component's script — by position, never by call order across
 * components — and records every request. Tool calling works (`createAgent` binds tools to it).
 */
export class ScriptedChatModel extends BaseChatModel {
  constructor(
    private readonly book: ScriptBook,
    private readonly key: string,
    private readonly settings: ResolvedModelSettings,
  ) {
    super({});
  }

  _llmType(): string {
    return "scripted";
  }

  override bindTools(): this {
    return this;
  }

  /** Answers by the script; a text reply streams as one token, as a streaming provider would. */
  async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const script = this.book.scriptOf(this.key);
    const req = chatRequestOf(messages);
    script.requests.push(req);
    let message: AIMessage;
    try {
      message = replyOf(script.next(req), script, this.book, this.settings);
    } catch (error) {
      if (error instanceof TestFailure) this.book.report(error);
      throw asError(error);
    }
    if (message.text !== "") await runManager?.handleLLMNewToken(message.text);
    return { generations: [{ text: message.text, message }] };
  }
}
