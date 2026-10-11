import { inspect } from "node:util";
import { isFromEnv, type Environment, type EnvironmentDefinition, type FromEnv } from "./define.js";

/** An environment that cannot be used: not found, or variables missing (`code` tells which). */
export class EnvironmentError extends Error {
  override name = "EnvironmentError";
  constructor(
    readonly code: "environment.not-found" | "environment.missing-variables",
    message: string,
  ) {
    super(message);
  }
}

const MASK = "***";

/** The secret fields of each resolved environment: masked wherever it is printed. */
const secretFields = new WeakMap<object, ReadonlySet<string>>();

const secretsOf = (environment: object): ReadonlySet<string> =>
  secretFields.get(environment) ?? new Set();

/** The environment as it may be printed: every secret field masked. */
const maskedEnvironment = (environment: object): Record<string, unknown> => {
  const secrets = secretsOf(environment);
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [key, secrets.has(key) ? MASK : value]),
  );
};

/** The values of a `defineEnvironment` file: tsc checked them against the `Environment` contract. */
const checkedByTsc = (values: object): values is Environment => typeof values === "object";

/** Frozen values that print masked: `JSON.stringify` (traces) and `console.log` (logs). */
function sealed(values: Record<string, unknown>, secrets: ReadonlySet<string>): Environment {
  secretFields.set(values, secrets);
  Object.defineProperty(values, "toJSON", { value: () => maskedEnvironment(values) });
  Object.defineProperty(values, inspect.custom, { value: () => maskedEnvironment(values) });
  const frozen = Object.freeze(values);
  if (!checkedByTsc(frozen)) throw new EnvironmentError("environment.not-found", "unreachable");
  return frozen;
}

/** No values: what tools see while they are only described (`agboss describe` without an environment). */
export const NO_ENVIRONMENT_VALUES: Environment = sealed({}, new Set());

const valueOf = (spec: FromEnv, processEnv: NodeJS.ProcessEnv): string | undefined =>
  processEnv[spec.variable] ?? spec.default;

/** Every value of an environment file, its secret fields and the variables it misses. */
function valuesOf(definition: EnvironmentDefinition, processEnv: NodeJS.ProcessEnv) {
  const missing: string[] = [];
  const secrets = new Set<string>();
  const values: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(definition.values)) {
    if (!isFromEnv(spec)) {
      values[key] = spec;
      continue;
    }
    if (spec.secret === true) secrets.add(key);
    const value = valueOf(spec, processEnv);
    if (value === undefined) missing.push(spec.variable);
    values[key] = value;
  }
  return { values: sealed(values, secrets), missing: [...new Set(missing)] };
}

/**
 * Resolves every `fromEnv` of an environment file against the process environment; fails naming every
 * missing variable at once: `Environment "staging": missing variables OPENROUTER_API_KEY, CURRENCY`.
 */
export function resolveEnvironment(
  name: string,
  definition: EnvironmentDefinition,
  processEnv: NodeJS.ProcessEnv,
): Environment {
  const { values, missing } = valuesOf(definition, processEnv);
  if (missing.length > 0) {
    throw new EnvironmentError(
      "environment.missing-variables",
      `Environment "${name}": missing variables ${missing.join(", ")}`,
    );
  }
  return values;
}

/** An environment as `agboss describe` shows it: its values (missing ones unset) and printable fields. */
export interface DescribedEnvironment {
  readonly name: string;
  readonly values: Environment;
  /** Field → how it prints: secrets masked, a missing variable named. */
  readonly fields: Readonly<Record<string, string>>;
}

/** An environment file for `agboss describe`: secrets masked, a missing variable shown, nothing fails. */
export function describedEnvironment(
  name: string,
  definition: EnvironmentDefinition,
  processEnv: NodeJS.ProcessEnv,
): DescribedEnvironment {
  const fields = Object.fromEntries(
    Object.entries(definition.values).map(([key, spec]) => {
      if (!isFromEnv(spec)) return [key, JSON.stringify(spec)];
      const value = valueOf(spec, processEnv);
      if (value === undefined) return [key, `<missing ${spec.variable}>`];
      return [key, spec.secret === true ? `${MASK} (${spec.variable})` : JSON.stringify(value)];
    }),
  );
  return { name, values: valuesOf(definition, processEnv).values, fields };
}
