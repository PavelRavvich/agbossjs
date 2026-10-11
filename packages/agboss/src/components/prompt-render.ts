import fs from "node:fs/promises";
import path from "node:path";
import type { PromptOptions } from "./prompt-options.js";
import type { PromptInput } from "./prompt-input.js";
import type { FlowStateType } from "../graph/flow-state.js";
import { renderTemplate } from "./render-template.js";
import { ComponentError } from "./metadata.js";
import {
  fillInputFields,
  unknownInputFields,
  type KnownInputFields,
} from "./prompt-input-fields.js";
import {
  displayPath,
  pathAsText,
  PromptError,
  RUNTIME_PROMPT_VARIABLES,
  unknownVariables,
  type PromptProblem,
} from "./prompt-problems.js";

/**
 * A prompt as assembled: renders one turn's text. `text` is the prompt with its static variables
 * filled and the runtime ones left as `{{item}}` — what the prompt version hashes.
 */
export type RenderedPrompt = PromptInput & { readonly text: string };

/** The assembled text of a prompt input (`RenderedPrompt`, a profile's override), if it carries one. */
export const promptTextOf = (input: unknown): string | undefined =>
  typeof input === "function" && "text" in input && typeof input.text === "string"
    ? input.text
    : undefined;

/** Whose prompt it is (`@Agent "scout"`), its options and the file it is declared in. */
export interface PromptOwner {
  readonly label: string;
  readonly options: PromptOptions | undefined;
  readonly source: string | undefined;
  /** The owner's own variables, over the loader's (the workflow's). */
  readonly variables?: Readonly<Record<string, unknown>>;
}

interface Segment {
  readonly where: string;
  readonly text: string;
}

/** The variables of one turn: the static ones plus `item` (objects as JSON; "" outside a batch). */
const withItem = (
  variables: Readonly<Record<string, unknown>>,
  item: unknown,
): Readonly<Record<string, unknown>> => ({ ...variables, item: item ?? "" });

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "EISDIR");

/**
 * Reads and checks every prompt of a workflow at assembly — files read eagerly, every `{{var}}`
 * checked against the known variables — and collects the problems to report them all at once.
 */
export class PromptLoader {
  readonly #problems: PromptProblem[] = [];
  readonly #variables: Readonly<Record<string, unknown>>;
  readonly #inputFields: KnownInputFields;

  /** `inputFields`: what `{{input.<field>}}` may name (the workflow's starts); `undefined` = unchecked. */
  constructor(variables: Readonly<Record<string, unknown>> = {}, inputFields?: KnownInputFields) {
    this.#variables = variables;
    this.#inputFields = inputFields;
  }

  /** The owner's prompt, checked; problems are kept for `throwIfAny`. */
  async load(owner: PromptOwner): Promise<RenderedPrompt> {
    const variables = { ...this.#variables, ...(owner.variables ?? {}) };
    const known = [...Object.keys(variables), ...RUNTIME_PROMPT_VARIABLES];
    const segments = await this.#segments(owner);
    segments.forEach((segment) => {
      this.#problems.push(...unknownVariables(segment.where, segment.text, known));
      this.#problems.push(...unknownInputFields(segment.where, segment.text, this.#inputFields));
    });
    const template = segments.map((segment) => segment.text).join("\n\n");
    const unknown = (key: string) =>
      new ComponentError(`${owner.label}: unknown prompt variable {{${key}}}`);
    const runtimeAsIs = Object.fromEntries(RUNTIME_PROMPT_VARIABLES.map((k) => [k, `{{${k}}}`]));
    const text =
      this.#problems.length > 0
        ? template
        : renderTemplate(template, { ...variables, ...runtimeAsIs }, unknown);
    // `{{input.<field>}}` after the template: a start input value is never read as a template
    const render = (
      state?: Partial<Pick<FlowStateType, "batchItem" | "startInput">>,
    ): Promise<string> =>
      Promise.resolve(
        fillInputFields(
          renderTemplate(template, withItem(variables, state?.batchItem), unknown),
          state?.startInput,
          owner.label,
        ),
      );
    return Object.assign(render, { text });
  }

  /** Throws `PromptError` with every problem found so far. */
  throwIfAny(): void {
    if (this.#problems.length > 0) throw new PromptError(this.#problems);
  }

  async #segments(owner: PromptOwner): Promise<Segment[]> {
    const { options, source, label } = owner;
    if (options === undefined) return [];
    this.#problems.push(...pathAsText(label, options.prompt));
    const inline = options.prompt ? [{ where: `${label} prompt`, text: options.prompt }] : [];
    const urls = options.promptUrls ?? [];
    if (urls.length === 0) return inline;
    if (source === undefined) {
      const message = `${label}: cannot resolve promptUrls — the declaring file is unknown`;
      this.#problems.push({ code: "prompt.missing-file", message });
      return inline;
    }
    const files = await Promise.all(
      urls.map((url) => this.#read(label, path.resolve(path.dirname(source), url))),
    );
    return [...inline, ...files.filter((file): file is Segment => file !== undefined)];
  }

  async #read(label: string, file: string): Promise<Segment | undefined> {
    try {
      return { where: displayPath(file), text: await fs.readFile(file, "utf-8") };
    } catch (error) {
      if (!isMissing(error)) throw error;
      const message = `${displayPath(file)} (promptUrls of ${label}) does not exist`;
      this.#problems.push({ code: "prompt.missing-file", message });
      return undefined;
    }
  }
}
