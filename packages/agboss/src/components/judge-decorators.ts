import type { BaseMessageLike } from "@langchain/core/messages";
import type { AnswersOf, DecisionQuestions, DecisionRequest } from "../llm/decisions.js";
import { recordComponent } from "./metadata.js";
import type { ResolvedAll, Scoped, Token } from "./injection.js";

/** `@Judge` — a quality gate of an agent's reply, with the model it judges with. */
export interface JudgeMeta {
  /** Unique in the workflow: the judge's settings key (`judges.<name>`) and its cost caller (`judge:<name>`). */
  readonly name: string;
  /**
   * The judge's own model, required (`judge.no-model`): a chat model (`ctx.model.invoke`) or a
   * decision model such as `openai/gpt-6-luna-decisions` or `typesafe/jev-1.13` (`ctx.model.decide`).
   */
  readonly model: string;
  readonly description?: string;
}

/** The judge's model, through the model gateway: every call is in the run's cost report. */
export interface JudgeModel {
  /** The model id (`@Judge({ model })`). */
  readonly model: string;
  /** One chat call; returns the reply's text. On a decision model: `ModelKindError`. */
  readonly invoke: (input: string | readonly BaseMessageLike[]) => Promise<string>;
  /**
   * One decision (questions from `Decision.choice / noul / score`), its answers typed by them. On a
   * chat model: `ModelKindError`.
   */
  readonly decide: <const Q extends DecisionQuestions>(
    request: DecisionRequest<Q>,
  ) => Promise<AnswersOf<Q>>;
}

/** What a judge sees besides the reply. */
export interface JudgeContext {
  /** The agent whose reply is judged. */
  readonly agent: string;
  readonly runId: string;
  /** The run's task (the workflow start's text). */
  readonly task: string;
  /** Retries so far: 0 for the agent's first reply. */
  readonly attempt: number;
  readonly model: JudgeModel;
}

/** A judge's verdict: a failed one sends `feedback` back to the agent for its retry. */
export interface JudgeVerdict {
  readonly passed: boolean;
  readonly feedback?: string;
  readonly metrics?: Readonly<Record<string, number | string | boolean>>;
}

/** What a `@Judge` class implements. */
export interface JudgeHandler {
  judge(reply: string, ctx: JudgeContext): Promise<JudgeVerdict>;
}

/**
 * A quality gate of an agent's reply (`@Agent({ judges: [...], maxRetries })`), created by the
 * workflow's container with its `deps`; its model calls go through the model gateway.
 */
export function Judge<const D extends readonly Token[] = []>(
  options: JudgeMeta & { readonly deps?: D } & Scoped,
) {
  return <C extends new (...args: ResolvedAll<D>) => JudgeHandler>(value: C): C => {
    recordComponent(
      value,
      { kind: "judge", meta: { ...options, deps: options.deps ?? [] } },
      options.scope,
    );
    return value;
  };
}
