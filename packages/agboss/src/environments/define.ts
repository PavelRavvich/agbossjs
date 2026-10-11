/**
 * The app's environment contract (#182), Angular-style: each app adds its fields by module
 * augmentation in `src/environments/environment.ts` —
 * `declare module "agboss" { interface Environment { readonly apiUrl: string } }` — and every
 * `<name>.environment.ts` next to it is checked against it by `tsc`.
 */
declare const NO_FIELDS: unique symbol;

/** The contract; empty until an app adds its fields by declaration merging. */
export interface Environment {
  /** Never set: keeps the contract a type of its own until an app adds its fields. */
  readonly [NO_FIELDS]?: never;
}

const FROM_ENV = Symbol("agboss.fromEnv");
const DEFINED = Symbol("agboss.environment");

export interface FromEnvOptions {
  /** Used when the variable is not set; without it the variable is required. */
  readonly default?: string;
  /** Masked wherever the environment is printed (describe, traces, logs). */
  readonly secret?: boolean;
}

/** A value read from a process environment variable when the app starts. */
export interface FromEnv extends FromEnvOptions {
  readonly [FROM_ENV]: true;
  readonly variable: string;
}

/** `fromEnv("OPENROUTER_API_KEY", { secret: true })`, `fromEnv("CURRENCY", { default: "USD" })`. */
export const fromEnv = (variable: string, options: FromEnvOptions = {}): FromEnv => ({
  [FROM_ENV]: true,
  variable,
  ...options,
});

export const isFromEnv = (value: unknown): value is FromEnv =>
  typeof value === "object" && value !== null && FROM_ENV in value;

/** The values of one environment file: every field of the contract, a string field may be `fromEnv`. */
export type EnvironmentValues<E = Environment> = {
  readonly [K in keyof E]: E[K] | (E[K] extends string ? FromEnv : never);
};

/** What `defineEnvironment` returns: the default export of a `<name>.environment.ts`. */
export interface EnvironmentDefinition {
  readonly [DEFINED]: true;
  readonly values: Readonly<Record<string, unknown>>;
}

/** `export default defineEnvironment({ … })` — typed by `Environment`: a missing field is a tsc error. */
export const defineEnvironment = (values: EnvironmentValues): EnvironmentDefinition => ({
  [DEFINED]: true,
  values,
});

export const isEnvironmentDefinition = (value: unknown): value is EnvironmentDefinition =>
  typeof value === "object" && value !== null && DEFINED in value;
