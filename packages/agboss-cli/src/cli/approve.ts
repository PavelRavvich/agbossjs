import { type App, type ExecutionOutput } from "agboss";
import type { ToolCallApprovalDecisionDto } from "agboss/dto";
import { userInfo } from "node:os";

/** Asks the human a question; undefined when input ended (Ctrl+D). */
export type Ask = (question: string) => Promise<string | undefined>;

/** Wraps a turn's work (loader, interrupt key); hands the work a signal to stop it. */
export type Busy = <T>(work: (signal: AbortSignal | undefined) => Promise<T>) => Promise<T>;

const idle: Busy = (work) => work(undefined);

/** The terminal's decision on a call: `by` is the OS user who answered. */
export function terminalDecision(approved: boolean): ToolCallApprovalDecisionDto {
  const by = userInfo().username;
  return approved ? { approved, by } : { approved, by, feedback: "declined in the terminal" };
}

/** A paused run asks in the terminal, then continues in the same process. */
export async function untilDone(
  first: ExecutionOutput,
  app: Pick<App, "resume">,
  ask: Ask,
  busy: Busy = idle,
): Promise<ExecutionOutput> {
  let result = first;
  while (result.pause !== undefined) {
    const { agent, tool, args } = result.pause;
    const reply = await ask(
      `${agent} wants to call ${tool} ${JSON.stringify(args)} — approve? [y/N] `,
    );
    const approved = /^y(es)?$/i.test((reply ?? "").trim());
    const { thread } = result;
    const decision = terminalDecision(approved);
    result = await busy((signal) => app.resume(thread, decision, { signal }));
  }
  return result;
}

/** First line under an replyWith: which conversation, and its trace when tracing is on. */
export function threadLine(result: Pick<ExecutionOutput, "thread" | "traceUrl">): string {
  return result.traceUrl === undefined
    ? `thread ${result.thread}`
    : `thread ${result.thread} · ${result.traceUrl}`;
}

/** `memory: turns 1–5 → summary 1/10` when this turn compacted the conversation. */
export function memoryLine(result: Pick<ExecutionOutput, "compacted">): string | undefined {
  const c = result.compacted;
  if (c === undefined) return undefined;
  return `memory: turns ${String(c.fromTurn)}–${String(c.toTurn)} → summary ${String(c.summaries)}/${String(c.keep)}`;
}

/** One line under an replyWith: route and why the run stopped. */
export function summaryLine(result: Pick<ExecutionOutput, "route" | "stopReason">): string {
  const route = result.route.length > 0 ? result.route.join(" → ") : "(none)";
  return `${route} · stop: ${result.stopReason}`;
}
