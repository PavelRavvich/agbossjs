import { describe, expect, it } from "vitest";
import { NoTextStartError, textStartOrFail } from "../../src/cli/text-start.js";
import { ChatStart } from "../../../agboss/tests/testing/fixtures/desk.workflow.js";

describe("AC12: CLI chat and run start on the app's text start", () => {
  it("uses the workflow start a plain text goes to", () => {
    expect(textStartOrFail({ name: "desk", textStart: ChatStart })).toBe(ChatStart);
  });

  it("a workflow without one cannot chat", () => {
    expect(() => textStartOrFail({ name: "w", textStart: undefined })).toThrow(NoTextStartError);
  });
});
