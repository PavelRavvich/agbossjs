import { describe, expect } from "vitest";
import { replyWith, routeTo, testWith } from "../../../src/testing/index.js";
import { execute } from "../../helpers/flow.js";
import { DraftChangesDto } from "../fixtures/data-dtos.js";
import { ArticleDto } from "../fixtures/dtos.js";
import { ApprovalDto, DraftDto, ResearchDto } from "../fixtures/review-dtos.js";
import {
  CritiqueAction,
  CritiqueRouter,
  PolishAgent,
  PolishedWorkflowFinish,
  PolishWorkflow,
  PublisherAgent,
  ResearcherAgent,
  StoryReviewerAgent,
  StoryWorkflow,
  StoryWorkflowFinish,
  StoryWorkflowStart,
  StoryWriterAgent,
} from "../fixtures/review.fixture.js";

/**
 * #271 S15 at runtime: `about(…)` is a type statement — the answer tools, the value and the action's
 * result are the shape's. Outdating at runtime is #271 PR 2; here the review loop simply runs.
 */

const story = testWith(StoryWorkflow);
const polish = testWith(PolishWorkflow);

describe("#271 S15: an about(…) output answers and returns its shape", () => {
  story(
    "an agent's about(DraftDto, oneOf(…)) answers through the oneOf's tools; the loop runs",
    async ({ app, mockLlm }) => {
      mockLlm(ResearcherAgent).thenReturn(replyWith(ResearchDto, { facts: "f" }));
      mockLlm(StoryWriterAgent).thenReturn(
        replyWith(DraftDto, { text: "v1" }),
        replyWith(DraftDto, { text: "v2" }),
      );
      mockLlm(StoryReviewerAgent).thenReturn(
        replyWith(DraftChangesDto, { changes: "shorter" }),
        replyWith(ApprovalDto, { reason: "good" }),
      );
      mockLlm(PublisherAgent).thenReturn(replyWith(ArticleDto, { body: "v2, published" }));

      const result = await execute(app, StoryWorkflowStart, { topic: "outdating" });

      expect(result).toFinishWith(StoryWorkflowFinish, { body: "v2, published" });
      const request = mockLlm(StoryReviewerAgent).lastRequest;
      expect(request.kind === "chat" && request.tools.map((tool) => tool.function.name)).toEqual([
        "answer-approval-dto",
        "answer-draft-changes-dto",
      ]);
    },
  );

  polish("an action's about(DraftDto, listOf(…)) returns the list", async ({ app, mockLlm }) => {
    mockLlm(PolishAgent).thenReturn(replyWith(DraftDto, { text: "draft" }));
    mockLlm(CritiqueRouter).thenReturn(routeTo(PolishedWorkflowFinish));

    const result = await execute(app, StoryWorkflowStart, { topic: "lists" }, { record: true });

    expect(result).toFollowPath([
      StoryWorkflowStart,
      PolishAgent,
      CritiqueAction,
      CritiqueRouter,
      PolishedWorkflowFinish,
    ]);
    expect(result.record?.scope).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot: "list:CritiqueDto",
          value: [{ remark: "shorter than 5" }],
        }),
      ]),
    );
  });
});
