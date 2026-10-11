import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

export interface ToolCallStep {
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

/** A scripted reply: plain text, or tool calls. Every reply reports 100 input / 20 output tokens. */
export type Reply = string | readonly ToolCallStep[];

const toMessage = (reply: Reply, index: number): AIMessage => {
  const usage_metadata = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
  if (typeof reply === "string") return new AIMessage({ content: reply, usage_metadata });
  return new AIMessage({
    content: "",
    usage_metadata,
    tool_calls: reply.map((step, call) => ({
      id: `call-${String(index)}-${String(call)}`,
      name: step.tool,
      args: step.args,
    })),
  });
};

/** Replies in order; records what it was sent. Supports tool calling for createAgent. */
export class ScriptedChatModel extends BaseChatModel {
  readonly sent: BaseMessage[][] = [];
  private position = 0;

  constructor(private readonly replies: readonly Reply[]) {
    super({});
  }

  _llmType(): string {
    return "scripted";
  }

  override bindTools(): this {
    return this;
  }

  _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.sent.push(messages);
    const reply = this.replies[this.position];
    if (reply === undefined) return Promise.reject(new Error("script exhausted"));
    const message = toMessage(reply, this.position);
    this.position += 1;
    return Promise.resolve({ generations: [{ text: message.text, message }] });
  }
}
