/**
 * Spike #113, item 4 — `judge(X).beforeCall()` rejects a point that is not in the judge's `checks`.
 * As specified in #112 (`class X {}` + `@Judge({ checks })`) this is a startup check only; once the
 * class declares its moves in its type, it is a compile error. `@ts-expect-error` lines are verified by `tsc`.
 */
import { describe, expect, it } from "vitest";
import {
  Judge,
  JudgeAsSpecified,
  JudgeInput,
  ModelJudge,
  assertAttachable,
  judge,
  looseJudge,
  type JudgeHandler,
  type JudgeVerdict,
  type ToolCallMove,
  type ToolResultMove,
} from "./judge.js";

/** #112 as written: the class is empty, `checks` lives only in the decorator. */
@JudgeAsSpecified({ checks: [JudgeInput.Answer] })
class AnswerCompletenessAsSpecified {}

/** Correction: a model judge declares its moves by extending the standard implementation. */
@Judge({ checks: [JudgeInput.ToolCall, JudgeInput.ToolResult] })
class SearchQualityJudge extends ModelJudge<ToolCallMove | ToolResultMove> {}

@Judge({ checks: [JudgeInput.ToolCall] })
class PathInsideRepositoryJudge implements JudgeHandler<ToolCallMove> {
  judge(move: ToolCallMove): Promise<JudgeVerdict> {
    return Promise.resolve(typeof move.args.path === "string" ? "accept" : "revise");
  }
}

// @ts-expect-error — `checks` says ToolResult too, but `judge(move)` only takes ToolCallMove
@Judge({ checks: [JudgeInput.ToolCall, JudgeInput.ToolResult] })
class ChecksMoreThanItTakes implements JudgeHandler<ToolCallMove> {
  judge(move: ToolCallMove): Promise<JudgeVerdict> {
    return Promise.resolve(typeof move.args.content === "string" ? "accept" : "reject");
  }
}

function attachments(): unknown[] {
  return [
    judge(PathInsideRepositoryJudge).beforeCall(),
    judge(SearchQualityJudge).beforeCall(),
    judge(SearchQualityJudge).afterCall(),
    // @ts-expect-error — PathInsideRepositoryJudge does not check answers
    judge(PathInsideRepositoryJudge).beforeAnswer(),
    // @ts-expect-error — SearchQualityJudge does not check answers
    judge(SearchQualityJudge).beforeAnswer(),
  ];
}

describe("spike #113 — judge attachment points", () => {
  it("as specified in #112, a wrong point compiles and is caught at startup", () => {
    // `judge()` cannot type an empty class — only the loose builder takes it, and it compiles:
    const wrong = looseJudge(AnswerCompletenessAsSpecified).beforeCall();
    expect(() => {
      assertAttachable(wrong);
    }).toThrow("judge.unsupported-input");
    expect(() => {
      assertAttachable(looseJudge(AnswerCompletenessAsSpecified).beforeAnswer());
    }).not.toThrow();
  });

  it("with moves in the class's type, the builder only offers the declared points", () => {
    expect(attachments()).toHaveLength(5);
    expect(judge(SearchQualityJudge).afterCall()).toEqual({
      judge: SearchQualityJudge,
      point: "after-call",
    });
    expect(ChecksMoreThanItTakes).toBeTypeOf("function");
  });
});
