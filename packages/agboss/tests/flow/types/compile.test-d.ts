import { describe, expectTypeOf, it } from "vitest";
import { agent, caseOf, start } from "../../../src/flow/builder.js";
import { listOf, optional, type Produced } from "../../../src/flow/dto-wrappers.js";
import type {
  DtoBrands,
  InputOf,
  OutputOf,
  ProducerOutputOf,
  WorkflowStarts,
} from "../../../src/flow/generated-types.js";
import {
  CompanyDto,
  CompanyScoreDto,
  FastDraftDto,
  ExpertDraftDto,
  LoyaltyOfferDto,
  SearchRequestDto,
} from "../fixtures/data-dtos.js";
import { OfferDraftDto, ProfileDto, ShortlistDto } from "../fixtures/dtos.js";
import {
  ApprovedVerdictDto,
  ApprovedWorkflowFinish,
  RejectedVerdictDto,
  RejectedWorkflowFinish,
  VerdictAgent,
} from "../fixtures/markers.fixture.js";
import { DraftAgent, EditorAgent, ReviewerAgent } from "../fixtures/offer.fixture.js";
import {
  BatchRankAgent,
  CompanyBatchWorkflowStart,
  CompanyCheckAgent,
  CompanyCheckWorkflowStart,
} from "../fixtures/starts.fixture.js";
import {
  ExpertAnswerAgent,
  FastAnswerAgent,
  SupportWorkflowFinish,
} from "../fixtures/support.fixture.js";

/**
 * Compile-time checks of the generated `.agboss/types.d.ts` (#272 PR 3, #270 → Generated types),
 * written for the fixtures by `check:types` before typecheck. Each `@ts-expect-error` is a negative
 * test: tsc fails this file if the line compiles.
 */

describe("#270 AC6: returns and caseOf against ProducerOutputs", () => {
  it("a map start returns all its fields at once, in any order", () => {
    start(CompanyCheckWorkflowStart).returns(CompanyDto, optional(SearchRequestDto));
    start(CompanyCheckWorkflowStart).returns(optional(SearchRequestDto), CompanyDto);
    // @ts-expect-error — the start gives a CompanyDto and an optional SearchRequestDto
    start(CompanyCheckWorkflowStart).returns(CompanyDto);
    // @ts-expect-error — the request is optional(SearchRequestDto), not a SearchRequestDto
    start(CompanyCheckWorkflowStart).returns(CompanyDto, SearchRequestDto);
    // @ts-expect-error — the start gives two values, not three
    start(CompanyCheckWorkflowStart).returns(CompanyDto, optional(SearchRequestDto), ProfileDto);
    expectTypeOf<ProducerOutputOf<CompanyCheckWorkflowStart>>().toEqualTypeOf<
      readonly [CompanyDto, SearchRequestDto | undefined]
    >();
  });

  it("a list start returns its list; a single producer one value", () => {
    start(CompanyBatchWorkflowStart).returns(listOf(CompanyDto));
    // @ts-expect-error — the start gives a list of CompanyDto
    start(CompanyBatchWorkflowStart).returns(CompanyDto);
    const drafted = start(CompanyCheckWorkflowStart)
      .returns(CompanyDto, optional(SearchRequestDto))
      .toAgent(CompanyCheckAgent);
    drafted.returns(CompanyScoreDto);
    // @ts-expect-error — company-check-agent gives one CompanyScoreDto
    drafted.returns(CompanyScoreDto, CompanyDto);
    expectTypeOf<ProducerOutputOf<CompanyBatchWorkflowStart>>().toEqualTypeOf<
      readonly CompanyDto[]
    >();
  });
});

describe("S39: DTO brands tell two DTOs of the same shape apart", () => {
  it("a case for one of two same-shaped DTOs twice does not compile", () => {
    agent(VerdictAgent).switch(
      caseOf(ApprovedVerdictDto).toFinish(ApprovedWorkflowFinish),
      caseOf(RejectedVerdictDto).toFinish(RejectedWorkflowFinish),
    );
    agent(VerdictAgent).switch(
      // @ts-expect-error — the switch is not exhaustive: RejectedVerdictDto has no case
      caseOf(ApprovedVerdictDto).toFinish(ApprovedWorkflowFinish),
      caseOf(ApprovedVerdictDto).toFinish(RejectedWorkflowFinish),
    );
    expectTypeOf<ApprovedVerdictDto>().not.toEqualTypeOf<RejectedVerdictDto>();
    expectTypeOf<DtoBrands["ApprovedVerdictDto"]>().toEqualTypeOf<ApprovedVerdictDto>();
  });

  it("the brand is optional: project code creates DTO values as before", () => {
    const verdict: ApprovedVerdictDto = { note: "fine" };
    expectTypeOf(verdict.note).toEqualTypeOf<string>();
  });
});

describe("#270 AC8: Produced P is the producer union", () => {
  it("a field one of two producers can bring", () => {
    expectTypeOf<InputOf<ReviewerAgent>>().toEqualTypeOf<{
      draft: Produced<OfferDraftDto, typeof DraftAgent | typeof EditorAgent>;
    }>();
    expectTypeOf<InputOf<FastAnswerAgent>["order"]["producer"]>().not.toBeNever();
  });
});

describe("#270 AC13: InputOf is path-sensitive — optional fields narrow without !", () => {
  it("an optional field some paths bring", () => {
    const input = {} as InputOf<ExpertAnswerAgent>;
    if (input.loyalty !== undefined) {
      expectTypeOf(input.loyalty.value).toEqualTypeOf<LoyaltyOfferDto>();
    } else {
      expectTypeOf(input.loyalty).toEqualTypeOf<undefined>();
    }
  });

  it("two fields of which every path brings exactly one", () => {
    const input = {} as InputOf<SupportWorkflowFinish>;
    if (input.fast === undefined) {
      expectTypeOf(input.expert.value).toEqualTypeOf<ExpertDraftDto>();
    } else {
      expectTypeOf(input.fast.value).toEqualTypeOf<FastDraftDto>();
    }
  });

  it("a list field is an array of Produced elements", () => {
    expectTypeOf<InputOf<BatchRankAgent>>().toEqualTypeOf<{
      companies: readonly Produced<CompanyDto, typeof CompanyBatchWorkflowStart>[];
    }>();
  });
});

describe("#270 AC13 / AC21: WorkflowStarts types app.execute's input and result.output", () => {
  it("a map start's input; the outputs of the finishes it reaches", () => {
    expectTypeOf<WorkflowStarts["company-check-workflow-start"]>().toEqualTypeOf<{
      input: { company: CompanyDto; request?: SearchRequestDto };
      output: CompanyScoreDto;
    }>();
    expectTypeOf<InputOf<CompanyCheckWorkflowStart>>().toEqualTypeOf<{
      company: CompanyDto;
      request?: SearchRequestDto;
    }>();
    expectTypeOf<OutputOf<SupportWorkflowFinish>>().not.toEqualTypeOf<ShortlistDto>();
  });
});
