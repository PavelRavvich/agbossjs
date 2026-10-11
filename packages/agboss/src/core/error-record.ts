import type { Class } from "../components/injection.js";
import type { ErrorDetails } from "./errors.js";

/**
 * An error as the flow keeps it in its state: plain JSON, so it survives a serialising checkpointer
 * (a resumed run still routes on it). `code` is the code of the error's class; `cause` the same for
 * the error it wraps.
 */
export interface ErrorRecord {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly details?: ErrorDetails;
  readonly cause?: ErrorRecord;
}

const staticCodeOf = (cls: unknown): string | undefined =>
  typeof cls === "function" && "code" in cls && typeof cls.code === "string" ? cls.code : undefined;

/**
 * The code a class is caught by: its `static code` (every framework error has one; a user error
 * class may declare one), else its class name. `undefined` for `Error`: it catches everything.
 */
export function codeOfErrorClass(cls: Class): string | undefined {
  if (cls === Error) return undefined;
  return staticCodeOf(cls) ?? cls.name;
}

const codeOfError = (error: Error): string =>
  staticCodeOf(error.constructor) ?? error.constructor.name;

const detailsOf = (error: Error): ErrorDetails | undefined =>
  "details" in error && typeof error.details === "object" && error.details !== null
    ? Object.fromEntries(Object.entries(error.details))
    : undefined;

/** The record of a thrown value, its causes included (a non-`Error` reads as a plain `Error`). */
export function errorRecordOf(thrown: unknown): ErrorRecord {
  if (!(thrown instanceof Error)) return { name: "Error", code: "Error", message: String(thrown) };
  const details = detailsOf(thrown);
  return {
    name: thrown.name,
    code: codeOfError(thrown),
    message: thrown.message,
    ...(details === undefined ? {} : { details }),
    ...(thrown.cause === undefined ? {} : { cause: errorRecordOf(thrown.cause) }),
  };
}

/** Whether a record (or one of its causes) is of the code, or of a code under it (`limit.budget` under `limit`). */
export function recordMatches(record: ErrorRecord, code: string | undefined): boolean {
  if (code === undefined || record.code === code || record.code.startsWith(`${code}.`)) return true;
  return record.cause !== undefined && recordMatches(record.cause, code);
}
