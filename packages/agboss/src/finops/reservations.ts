import type { SpendLedger } from "./ledger.js";
import { totalCost, type UsageRecord } from "./usage.js";

/**
 * What one run holds of its account's day (#202): reserved before its first paid call, shrunk by
 * every spend it records, released when it ends or pauses. Concurrent runs on one ledger see each
 * other's holds, so together they never get more than the day's cap.
 */
export interface SpendHold {
  /** What the run may spend: what it asked for, never more than the day has left. */
  readonly grantedUsd: number;
  /** The day's spend plus the other runs' holds when this one was granted. */
  readonly committedUsd: number;
  /** Writes spend to the ledger, then shrinks the hold by it. */
  readonly record: (records: readonly UsageRecord[]) => Promise<void>;
  /** Frees what is left of the hold; idempotent. */
  readonly release: () => void;
}

/** The account a hold is taken from: its ledger key and its daily cap (`Infinity` = none). */
export interface HoldAccount {
  readonly key: string;
  readonly dailyCap: number;
}

interface Hold {
  left: number;
}

/** Open holds per ledger and account key — in this process; every app sharing the ledger sees them. */
const holdsByLedger = new WeakMap<SpendLedger, Map<string, Set<Hold>>>();

function holdsOf(ledger: SpendLedger, key: string): Set<Hold> {
  let accounts = holdsByLedger.get(ledger);
  if (accounts === undefined) {
    accounts = new Map();
    holdsByLedger.set(ledger, accounts);
  }
  let holds = accounts.get(key);
  if (holds === undefined) {
    holds = new Set();
    accounts.set(key, holds);
  }
  return holds;
}

const heldBy = (holds: ReadonlySet<Hold>): number =>
  [...holds].reduce((sum, hold) => sum + hold.left, 0);

function holdOver(ledger: SpendLedger, key: string, holds: Set<Hold>, hold: Hold) {
  return {
    record: async (records: readonly UsageRecord[]): Promise<void> => {
      await ledger.record(key, records);
      hold.left = Math.max(0, hold.left - totalCost(records));
    },
    release: (): void => {
      hold.left = 0;
      holds.delete(hold);
    },
  };
}

/**
 * Reserves up to `wantUsd` of the account's day: the day's spend is read and the hold is taken with
 * no await in between, so two runs starting together cannot both take the same remainder. Without
 * a daily cap nothing is held. `grantedUsd` 0 = the day is spent (the caller fails the run).
 */
export async function reserveSpend(
  ledger: SpendLedger,
  account: HoldAccount,
  wantUsd: number,
): Promise<SpendHold> {
  const spent = await ledger.spentToday(account.key);
  if (!Number.isFinite(account.dailyCap)) {
    const free = { left: 0 };
    return {
      grantedUsd: wantUsd,
      committedUsd: spent,
      ...holdOver(ledger, account.key, new Set(), free),
    };
  }
  const holds = holdsOf(ledger, account.key);
  const committedUsd = spent + heldBy(holds);
  const grantedUsd = Math.max(0, Math.min(wantUsd, account.dailyCap - committedUsd));
  const hold: Hold = { left: grantedUsd };
  if (grantedUsd > 0) holds.add(hold);
  return { grantedUsd, committedUsd, ...holdOver(ledger, account.key, holds, hold) };
}
