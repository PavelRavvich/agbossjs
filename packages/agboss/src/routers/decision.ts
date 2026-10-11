import { z } from "zod";
import type { RouterDecision } from "./types.js";

const DecisionSchema = z.object({ next: z.string(), reason: z.string().default("") });
const CODE_FENCE = /^```(?:json)?\s*|\s*```$/g;

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/** Raw LLM router output, read: a valid decision, a decision for an unknown option, or garbage. */
export type ParsedDecision =
  | { readonly kind: "valid"; readonly decision: RouterDecision }
  | { readonly kind: "unknown-option"; readonly option: string }
  | { readonly kind: "invalid" };

/** Reads raw LLM router output; only a known option is a valid decision. */
export function readRouterDecision(
  text: string,
  allowedOptions: ReadonlySet<string>,
): ParsedDecision {
  const parsed = DecisionSchema.safeParse(parseJson(text.trim().replace(CODE_FENCE, "")));
  if (!parsed.success) return { kind: "invalid" };
  if (!allowedOptions.has(parsed.data.next))
    return { kind: "unknown-option", option: parsed.data.next };
  return { kind: "valid", decision: parsed.data };
}
