// A hand-made stand-in for the `.agboss/types.d.ts` that `agboss check` generates (#272 S3, #270),
// in the shape the generator emits; replaced by generated output in #272 PR 3. Tables are keyed by
// component `name`; classes are branded by module augmentation. Until PR 4 exports the tables from
// `agboss`, they are augmented in their source module.
import type {
  agbossComponent,
  agbossDto,
  NoInput,
  NoOutput,
} from "../../../src/flow/generated-types.js";
import type { Produced } from "../../../src/flow/dto-wrappers.js";
import type {
  ArticleDto,
  ArticleRequestDto,
  ChangesRequestedDto,
  DraftApprovedDto,
  OfferDraftDto,
  OfferSentDto,
  OpeningsDto,
  OrderRequestDto,
  OrderShippedDto,
  ProfileDto,
  ResumeMissingDto,
  ReviewDto,
  ShortlistDto,
  StockReservationDto,
  WorkflowStartTextDto,
} from "./dtos.js";
import type { IntakeWorkflowStart, ProfilerAgent } from "./chat.fixture.js";
import type {
  DraftAgent,
  EditorAgent,
  OfferWorkflowStart,
  ReviewerAgent,
} from "./offer.fixture.js";
import type {
  ArticleDraftAgent,
  ArticleWorkflowStart,
  DraftReviewerAgent,
  WriterAgent,
} from "./article.fixture.js";
import type { OrderWorkflowStart, ReserveStockAction, ShipOrderAction } from "./order.fixture.js";

declare module "../../../src/flow/generated-types.js" {
  interface ProducerOutputs {
    "intake-workflow-start": WorkflowStartTextDto;
    "profiler-agent": ProfileDto | ResumeMissingDto;
    "scout-agent": OpeningsDto;
    "offer-workflow-start": ShortlistDto;
    "draft-agent": OfferDraftDto;
    "reviewer-agent": ChangesRequestedDto | DraftApprovedDto;
    "editor-agent": OfferDraftDto;
    "broken-agent": OfferDraftDto;
    "notify-recruiter-action": NoOutput;
    "send-offer-action": OfferSentDto;
    "article-workflow-start": ArticleRequestDto;
    "article-draft-agent": ArticleDto;
    "draft-reviewer-agent": ReviewDto;
    "writer-agent": ArticleDto;
    "final-reviewer-agent": ReviewDto;
    "order-workflow-start": OrderRequestDto;
    "reserve-stock-action": StockReservationDto;
    "ship-order-action": OrderShippedDto;
    "refund-card-action": NoOutput;
    "notify-finance-team-action": NoOutput;
    "release-stock-action": NoOutput;
  }

  interface Inputs {
    "main-router": { message: Produced<WorkflowStartTextDto, typeof IntakeWorkflowStart> };
    "profiler-agent": { message: Produced<WorkflowStartTextDto, typeof IntakeWorkflowStart> };
    "scout-agent":
      { profile: Produced<ProfileDto, typeof ProfilerAgent> } | { profile?: undefined };
    "ask-resume-workflow-finish": NoInput;
    "chat-workflow-finish": NoInput;
    "no-reply-workflow-finish": NoInput;
    "draft-agent": { shortlist: Produced<ShortlistDto, typeof OfferWorkflowStart> };
    "reviewer-agent": { draft: Produced<OfferDraftDto, typeof DraftAgent | typeof EditorAgent> };
    "editor-agent": {
      draft: Produced<OfferDraftDto, typeof DraftAgent | typeof EditorAgent>;
      changes: Produced<ChangesRequestedDto, typeof ReviewerAgent>;
    };
    "broken-agent": {
      readonly __error: "[input.missing-on-path] broken-agent.unrelated (UnrelatedDto) is not produced on the path offer-workflow-start → draft-agent → broken-agent";
    };
    "notify-recruiter-action": {
      draft: Produced<OfferDraftDto, typeof DraftAgent | typeof EditorAgent>;
    };
    "send-offer-action": { draft: Produced<OfferDraftDto, typeof DraftAgent | typeof EditorAgent> };
    "offer-failed-workflow-finish": NoInput;
    "offer-sent-workflow-finish": NoInput;
    "article-draft-agent": { request: Produced<ArticleRequestDto, typeof ArticleWorkflowStart> };
    "draft-reviewer-agent": { article: Produced<ArticleDto, typeof ArticleDraftAgent> };
    "writer-agent": {
      article: Produced<ArticleDto, typeof ArticleDraftAgent>;
      review: Produced<ReviewDto, typeof DraftReviewerAgent>;
    };
    "final-reviewer-agent": { article: Produced<ArticleDto, typeof WriterAgent> };
    "article-workflow-finish": NoInput;
    "reserve-stock-action": { order: Produced<OrderRequestDto, typeof OrderWorkflowStart> };
    "ship-order-action": { order: Produced<OrderRequestDto, typeof OrderWorkflowStart> };
    "refund-card-action": { order: Produced<OrderRequestDto, typeof OrderWorkflowStart> };
    "notify-finance-team-action": { order: Produced<OrderRequestDto, typeof OrderWorkflowStart> };
    "release-stock-action": {
      reservation: Produced<StockReservationDto, typeof ReserveStockAction>;
    };
    "order-failed-workflow-finish": NoInput;
    "order-workflow-finish": { shipped: Produced<OrderShippedDto, typeof ShipOrderAction> };
  }

  interface Outputs {
    "notify-recruiter-action": NoOutput;
    "send-offer-action": OfferSentDto;
    "reserve-stock-action": StockReservationDto;
    "ship-order-action": OrderShippedDto;
    "refund-card-action": NoOutput;
    "notify-finance-team-action": NoOutput;
    "release-stock-action": NoOutput;
    "order-workflow-finish": OrderShippedDto;
  }

