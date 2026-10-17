import { Nested, Text } from "../../../src/dto/index.js";

/** DTOs of the #271 examples: the review loop, the plan cycle, outdating without a cycle. */

export class ResearchDto {
  @Text({ prompt: "what the research found" })
  facts!: string;
}

export class DraftDto {
  @Text({ prompt: "the draft's text" })
  text!: string;
}

export class ApprovalDto {
  @Text({ prompt: "why the draft is good to publish" })
  reason!: string;
}

export class CritiqueDto {
  @Text({ prompt: "one remark on the draft" })
  remark!: string;
}

export class PlanDto {
  @Text({ prompt: "the plan of the article" })
  outline!: string;
}

/** Both versions of a draft in one value (S14: what `about` names instead of a tag). */
export class DraftPairDto {
  @Nested(DraftDto, { prompt: "the draft before the edit" })
  before!: DraftDto;

  @Nested(DraftDto, { prompt: "the draft after the edit" })
  after!: DraftDto;
}

export class CandidateProfileDto {
  @Text({ prompt: "who the candidate is" })
  summary!: string;
}

export class JobListDto {
  @Text({ prompt: "the jobs found for the profile" })
  jobs!: string;
}

export class JobScoresDto {
  @Text({ prompt: "how well each job fits" })
  scores!: string;
}

export class JobPickDto {
  @Text({ prompt: "the job to apply for" })
  job!: string;
}
