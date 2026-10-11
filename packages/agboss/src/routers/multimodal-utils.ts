import type { ContentBlock, MessageContent } from "@langchain/core/messages";

/** Extracts all text from a multimodal content, ignoring images. */
export function extractText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** Merges string with multimodal content. */
export function mergeTextWithContent(prefix: string, content: MessageContent): MessageContent {
  if (typeof content === "string") return prefix + content;
  const blocks: ContentBlock[] = [];
  if (prefix.length > 0) blocks.push({ type: "text", text: prefix });
  blocks.push(...content);
  return blocks;
}
