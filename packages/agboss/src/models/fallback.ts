import { costOf } from "../finops/usage.js";
import { FALLBACK_MARK, isRecord } from "../finops/fallback-mark.js";
import { priceOf, type ModelCost } from "./cost.js";

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The request body with the fallback's model in place of the primary's (`models` maps them). */
export function fallbackBody(
  body: RequestInit["body"],
  models: Readonly<Record<string, string>>,
): { readonly body: RequestInit["body"]; readonly model: string | undefined } {
  const json = typeof body === "string" ? parsed(body) : undefined;
  if (!isRecord(json) || typeof json.model !== "string") return { body, model: undefined };
  const model = models[json.model] ?? json.model;
  return { body: JSON.stringify({ ...json, model }), model };
}

const tokensOf = (usage: Record<string, unknown>) => {
  const count = (value: unknown): number => (typeof value === "number" ? value : 0);
  const details = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  return {
    inputTokens: count(usage.prompt_tokens),
    outputTokens: count(usage.completion_tokens),
    cacheReadTokens: count(details.cached_tokens),
    cacheWriteTokens: 0,
  };
};

/** `usage` with the mark and, for a fallback with a price table, the call's cost by its prices. */
function markedUsage(usage: Record<string, unknown>, model: string, cost: ModelCost) {
  const price = priceOf(cost, model);
  const priced = price === undefined ? {} : { cost: costOf(tokensOf(usage), price) };
  return { ...usage, ...priced, [FALLBACK_MARK]: { model, priced: price !== undefined } };
}

/**
 * The fallback's JSON answer, marked with the model it served and priced by its own table; any
 * other answer (an error, a stream) is returned as it came.
 */
export async function markedFallbackResponse(
  response: Response,
  model: string | undefined,
  cost: ModelCost,
): Promise<Response> {
  const type = response.headers.get("content-type") ?? "";
  if (model === undefined || !response.ok || !type.includes("application/json")) return response;
  const text = await response.text();
  const json = parsed(text);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  const init = { status: response.status, statusText: response.statusText, headers };
  if (!isRecord(json)) return new Response(text, init);
  const usage = isRecord(json.usage) ? json.usage : {};
  return new Response(JSON.stringify({ ...json, usage: markedUsage(usage, model, cost) }), init);
}