  interface WorkflowStarts {
    "intake-workflow-start": {
      input: WorkflowStartTextDto;
      output: OpeningsDto | ResumeMissingDto;
    };
    "offer-workflow-start": { input: ShortlistDto; output: OfferSentDto | OfferDraftDto };
    "article-workflow-start": { input: ArticleRequestDto; output: ReviewDto };
    "order-workflow-start": { input: OrderRequestDto; output: OrderShippedDto | OrderRequestDto };
  }
}

declare module "./chat.fixture.js" {
  interface IntakeWorkflowStart {
    readonly [agbossComponent]?: "intake-workflow-start";
  }
  interface ProfilerAgent {
    readonly [agbossComponent]?: "profiler-agent";
  }
  interface ScoutAgent {
    readonly [agbossComponent]?: "scout-agent";
  }
  interface AskResumeWorkflowFinish {
    readonly [agbossComponent]?: "ask-resume-workflow-finish";
  }
  interface ChatWorkflowFinish {
    readonly [agbossComponent]?: "chat-workflow-finish";
  }
  interface NoReplyWorkflowFinish {
    readonly [agbossComponent]?: "no-reply-workflow-finish";
  }
  interface MainRouter {
    readonly [agbossComponent]?: "main-router";
  }
}

declare module "./offer.fixture.js" {
  interface OfferWorkflowStart {
    readonly [agbossComponent]?: "offer-workflow-start";
  }
  interface DraftAgent {
    readonly [agbossComponent]?: "draft-agent";
  }
  interface ReviewerAgent {
    readonly [agbossComponent]?: "reviewer-agent";
  }
  interface EditorAgent {
    readonly [agbossComponent]?: "editor-agent";
  }
  interface BrokenAgent {
    readonly [agbossComponent]?: "broken-agent";
  }
  interface NotifyRecruiterAction {
    readonly [agbossComponent]?: "notify-recruiter-action";
  }
  interface SendOfferAction {
    readonly [agbossComponent]?: "send-offer-action";
  }
  interface OfferFailedWorkflowFinish {
    readonly [agbossComponent]?: "offer-failed-workflow-finish";
  }
  interface OfferSentWorkflowFinish {
    readonly [agbossComponent]?: "offer-sent-workflow-finish";
  }
}

declare module "./article.fixture.js" {
  interface ArticleWorkflowStart {
    readonly [agbossComponent]?: "article-workflow-start";
  }
  interface ArticleDraftAgent {
    readonly [agbossComponent]?: "article-draft-agent";
  }
  interface DraftReviewerAgent {
    readonly [agbossComponent]?: "draft-reviewer-agent";
  }
  interface WriterAgent {
    readonly [agbossComponent]?: "writer-agent";
  }
  interface FinalReviewerAgent {
    readonly [agbossComponent]?: "final-reviewer-agent";
  }
  interface ArticleWorkflowFinish {
    readonly [agbossComponent]?: "article-workflow-finish";
  }
}

declare module "./order.fixture.js" {
  interface OrderWorkflowStart {
    readonly [agbossComponent]?: "order-workflow-start";
  }
  interface ReserveStockAction {
    readonly [agbossComponent]?: "reserve-stock-action";
  }
  interface ShipOrderAction {
    readonly [agbossComponent]?: "ship-order-action";
  }
  interface RefundCardAction {
    readonly [agbossComponent]?: "refund-card-action";
  }
  interface NotifyFinanceTeamAction {
    readonly [agbossComponent]?: "notify-finance-team-action";
  }
  interface ReleaseStockAction {
    readonly [agbossComponent]?: "release-stock-action";
  }
  interface OrderFailedWorkflowFinish {
    readonly [agbossComponent]?: "order-failed-workflow-finish";
  }
  interface OrderWorkflowFinish {
    readonly [agbossComponent]?: "order-workflow-finish";
  }
}

declare module "./dtos.js" {
  interface WorkflowStartTextDto {
    readonly [agbossDto]?: "WorkflowStartTextDto";
  }
  interface ProfileDto {
    readonly [agbossDto]?: "ProfileDto";
  }
  interface ResumeMissingDto {
    readonly [agbossDto]?: "ResumeMissingDto";
  }
  interface OpeningsDto {
    readonly [agbossDto]?: "OpeningsDto";
  }
  interface ShortlistDto {
    readonly [agbossDto]?: "ShortlistDto";
  }
  interface OfferDraftDto {
    readonly [agbossDto]?: "OfferDraftDto";
  }
  interface ChangesRequestedDto {
    readonly [agbossDto]?: "ChangesRequestedDto";
  }
  interface DraftApprovedDto {
    readonly [agbossDto]?: "DraftApprovedDto";
  }
  interface OfferSentDto {
    readonly [agbossDto]?: "OfferSentDto";
  }
  interface ArticleRequestDto {
    readonly [agbossDto]?: "ArticleRequestDto";
  }
  interface ArticleDto {
    readonly [agbossDto]?: "ArticleDto";
  }
  interface ReviewDto {
    readonly [agbossDto]?: "ReviewDto";
  }
  interface OrderRequestDto {
    readonly [agbossDto]?: "OrderRequestDto";
  }
  interface StockReservationDto {
    readonly [agbossDto]?: "StockReservationDto";
  }
  interface OrderShippedDto {
    readonly [agbossDto]?: "OrderShippedDto";
  }
  interface UnrelatedDto {
    readonly [agbossDto]?: "UnrelatedDto";
  }
}
