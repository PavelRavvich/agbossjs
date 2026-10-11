import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { optionsOf, type CommandSpec } from "./options.js";
import { usageError } from "./errors.js";
import type { OptionValues } from "./context.js";

export interface ParsedCommand {
  readonly values: OptionValues;
  readonly positionals: readonly string[];
}

/** The node:util parser config of a command's schema (its options and the common ones). */
function configOf(spec: CommandSpec): ParseArgsOptionsConfig {
  return Object.fromEntries(
    optionsOf(spec).map((option) => [
      option.name,
      {
        type: option.type,
        ...(option.short === undefined ? {} : { short: option.short }),
        ...(option.default === undefined ? {} : { default: option.default }),
      },
    ]),
  );
}

const hasCode = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && "code" in error && typeof error.code === "string";

/** node:util's message names the flag in quotes: `Unknown option '--x'`. */
const flagIn = (message: string): string => /'(-[^' ]+)/.exec(message)?.[1] ?? "?";

function parseError(command: string, error: Error & { code: string }) {
  const flag = flagIn(error.message);
  switch (error.code) {
    case "ERR_PARSE_ARGS_UNKNOWN_OPTION":
      return usageError(command, "usage.unknown-option", `unknown option ${flag}`);
    case "ERR_PARSE_ARGS_INVALID_OPTION_VALUE":
      return usageError(command, "usage.option-value", `option ${flag} needs a value`);
    default:
      return usageError(command, "usage.invalid", error.message.split("\n")[0] ?? "");
  }
}

/** node:util's strict parse; its errors → usage errors naming the flag. */
function parseStrict(command: string, spec: CommandSpec, argv: readonly string[]): ParsedCommand {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: configOf(spec),
      allowPositionals: true,
      strict: true,
    });
    // no option is `multiple`: every value is a string or a boolean
    const single = Object.entries(values).map(
      ([name, value]) => [name, Array.isArray(value) ? undefined : value] as const,
    );
    return { values: Object.fromEntries(single), positionals };
  } catch (error) {
    if (hasCode(error) && error.code.startsWith("ERR_PARSE_ARGS")) throw parseError(command, error);
    throw error;
  }
}

/** Parses `argv` (after the command name) against the command's schema; usage errors → exit 2. */
export function parseCommand(
  command: string,
  spec: CommandSpec,
  argv: readonly string[],
): ParsedCommand {
  const parsed = parseStrict(command, spec, argv);
  const missing = spec.options.find(
    (option) => option.required === true && parsed.values[option.name] === undefined,
  );
  if (missing !== undefined)
    throw usageError(command, "usage.missing-option", `missing required option --${missing.name}`);
  if (spec.positionals === undefined && parsed.positionals.length > 0)
    throw usageError(
      command,
      "usage.unexpected-argument",
      `unexpected argument "${parsed.positionals[0] ?? ""}"`,
    );
  return parsed;
}

/** `--help` / `-h` anywhere after the command, before parsing (help never fails on other flags). */
export const asksForHelp = (argv: readonly string[]): boolean =>
  argv.includes("--help") || argv.includes("-h");
