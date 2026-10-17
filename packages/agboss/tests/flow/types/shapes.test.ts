import { describe, expect, it } from "vitest";
import { Text } from "../../../src/dto/index.js";
import { listOf, oneOf, optional } from "../../../src/flow/dto-wrappers.js";
import { ImportTable } from "../../../src/flow/types/imports.js";
import { ClassLocator } from "../../../src/flow/types/locate.js";
import { producedText, propertyName, valueText } from "../../../src/flow/types/shapes.js";

/** How shapes are written as types (#270 → wrappers, `Produced<T, P>`). */

class ScoreDto {
  @Text({ prompt: "a score" })
  text!: string;
}
class RejectedDto {
  @Text({ prompt: "why" })
  text!: string;
}

const names = (): ImportTable =>
  new ImportTable(
    new ClassLocator([{ file: "/project/dtos.ts", exports: { RejectedDto, ScoreDto } }]),
    "/project/.agboss/types.d.ts",
  );

describe("#270: wrappers as types", () => {
  it("lists, oneOf, optional", () => {
    const table = names();

    expect(valueText(listOf(oneOf(ScoreDto, RejectedDto)), table)).toBe(
      "readonly (RejectedDto | ScoreDto)[]",
    );
    expect(valueText(oneOf(ScoreDto, RejectedDto), table)).toBe("RejectedDto | ScoreDto");
    expect(valueText(optional(listOf(ScoreDto)), table)).toBe("readonly ScoreDto[] | undefined");
  });

  it("a list field of oneOf values is an array of Produced elements of the union", () => {
    expect(producedText(optional(listOf(oneOf(ScoreDto, RejectedDto))), "typeof X", names())).toBe(
      "readonly Produced<RejectedDto | ScoreDto, typeof X>[]",
    );
  });

  it("a field name that is not an identifier is quoted", () => {
    expect([propertyName("draft"), propertyName("first-draft")]).toEqual([
      "draft",
      '"first-draft"',
    ]);
  });
});
