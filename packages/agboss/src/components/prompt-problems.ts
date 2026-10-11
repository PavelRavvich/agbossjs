import path from "node:path";
import { ComponentError } from "./metadata.js";

/** Variables only a turn knows — valid in every prompt, filled at run time (`{{item}}`: a batch item). */
export const RUNTIME_PROMPT_VARIABLES: readonly string[] = ["item"];

/** Codes of the prompt checks at assembly — stable, for people and for tests. */
export type PromptProblemCode =
  "prompt.unknown-variable" | "prompt.missing-file" | "prompt.path-as-text";

/** One problem in a prompt: its code and where it is (`file:line …`). */
export interface PromptProblem {
  readonly code: PromptProblemCode;
  readonly message: string;
}

/** One `{{var}}` / `[code] message` line per problem, as `agboss check --prompts` prints them. */
export const promptProblemLine = (problem: PromptProblem): string =>
  `[${problem.code}] ${problem.message}`;

/** The workflow's prompts have problems — every one found, reported at once, before any model call. */
export class PromptError extends ComponentError {
  override name = "PromptError";
  readonly problems: readonly PromptProblem[];

  constructor(problems: readonly PromptProblem[]) {
    const lines = problems.map((problem) => `  - ${promptProblemLine(problem)}`);
    super(
      `The workflow's prompts have ${String(problems.length)} problem(s):\n${lines.join("\n")}`,
    );
    this.problems = problems;
  }
}

/** A prompt file as messages show it: relative to the working directory when it is inside it. */
export function displayPath(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative;
}

/** Every `{{key}}` of a text segment that is not a known variable, with its line. */
export function unknownVariables(
  where: string,
  text: string,
  known: readonly string[],
): PromptProblem[] {
  const knownSet = new Set(known);
  const list = known.length === 0 ? "(none)" : known.join(", ");
  return [...text.matchAll(/\{\{(\w+)\}\}/g)]
    .filter((match) => match[1] !== undefined && !knownSet.has(match[1]))
    .map((match) => {
      const line = text.slice(0, match.index).split("\n").length;
      return {
        code: "prompt.unknown-variable",
        message: `${where}:${String(line)} {{${match[1] ?? ""}}} — known: ${list}`,
      };
    });
}

const PATH_LIKE = /^(\.{1,2}\/)?[\w./-]+\.md$/;

/** An inline `prompt` that is just a `.md` path was meant as `promptUrls` — it would be sent as text. */
export function pathAsText(owner: string, prompt: string | undefined): PromptProblem[] {
  const text = (prompt ?? "").trim();
  if (!PATH_LIKE.test(text)) return [];
  return [
    {
      code: "prompt.path-as-text",
      message: `${owner}: prompt "${text}" is a file path, not prompt text — use promptUrls: ["${text}"]`,
    },
  ];
}
