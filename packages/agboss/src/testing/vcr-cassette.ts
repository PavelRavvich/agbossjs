import type { MessageContent, ToolCall, UsageMetadata } from "@langchain/core/messages";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DecisionOutcome } from "../llm/decision-response.js";
import type { RouteOutcome } from "../routers/index.js";
import { stableJson, versionOf } from "../terns/index.js";
import { CassetteMissingError } from "./errors.js";

/** A model's reply as a cassette keeps it: enough to rebuild the `AIMessage` it returned. */
export interface StoredReply {
  readonly content: MessageContent;
  readonly tool_calls?: ToolCall[];
  readonly usage_metadata?: UsageMetadata;
  readonly response_metadata?: Record<string, unknown>;
}

const isObject = (value: unknown): boolean => typeof value === "object" && value !== null;

const ChatInteraction = z.strictObject({
  kind: z.literal("chat"),
  key: z.string(),
  request: z.string(),
  reply: z.custom<StoredReply>(isObject),
});

const DecisionInteraction = z.strictObject({
  kind: z.literal("decision"),
  key: z.string(),
  request: z.string(),
  outcome: z.custom<RouteOutcome>(isObject),
});

const DecideInteraction = z.strictObject({
  kind: z.literal("decide"),
  key: z.string(),
  request: z.string(),
  outcome: z.custom<DecisionOutcome>(isObject),
});

const Interaction = z.discriminatedUnion("kind", [
  ChatInteraction,
  DecisionInteraction,
  DecideInteraction,
]);
type Interaction = z.infer<typeof Interaction>;

const CassetteFile = z.strictObject({ version: z.literal(1), interactions: z.array(Interaction) });

/** The request hash an interaction is found by: equal requests → equal hashes, on every machine. */
export const requestHashOf = (request: unknown): string => versionOf(request);

const RE_RECORD = "re-record it: run the test with vcr mode RECORD (and a model key)";

function readCassette(file: string): Interaction[] {
  if (!fs.existsSync(file)) {
    throw new CassetteMissingError(`no cassette ${file} — ${RE_RECORD}`);
  }
  const parsed = CassetteFile.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new CassetteMissingError(
      `${file} is not a cassette (${parsed.error.message}) — ${RE_RECORD}`,
    );
  }
  return parsed.data.interactions;
}

/**
 * The recorded model calls of one test: agents, judges, compaction (`chat`) and every router,
 * guard decision, Jev included (`decision`), every judge's `decide` on a decision model (`decide`), each under its script key
 * (`agent:<name>`, `judge:<name>`, `router:<name>`, `compaction`) and request hash. Replay
 * returns the n-th recording of an equal request in order; anything unrecorded is a
 * `CassetteMissingError`, reported through `report` so the test fails even when the run swallows it.
 */
export class Cassette {
  readonly #used = new Map<string, number>();

  private constructor(
    readonly file: string,
    readonly recording: boolean,
    private readonly interactions: Interaction[],
    private readonly report: (failure: Error) => Error,
  ) {}

  /** Replays `file`; a missing or unreadable cassette fails here, before the test runs. */
  static replaying(file: string, report: (failure: Error) => Error): Cassette {
    return new Cassette(file, false, readCassette(file), report);
  }

  /** Records into `file` from scratch, writing it after every call. */
  static recording(file: string): Cassette {
    return new Cassette(file, true, [], (failure) => failure);
  }

  chat(key: string, request: string): StoredReply {
    const found = this.#take("chat", key, request);
    if (found?.kind !== "chat") throw this.#missing(key);
    return found.reply;
  }

  decision(key: string, request: string): RouteOutcome {
    const found = this.#take("decision", key, request);
    if (found?.kind !== "decision") throw this.#missing(key);
    return found.outcome;
  }

  /** A judge's `ctx.model.decide` (a decision model's answers and cost). */
  decide(key: string, request: string): DecisionOutcome {
    const found = this.#take("decide", key, request);
    if (found?.kind !== "decide") throw this.#missing(key);
    return found.outcome;
  }

  record(interaction: Interaction): void {
    this.interactions.push(interaction);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const content = { version: 1, interactions: this.interactions };
    fs.writeFileSync(this.file, `${JSON.stringify(JSON.parse(stableJson(content)), null, 2)}\n`);
  }

  #take(kind: Interaction["kind"], key: string, request: string): Interaction | undefined {
    const id = `${kind} ${key} ${request}`;
    const n = this.#used.get(id) ?? 0;
    this.#used.set(id, n + 1);
    return this.interactions.filter(
      (i) => i.kind === kind && i.key === key && i.request === request,
    )[n];
  }

  #missing(key: string): Error {
    const recorded = this.interactions.filter((i) => i.key === key).length;
    return this.report(
      new CassetteMissingError(
        `${this.file} has no recording of this ${key} request (${String(recorded)} recorded for ${key}: a prompt, tool or input changed) — ${RE_RECORD}`,
      ),
    );
  }
}
