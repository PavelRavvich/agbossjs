/**
 * Spike #113, item 1 — a DTO field decorator fits the field's type. `make check` runs `tsc` over
 * tests/: every `@ts-expect-error` below must stay an error, or the build fails.
 */
import { describe, expect, it } from "vitest";
import { Flag, Integer, ListOf, Nested, OneOf, Text, fieldsOf } from "./dto.js";

class Issue {
  @Text({ prompt: "one line" })
  title!: string;
}

class Review {
  @Text({ prompt: "what changed" })
  summary!: string;

  @Integer({ optional: true })
  score?: number;

  @Flag()
  approved!: boolean;

  @OneOf({ values: ["file", "folder"] })
  kind!: "file" | "folder";

  @ListOf(Issue)
  issues!: Issue[];

  @Nested(Issue)
  main!: Issue;
}

/** Declared, never instantiated: only `tsc` looks at these. */
class Mistakes {
  // @ts-expect-error — @Text on a number
  @Text()
  count!: number;

  // @ts-expect-error — optional field without `optional: true`
  @Text()
  note?: string;

  // @ts-expect-error — `optional: true` on a required field
  @Text({ optional: true })
  name!: string;

  // @ts-expect-error — `values` misses "folder"
  @OneOf({ values: ["file"] })
  narrow!: "file" | "folder";

  // @ts-expect-error — `values` has "link", the field does not
  @OneOf({ values: ["file", "folder", "link"] })
  wide!: "file" | "folder";

  // @ts-expect-error — @OneOf on a plain string
  @OneOf({ values: ["file", "folder"] })
  loose!: string;

  // @ts-expect-error — list of Issue on a single Issue
  @ListOf(Issue)
  single!: Issue;

  // @ts-expect-error — nested DTO of another shape
  @Nested(Issue)
  other!: { id: number };
}

describe("spike #113 — DTO field decorators", () => {
  it("record every field at runtime through context.metadata", () => {
    const fields = fieldsOf(Review);
    expect(Object.keys(fields)).toEqual(["summary", "score", "approved", "kind", "issues", "main"]);
    expect(fields.score).toMatchObject({ kind: "integer", optional: true });
    expect(fields.kind).toMatchObject({ kind: "one-of", values: ["file", "folder"] });
    expect(fields.issues?.item).toBe(Issue);
  });

  it("keep a subclass's fields apart from its parent's", () => {
    class Extended extends Issue {
      @Flag()
      urgent!: boolean;
    }
    expect(Object.keys(fieldsOf(Issue))).toEqual(["title"]);
    expect(Object.keys(fieldsOf(Extended))).toEqual(["urgent"]);
  });

  it("find an undecorated field at startup: own keys of an instance vs recorded fields", () => {
    class Partly {
      @Text()
      path!: string;
      mode!: string;
    }
    const recorded = Object.keys(fieldsOf(Partly));
    const undecorated = Object.keys(new Partly()).filter((key) => !recorded.includes(key));
    expect(undecorated).toEqual(["mode"]);
  });

  it("leave the initial value alone; the mistakes above still run", () => {
    expect(new Review().approved).toBeUndefined();
    expect(Object.keys(fieldsOf(Mistakes))).toHaveLength(8);
  });
});
