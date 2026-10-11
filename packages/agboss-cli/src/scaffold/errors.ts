/** A generator problem the user can fix (a name, a clash, an unexpected file); nothing was written. */
export class ScaffoldError extends Error {
  override name = "ScaffoldError";
}

/** The command line asks for something impossible: a bad name, a missing option, an unknown kind. */
export class ScaffoldUsageError extends ScaffoldError {
  override name = "ScaffoldUsageError";
}

/** What would be written is already there: a file, a wiring, a package.json script. */
export class ScaffoldConflictError extends ScaffoldError {
  override name = "ScaffoldConflictError";
}
