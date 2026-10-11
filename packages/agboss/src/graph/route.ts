import type { ChoiceTarget } from "./flow.js";
import type { PromptOptions } from "../components/prompt-options.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { file } from "../components/file.js";

/** What one choice of a router means, linking a target to its text condition. */
export interface RouteDeclaration extends PromptOptions {
  readonly target: ChoiceTarget;
}

/** The option name a router sees for `Self`. */
export const SELF_OPTION = "self";
