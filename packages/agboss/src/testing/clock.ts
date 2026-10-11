import type { Clock } from "../finops/ledger.js";
import { TestSetupError } from "./errors.js";

/** A duration with its unit: `"500ms"`, `"30s"`, `"5m"`, `"25h"`, `"2d"`. */
export type ClockDuration = `${number}${"ms" | "s" | "m" | "h" | "d"}`;

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

const isUnit = (unit: string): unit is keyof typeof UNIT_MS => Object.hasOwn(UNIT_MS, unit);

/** Milliseconds of a duration. */
export function millisecondsOf(duration: ClockDuration): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(duration);
  const unit = match?.[2] ?? "";
  if (match === null || !isUnit(unit)) {
    throw new TestSetupError(`Not a duration: "${duration}" (e.g. "30s", "25h")`);
  }
  return Number(match[1]) * UNIT_MS[unit];
}

/** The time of one test: fixed at the start, moved only by `advance`. */
export interface TestClock {
  readonly now: Clock;
  /** Moves the time forward, e.g. past midnight UTC: `app.clock.advance("25h")`. */
  advance(duration: ClockDuration): void;
}

/** Every test starts at the same moment, so runs and days are reproducible. */
export const TEST_START = "2026-01-05T09:00:00.000Z";

export function createTestClock(start: string = TEST_START): TestClock {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (duration) => {
      current += millisecondsOf(duration);
    },
  };
}
