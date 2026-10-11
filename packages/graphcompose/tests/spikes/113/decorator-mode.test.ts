/**
 * Spike #113, item 7 — standard (TC39) decorators vs `experimentalDecorators`, and how each compiler
 * that touches a workflow handles them: `tsc` (the framework's build, `make check`), esbuild (under
 * `tsx`, which `gc` uses to load workflows, and under Vitest, which runs this very file).
 */
import { transformSync } from "esbuild";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/** A field decorator written for standard decorators, reporting what it received. */
const PROBE = `
const seen: string[] = [];
function field(value: unknown, context: ClassFieldDecoratorContext) {
  seen.push(typeof context === "object" ? context.kind + ":" + String(context.name) : "legacy:" + String(context));
  if (typeof context === "object" && context.metadata) context.metadata["path"] = "text";
}
class Dto {
  @field path!: string;
}
const table = (Dto as any)[Symbol.for("Symbol.metadata")];
exports.seen = seen;
exports.metadata = table ? { ...table } : null;
exports.instanceKeys = Object.keys(new Dto());
`;

interface ProbeResult {
  readonly seen: readonly string[];
  readonly metadata: Readonly<Record<string, string>> | null;
  readonly instanceKeys: readonly string[];
}

const POLYFILL = `Symbol.metadata ??= Symbol.for("Symbol.metadata");\n`;

function run(code: string): ProbeResult {
  const sandbox = { exports: {} as ProbeResult };
  runInNewContext(code, sandbox);
  return sandbox.exports;
}

function withTsc(experimentalDecorators: boolean): string {
  return ts.transpileModule(PROBE, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators,
    },
  }).outputText;
}

function withEsbuild(experimentalDecorators: boolean): string {
  return transformSync(PROBE, {
    loader: "ts",
    format: "cjs",
    target: "es2023",
    tsconfigRaw: { compilerOptions: { experimentalDecorators, useDefineForClassFields: true } },
  }).code;
}

describe("spike #113 — decorator mode", () => {
  it("tsc, standard: the context arrives, but no metadata without Symbol.metadata", () => {
    expect(run(withTsc(false))).toEqual({
      seen: ["field:path"],
      metadata: null,
      instanceKeys: ["path"],
    });
  });

  it("tsc, standard + the polyfill: metadata under Symbol.for('Symbol.metadata')", () => {
    expect(run(POLYFILL + withTsc(false)).metadata).toEqual({ path: "text" });
  });

  it("esbuild (tsx, Vitest), standard: metadata even without the polyfill, same symbol", () => {
    expect(run(withEsbuild(false))).toEqual({
      seen: ["field:path"],
      metadata: { path: "text" },
      instanceKeys: ["path"],
    });
    expect(run(POLYFILL + withEsbuild(false)).metadata).toEqual({ path: "text" });
  });

  it("experimentalDecorators: a standard decorator gets (prototype, key) — no context, no metadata", () => {
    expect(run(withTsc(true)).seen).toEqual(["legacy:path"]);
    expect(run(withEsbuild(true)).seen).toEqual(["legacy:path"]);
    expect(run(withEsbuild(true)).metadata).toBeNull();
  });

  it("Node itself runs neither: no native decorators, no Symbol.metadata", () => {
    expect(runInNewContext("typeof Symbol.metadata")).toBe("undefined");
    expect(() => {
      runInNewContext("class A { @x f }");
    }).toThrow(/Invalid or unexpected token/); // a SyntaxError from the sandbox realm
  });
});
