import type { Milliseconds } from "../../src/units/index.js";
import { seconds } from "../../src/units/index.js";

/** A short duration for tests (the public units start at seconds). */
export const milliseconds = (amount: number): Milliseconds => seconds(amount / 1000);
