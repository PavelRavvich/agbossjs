/**
 * Spike #113 — `judge(X).beforeCall()` against the judge's `checks`. Not framework API.
 *
 * `checks` in `@Judge({ … })` never reaches the class's type (a standard decorator cannot change it),
 * so `judge(X)` can only read what the class itself declares: the move its `judge(move)` accepts.
 * Code judges already say it (`implements JudgeHandler<ToolCallMove>`); a model judge says it by
 * extending the standard implementation (`extends ModelJudge<ToolCallMove | ToolResultMove>`).
 */
import type { Class } from "../../../src/components/injection.js";

export const JudgeInput = {
  ToolCall: "tool-call",
  ToolResult: "tool-result",
  Answer: "answer",
} as const;
export type JudgeInput = (typeof JudgeInput)[keyof typeof JudgeInput];

export interface ToolCallMove {
  readonly kind: "tool-call";
  readonly args: Readonly<Record<string, unknown>>;
}
export interface ToolResultMove {
  readonly kind: "tool-result";
  readonly result: unknown;
}
export interface AnswerMove {
  readonly kind: "answer";
  readonly text: string;
}
export type Move = ToolCallMove | ToolResultMove | AnswerMove;
export type MoveOf<K extends JudgeInput> = Extract<Move, { readonly kind: K }>;

export type JudgeVerdict = "accept" | "revise" | "reject";

export interface JudgeHandler<M extends Move> {
  judge(move: M): Promise<JudgeVerdict>;
}

/** The standard model judge; a model judge class extends it to declare what it checks. */
export class ModelJudge<M extends Move> implements JudgeHandler<M> {
  judge(move: M): Promise<JudgeVerdict> {
    return Promise.reject(new Error(`the judge's model decides on ${move.kind} moves at run time`));
  }
}

/** Property-typed (not a method) so the move's variance is checked strictly. */
interface JudgeRun<M> {
  readonly judge: (move: M) => Promise<JudgeVerdict>;
}

const judges = new WeakMap<object, readonly JudgeInput[]>();

/** `@Judge({ checks })`: the class must accept every declared kind of move. */
export function Judge<const K extends readonly JudgeInput[]>(options: { readonly checks: K }) {
  return (value: abstract new (...args: never[]) => JudgeRun<MoveOf<K[number]>>): void => {
    judges.set(value, options.checks);
  };
}

/** `@Judge` as #112 specifies it: `checks` only, any class (`class X {}`) — nothing to check against. */
export function JudgeAsSpecified(options: { readonly checks: readonly JudgeInput[] }) {
  return (value: Class): void => {
    judges.set(value, options.checks);
  };
}

/** For a judge declared the #112 way — `class X {}` + `@Judge({ checks })` — only this runtime list exists. */
export const checksOf = (judge: object): readonly JudgeInput[] => judges.get(judge) ?? [];

export type JudgePoint = "before-call" | "after-call" | "before-answer";

export interface JudgeAttachment {
  readonly judge: Class;
  readonly point: JudgePoint;
  readonly tool?: Class;
}

type Accepted<C extends Class> = InstanceType<C> extends JudgeHandler<infer M> ? M : never;

/** Type only: which moves the judge takes (a property, so it is checked strictly). */
interface Checks<M> {
  readonly checks: (move: M) => void;
}

/** Each point demands (through `this`) that the judge takes that point's move. */
export interface JudgeBuilder<M> extends Checks<M> {
  beforeCall(this: Checks<ToolCallMove>, tool?: Class): JudgeAttachment;
  afterCall(this: Checks<ToolResultMove>, tool?: Class): JudgeAttachment;
  beforeAnswer(this: Checks<AnswerMove>): JudgeAttachment;
}

interface AnyPoint {
  readonly beforeCall: (tool?: Class) => JudgeAttachment;
  readonly afterCall: (tool?: Class) => JudgeAttachment;
  readonly beforeAnswer: () => JudgeAttachment;
}

/** The loose builder: every point, checked only at startup (`judge.unsupported-input`). */
export function looseJudge(judge: Class): AnyPoint {
  const at = (point: JudgePoint, tool?: Class): JudgeAttachment =>
    tool === undefined ? { judge, point } : { judge, point, tool };
  return {
    beforeCall: (tool) => at("before-call", tool),
    afterCall: (tool) => at("after-call", tool),
    beforeAnswer: () => at("before-answer"),
  };
}

export function judge<C extends abstract new (...args: never[]) => JudgeHandler<never>>(
  value: C,
): JudgeBuilder<Accepted<C>> {
  return { checks: () => undefined, ...looseJudge(value) };
}

const POINT_INPUT: Readonly<Record<JudgePoint, JudgeInput>> = {
  "before-call": JudgeInput.ToolCall,
  "after-call": JudgeInput.ToolResult,
  "before-answer": JudgeInput.Answer,
};

/** The assembly check (startup): an attachment at a point the judge does not declare. */
export function assertAttachable(attachment: JudgeAttachment): void {
  if (!checksOf(attachment.judge).includes(POINT_INPUT[attachment.point])) {
    throw new Error(
      `judge.unsupported-input: ${attachment.judge.name} cannot be attached at ${attachment.point}`,
    );
  }
}
