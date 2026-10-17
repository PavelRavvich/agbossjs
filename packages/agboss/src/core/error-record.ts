import type { Class } from "../components/injection.js";
import type { ErrorDetails } from "./errors.js";

/**
 * An error as the flow keeps it in its state: plain JSON, so it survives a serialising checkpointer
 * (a resumed run still routes on it). `code` is the code of the error's class; `lineage` the codes
 * of its class and every class above it (`step.action`, `step`, `agboss`); `cause` the same for the
 * error it wraps.
 */
export interface ErrorRecord {
  readonly name: string;
  readonly code: string;
  /** The codes of the error's class and its parent classes, nearest first (Error excluded). */
  readonly lineage: readonly string[];
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

const codeOfConstructor = (constructor: unknown): string =>
  staticCodeOf(constructor) ?? (typeof constructor === "function" ? constructor.name : "Error");

const parentOf = (prototype: object): object | null => Reflect.getPrototypeOf(prototype);

/** The codes of an error's class and its parents up to `Error` (repeats of an inherited code once). */
function lineageOf(error: Error): readonly string[] {
  const codes: string[] = [];
  for (
    let prototype = parentOf(error);
    prototype !== null && prototype !== Error.prototype && prototype !== Object.prototype;
    prototype = parentOf(prototype)
  ) {
    const code = codeOfConstructor(Reflect.get(prototype, "constructor"));
    if (codes.at(-1) !== code) codes.push(code);
  }
  return codes.length === 0 ? ["Error"] : codes;
}

const detailsOf = (error: Error): ErrorDetails | undefined =>
  "details" in error && typeof error.details === "object" && error.details !== null
    ? Object.fromEntries(Object.entries(error.details))
    : undefined;

/** The record of a thrown value, its causes included (a non-`Error` reads as a plain `Error`). */
export function errorRecordOf(thrown: unknown): ErrorRecord {
  if (!(thrown instanceof Error)) {
    return { name: "Error", code: "Error", lineage: ["Error"], message: String(thrown) };
  }
  const details = detailsOf(thrown);
  const lineage = lineageOf(thrown);
  return {
    name: thrown.name,
    code: lineage[0] ?? "Error",
    lineage,
    message: thrown.message,
    ...(details === undefined ? {} : { details }),
    ...(thrown.cause === undefined ? {} : { cause: errorRecordOf(thrown.cause) }),
  };
}

/** How closely a handler's code matches a record: its distance in the class line and cause depth. */
export interface ErrorMatch {
  /** 0 = the error's own class, 1 = its parent, … */
  readonly distance: number;
  /** 0 = the error itself, 1 = its cause, … */
  readonly depth: number;
}

/** Where `code` matches the record or one of its causes, the closest class first; none = no match. */
export function errorMatchOf(
  record: ErrorRecord,
  code: string | undefined,
  depth = 0,
): ErrorMatch | undefined {
  const own = code === undefined ? -1 : record.lineage.indexOf(code);
  const here = own >= 0 ? { distance: own, depth } : undefined;
  const deeper =
    record.cause === undefined ? undefined : errorMatchOf(record.cause, code, depth + 1);
  if (here === undefined) return deeper;
  return deeper !== undefined && deeper.distance < here.distance ? deeper : here;
}

/** Whether a record (or one of its causes) is of the code, or of a class under it. */
export function recordMatches(record: ErrorRecord, code: string | undefined): boolean {
  return code === undefined || errorMatchOf(record, code) !== undefined;
}
