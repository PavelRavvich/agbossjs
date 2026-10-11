import type { Class } from "../components/injection.js";
import { componentOf } from "../components/metadata.js";
import type { ChoiceTarget } from "../graph/flow.js";
import type { ToolContext } from "../tools/index.js";
import type { Usd } from "../units/index.js";
import { TestSetupError } from "./errors.js";

import { ModelFailure } from "../models/model-failure.js";

/** How a scripted model call fails — the failures a provider's retry policy knows. */
export { ModelFailure };

/** Optional parts of a scripted text replyWith. */
export interface AnswerDetails {
  /** What the call cost (priced as output tokens of the agent's model). */
  readonly cost?: Usd;
  /** The replyWith hit the output limit (`finish_reason: "length"`). */
  readonly truncated?: boolean;
}

/** Optional parts of a scripted router decision. */
export interface DecisionDetails {
  readonly reason?: string;
  /** Probability of the choice (Jev reports one; guards read it). Default 1. */
  readonly confidence?: number;
  readonly cost?: Usd;
}

/** A scripted answer to one decision question: P(yes) (`noul`), an option (`choice`), a level's index or text (`score`). */
export type ScriptedAnswer = number | string;

/** Optional parts of a scripted decision (`decideWith`). */
export interface DecideDetails {
  /** What the decision cost (the Decisions API's `usage.cost`). */
  readonly cost?: Usd;
}

/** One scripted model turn: a text, a tool call, a router decision, a decision's answers, or a failure. */
export type ScriptedTurn =
  | { readonly kind: "replyWith"; readonly text: string; readonly details: AnswerDetails }
  | {
      readonly kind: "tool-call";
      readonly tool: string;
      readonly args: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "decision";
      readonly target: ChoiceTarget;
      readonly details: DecisionDetails;
    }
  | {
      readonly kind: "decide";
      readonly answers: Readonly<Record<string, ScriptedAnswer>>;
      readonly details: DecideDetails;
    }
  | { readonly kind: "failure"; readonly failure: ModelFailure };

/** An agent's model answers with text: `replyWith("3 jobs found", { cost: usd(0.002) })`. */
export const replyWith = (text: string, details: AnswerDetails = {}): ScriptedTurn => ({
  kind: "replyWith",
  text,
  details,
});

/** A tool class, typed by the input its `run` takes. */
export type ToolClass<TInput extends object> = Class<{
  run(input: TInput, ctx: ToolContext): Promise<unknown>;
}>;

/** The name an agent's model calls a `@Tool` / `@McpTool` class by. */
export function toolNameOf(tool: Class): string {
  const meta = componentOf(tool);
  if (meta?.kind !== "tool" && meta?.kind !== "mcp-tool") {
    throw new TestSetupError(`${tool.name} is not a @Tool or @McpTool`);
  }
  return meta.meta.name;
}

/**
 * An agent's model calls a tool: `callTool(SaveShortlist, { jobs: ["Acme"] })` — the arguments are
 * typed by the tool's input DTO (compile time) and validated by the tool when it runs.
 */
export function callTool<TInput extends object>(
  tool: ToolClass<TInput>,
  args: NoInfer<TInput>,
): ScriptedTurn {
  return {
    kind: "tool-call",
    tool: toolNameOf(tool),
    args: Object.fromEntries(Object.entries(args)),
  };
}

/** A router decides for one of its routes: `routeTo(Scout)`, `routeTo(Self)`. */
export const routeTo = (target: ChoiceTarget, details: DecisionDetails = {}): ScriptedTurn => ({
  kind: "decision",
  target,
  details,
});

/**
 * A decision model answers a judge's `ctx.model.decide`, by question id:
 * `decideWith({ grounded: 0.9, tone: "neutral", quality: 2 }, { cost: usd(0.0002) })`.
 */
export const decideWith = (
  answers: Readonly<Record<string, ScriptedAnswer>>,
  details: DecideDetails = {},
): ScriptedTurn => ({ kind: "decide", answers, details });

/** The model call fails: `failWith(ModelFailure.Timeout)`. */
export const failWith = (failure: ModelFailure): ScriptedTurn => ({ kind: "failure", failure });

/** A scripted model failure, as an agent's loop sees it. */
export class ModelCallFailedError extends Error {
  override name = "ModelCallFailedError";
  readonly failure: ModelFailure;

  constructor(failure: ModelFailure, component: string) {
    super(`scripted model failure for ${component}: ${failure}`);
    this.failure = failure;
  }
}
