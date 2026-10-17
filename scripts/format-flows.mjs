#!/usr/bin/env node
// `make fmt` for the flow files (#289, scripts/flow-style.mjs): Prettier's layout, with every call
// of a chain on its own line. Prettier joins a short chain onto one line unless the chain holds a
// comment, so each chained call (depth > 1, as `newline-per-chained-call` counts it) gets a marker
// line comment after its object (a trailing line comment does not count in Prettier's line width),
// Prettier formats the file, and the markers are removed.
// Usage: node scripts/format-flows.mjs [files…] (default: every flow file tracked by git).
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Linter } from "eslint";
import * as prettier from "prettier";
import tseslint from "typescript-eslint";
import { FLOW_FILES } from "./flow-style.mjs";

const REPO = realpathSync(new URL("..", import.meta.url).pathname);
const MARK = "//@@one-call-per-line@@\n";
const MARKS = /[ \t]*\/\/@@one-call-per-line@@[ \t]*$/gm;

const unwrap = (node) => (node?.type === "ChainExpression" ? node.expression : node);

/** How deep `node` (a call on a member) is in its chain, counted as the stylistic rule counts it. */
function depthOf(callee) {
  let parent = unwrap(callee.object);
  let depth = 1;
  while (parent && "callee" in parent && parent.callee) {
    depth += 1;
    const parentCallee = unwrap(parent.callee);
    if (!("object" in parentCallee)) break;
    parent = unwrap(parentCallee.object);
  }
  return depth;
}

/** Reports, for every chained call, the gap between its object (and comments) and its `.`. */
const chainedCalls = {
  create(context) {
    const source = context.sourceCode;
    return {
      "CallExpression:exit"(node) {
        const callee = unwrap(node.callee);
        if (callee.type !== "MemberExpression" || depthOf(callee) <= 1) return;
        const dot = source.getTokenAfter(callee.object, (token) => token.value !== ")");
        const end = source.getTokenBefore(dot, { includeComments: true }).range[1];
        context.report({ node, message: `${String(end)}:${String(dot.range[0])}` });
      },
    };
  },
};

const linter = new Linter({ configType: "flat" });
const CONFIG = [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    plugins: { flow: { rules: { "chained-calls": chainedCalls } } },
    rules: { "flow/chained-calls": "error" },
  },
];

/** The text of `file` formatted by Prettier with one call per line in every chain. */
export async function formatFlow(text, file) {
  // parsed under a name of its own: the config matches it wherever `file` is
  const messages = linter.verify(text, CONFIG, "flow.ts");
  const fatal = messages.find((message) => message.fatal);
  if (fatal) throw new Error(`${file}:${String(fatal.line)}: ${fatal.message}`);
  const reports = messages.filter((message) => message.ruleId === "flow/chained-calls");
  const gaps = [...new Set(reports.map((message) => message.message))]
    .map((gap) => gap.split(":").map(Number))
    .sort(([a], [b]) => b - a);
  let marked = text;
  // the marker ends the line: the blank between the object and its `.` goes, or no blank line stays
  for (const [end, dot] of gaps) marked = marked.slice(0, end) + MARK + marked.slice(dot);
  const options = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(marked, { ...options, filepath: file });
  return formatted.replace(MARKS, "").replace(/[ \t]+$/gm, "");
}

/** Every file tracked by git that the flow style covers. */
function flowFiles() {
  const globs = FLOW_FILES.map((glob) => `:(glob)${glob}`);
  const tracked = execFileSync("git", ["ls-files", "--", ...globs], {
    cwd: REPO,
    encoding: "utf8",
  });
  return tracked
    .split("\n")
    .filter((file) => file !== "")
    .map((file) => join(REPO, file));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : flowFiles();
  let changed = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const formatted = await formatFlow(text, file);
    if (formatted === text) continue;
    writeFileSync(file, formatted);
    changed += 1;
    console.log(relative(process.cwd(), file));
  }
  console.log(`format-flows: ${String(changed)} of ${String(files.length)} flow files changed`);
}
