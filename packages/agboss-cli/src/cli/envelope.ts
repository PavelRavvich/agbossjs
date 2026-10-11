import type { CommandOutcome } from "./context.js";
import type { CliError } from "./errors.js";

/** What `--json` prints on stdout — one object, the same shape for every command (#198). */
export interface Envelope {
  readonly schema: 1;
  readonly ok: boolean;
  readonly command: string;
  readonly result?: unknown;
  readonly created?: readonly string[];
  readonly modified?: readonly string[];
  readonly warnings: readonly string[];
  readonly error?: { readonly code: string; readonly message: string };
}

/** The envelope of a command that ran (ok unless it reported a failure itself). */
export function envelopeOf(command: string, outcome: CommandOutcome): Envelope {
  return {
    schema: 1,
    ok: outcome.failure === undefined,
    command,
    ...(outcome.result === undefined ? {} : { result: outcome.result }),
    ...(outcome.created === undefined ? {} : { created: outcome.created }),
    ...(outcome.modified === undefined ? {} : { modified: outcome.modified }),
    warnings: outcome.warnings ?? [],
    ...(outcome.failure === undefined ? {} : { error: errorOf(outcome.failure) }),
  };
}

/** The envelope of a command that failed before or while running. */
export const failedEnvelope = (command: string, error: CliError): Envelope => ({
  schema: 1,
  ok: false,
  command,
  warnings: [],
  error: errorOf(error),
});

const errorOf = (error: CliError): { code: string; message: string } => ({
  code: error.code,
  message: oneLine(error.message),
});

/** Messages are one line: multi-line ones (rule lists) are joined. */
export const oneLine = (message: string): string =>
  message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");

export const envelopeText = (envelope: Envelope): string =>
  `${JSON.stringify(envelope, null, 2)}\n`;
