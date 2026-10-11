import type { UsageRecord } from "../finops/usage.js";
import type { RouterEngine } from "../routers/index.js";

/** Texts of a guard: the question and what "flag" and "pass" mean. */
export interface GuardText {
  readonly question: string;
  readonly flag: string;
  readonly pass: string;
}

/** A configured guard, ready to check a text. */
export interface Guard extends GuardText {
  readonly name: string;
  readonly router: RouterEngine;
  /** Trips when P(flag) ≥ threshold. */
  readonly threshold: number;
  readonly refusal: string;
}

export interface GuardSet {
  readonly input: readonly Guard[];
  readonly output: readonly Guard[];
}

export const NO_GUARDS: GuardSet = { input: [], output: [] };

export type GuardVerdict =
  | { readonly kind: "pass"; readonly flagProbability: number; readonly usage?: UsageRecord }
  | { readonly kind: "tripped"; readonly flagProbability: number; readonly usage?: UsageRecord }
  | { readonly kind: "failed"; readonly reason: string; readonly usage?: UsageRecord };
