/** #118 AC5 / #141: the 17 standard DTOs accept their examples and reject cross-field violations. */
import { describe, expect, it } from "vitest";
import {
  Address,
  Attachment,
  ContactInfo,
  DateRange,
  DateTimeRange,
  type DtoClass,
  Money,
  NoInput,
  PersonName,
  PlainText,
  RagSearchResult,
  RagSourceReference,
  ToolCallApprovalAsk,
  ToolCallApprovalDecision,
  WorkflowFinishText,
  WorkflowPauseAnswer,
  WorkflowPauseQuestion,
  WorkflowStartText,
} from "../../src/dto/index.js";
import { jsonSchemaOf, validate } from "../../src/dto/schema.js";

const examples: readonly (readonly [DtoClass, object])[] = [
  [WorkflowStartText, { text: "find TypeScript jobs", author: "pavel" }],
  [WorkflowFinishText, { text: "Done." }],
  [WorkflowPauseQuestion, { question: "Which city?", options: ["Tel Aviv", "Haifa"] }],
  [WorkflowPauseAnswer, { replyWith: "Haifa" }],
  [
    ToolCallApprovalAsk,
    {
      callId: "call_1",
      tool: "save_shortlist",
      arguments: { jobs: [{ title: "Engineer" }] },
      summary: "Adds one job to the shortlist",
    },
  ],
  [ToolCallApprovalDecision, { approved: true, by: "pavel" }],
  [NoInput, {}],
  [RagSearchResult, { text: "Remote friendly", source: "notes/acme.md", score: 0.82 }],
  [Money, { amount: "19.99", currency: "USD" }],
  [DateRange, { from: "2026-09-01", to: "2026-09-30", timeZone: "Asia/Jerusalem" }],
  [DateTimeRange, { from: "2026-09-01T09:00:00+03:00", to: "2026-09-01T18:00:00+03:00" }],
  [Attachment, { name: "invoice.pdf", mediaType: "application/pdf", url: "https://x.io/i.pdf" }],
  [Address, { street: "Herzl 1", city: "Haifa", country: "IL" }],
  [PersonName, { given: "Pavel" }],
  [ContactInfo, { phone: "+972521234567" }],
  [RagSourceReference, { title: "Acme notes", quote: "Remote friendly" }],
  [PlainText, { text: "3 jobs saved" }],
];

const rejects = (dto: DtoClass, raw: object): boolean => {
  try {
    validate(dto, raw);
    return false;
  } catch {
    return true;
  }
};

describe("standard DTOs (#118)", () => {
  it("AC5: all 17 accept their example as is", () => {
    expect(examples).toHaveLength(17);
    for (const [dto, example] of examples) expect(validate(dto, example)).toEqual(example);
  });

  it("AC5: every field of every standard DTO has a prompt the model reads (NoInput has none)", () => {
    for (const [dto] of examples) {
      const properties = Object.values(jsonSchemaOf(dto).properties as Record<string, object>);
      for (const property of properties) expect(property).toHaveProperty("description");
    }
  });

  it("AC5: Money keeps at most two digits after the point and an upper-case ISO 4217 code", () => {
    expect(rejects(Money, { amount: "19.999", currency: "USD" })).toBe(true);
    expect(rejects(Money, { amount: "19.99", currency: "usd" })).toBe(true);
  });

  it("AC5: DateRange — the same day on both ends passes; the last day before the first does not", () => {
    expect(rejects(DateRange, { from: "2026-09-01", to: "2026-09-01" })).toBe(false);
    expect(() => validate(DateRange, { from: "2026-09-02", to: "2026-09-01" })).toThrow(
      /to: the last day is before the first/,
    );
  });

  it("AC5: DateTimeRange compares moments across offsets; equal ends fail (end excluded)", () => {
    const from = "2026-09-01T10:00:00+03:00"; // 07:00Z
    expect(rejects(DateTimeRange, { from, to: "2026-09-01T09:00:00Z" })).toBe(false);
    expect(rejects(DateTimeRange, { from, to: "2026-09-01T07:00:00Z" })).toBe(true);
    expect(rejects(DateTimeRange, { from, to: "2026-09-01T06:00:00Z" })).toBe(true);
    expect(rejects(DateTimeRange, { from: "2026-09-01T10:00", to: "2026-09-01T11:00" })).toBe(true);
  });

  it("AC5: Attachment needs exactly one of url and content", () => {
    const file = { name: "a.txt", mediaType: "text/plain" };
    expect(rejects(Attachment, { ...file, content: "aGk=" })).toBe(false);
    expect(rejects(Attachment, { ...file, url: "https://x.io/a", content: "aGk=" })).toBe(true);
    expect(rejects(Attachment, file)).toBe(true);
  });

  it("AC5: ContactInfo needs an email, a phone or both", () => {
    expect(rejects(ContactInfo, { email: "a@b.io" })).toBe(false);
    expect(() => validate(ContactInfo, {})).toThrow(/email: give an email, a phone or both/);
  });

  it("AC5: RagSearchResult.score is from 0 to 1; WorkflowPauseQuestion has at most 6 options; RagSourceReference.quote ≤ 300", () => {
    expect(rejects(RagSearchResult, { text: "t", source: "s", score: 1.2 })).toBe(true);
    expect(
      rejects(WorkflowPauseQuestion, {
        question: "q",
        options: ["1", "2", "3", "4", "5", "6", "7"],
      }),
    ).toBe(true);
    expect(rejects(RagSourceReference, { title: "t", quote: "x".repeat(301) })).toBe(true);
    expect(rejects(WorkflowStartText, { text: "" })).toBe(true);
  });

  it("AC5: ToolCallApprovalAsk.arguments is any JSON object — not a string", () => {
    const request = { callId: "c", tool: "t", summary: "s" };
    expect(rejects(ToolCallApprovalAsk, { ...request, arguments: {} })).toBe(false);
    expect(rejects(ToolCallApprovalAsk, { ...request, arguments: "x" })).toBe(true);
  });
});

describe("#141 AC3: standard DTOs named by the hierarchy rule", () => {
  it("names start with their component kind; nothing says chat, user or person", () => {
    const names = examples.map(([dto]) => dto.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "WorkflowStartText",
        "WorkflowFinishText",
        "WorkflowPauseQuestion",
        "WorkflowPauseAnswer",
        "ToolCallApprovalAsk",
        "ToolCallApprovalDecision",
        "RagSearchResult",
        "RagSourceReference",
        "PlainText",
      ]),
    );
    const prompts = JSON.stringify(examples.map(([dto]) => jsonSchemaOf(dto)));
    expect(prompts).not.toMatch(/\b(chat|user|person)\b/i);
  });

  it("RagSearchResult is valid without a score", () => {
    expect(rejects(RagSearchResult, { text: "Remote friendly", source: "notes/acme.md" })).toBe(
      false,
    );
  });

  it("ToolCallApprovalDecision takes a reason; it needs who decided", () => {
    const refusal = { approved: false, by: "ci-bot", feedback: "outside the change window" };
    expect(validate(ToolCallApprovalDecision, refusal)).toEqual(refusal);
    expect(rejects(ToolCallApprovalDecision, { approved: true })).toBe(true);
  });

  it("PlainText needs its text", () => {
    expect(rejects(PlainText, {})).toBe(true);
  });
});
