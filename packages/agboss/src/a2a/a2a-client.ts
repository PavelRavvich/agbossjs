import { ComponentError, componentOf } from "../components/metadata.js";
import { validate } from "../dto/schema.js";
import type { DtoClass } from "../dto/types.js";
import { readEvents } from "./a2a-sse.js";
import {
  A2AResponseSchema,
  type A2AEvent,
  type A2AExecutionRequest,
  type A2AExecutionResponse,
} from "./types.js";

export interface A2AClientOptions {
  /** The remote agent's base URL; default: `@A2AAgent({ url })` of the class. */
  readonly url?: string;
  readonly headers?: Record<string, string>;
  /** Pluggable fetch implementation (tests, proxies). */
  readonly fetcher?: typeof fetch;
}

/** Per call: progress events of the remote run, a signal that aborts the call, the thread to continue. */
export interface A2AClientCall {
  readonly onEvent?: (event: A2AEvent) => void;
  readonly signal?: AbortSignal;
  readonly thread?: string;
}

/** The remote run did not answer: its status, error and the full response. */
export class A2ARemoteError extends Error {
  override name = "A2ARemoteError";
  constructor(readonly response: A2AExecutionResponse) {
    super(
      `A2A remote run ended "${response.status}"${response.error === undefined ? "" : `: ${response.error}`}`,
    );
  }
}

/** The url `@A2AAgent` recorded on the class being constructed. */
function urlOf(target: object, name: string): string {
  const meta = componentOf(target);
  if (meta?.kind !== "a2a-agent") {
    throw new ComponentError(
      `[a2a.no-url] ${name} has no @A2AAgent({ url }) and no url option — the remote agent's address is unknown`,
    );
  }
  return meta.meta.url;
}

/**
 * Calls a workflow exposed over A2A (`a2aHttpListener`). Subclass it with `@A2AAgent({ name, url,
 * deps })` and inject it like any provider; `execute(input, OutputDto)` returns the remote output
 * validated by the DTO.
 */
export class A2AClient {
  readonly url: string;

  private readonly fetcher: typeof fetch;

  private readonly headers: Record<string, string>;

  constructor(options: A2AClientOptions = {}) {
    this.url = options.url ?? urlOf(new.target, new.target.name);
    this.fetcher = options.fetcher ?? fetch;
    this.headers = options.headers ?? {};
  }

  /** Extra headers per call (e.g. a fresh token); override in a subclass. */
  protected getHeaders(): Promise<Record<string, string>> {
    return Promise.resolve({});
  }

  /** Runs the remote workflow and returns its output checked by `output`; any other status throws. */
  public async execute<T extends object>(
    input: unknown,
    output: DtoClass<T>,
    call: A2AClientCall = {},
  ): Promise<T> {
    const response = await this.send(input, call);
    if (response.status !== "answered") throw new A2ARemoteError(response);
    return validate(output, response.output);
  }

  /** Runs the remote workflow and returns its response whatever the status. */
  public async send(input: unknown, call: A2AClientCall = {}): Promise<A2AExecutionResponse> {
    const body: A2AExecutionRequest = {
      input,
      ...(call.thread === undefined ? {} : { thread: call.thread }),
    };
    const streaming = call.onEvent !== undefined;
    const response = await this.fetcher(`${this.url}/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: streaming ? "text/event-stream" : "application/json",
        ...this.headers,
        ...(await this.getHeaders()),
      },
      body: JSON.stringify(body),
      ...(call.signal === undefined ? {} : { signal: call.signal }),
    });
    if (!response.ok) {
      throw new Error(`A2A request to ${this.url} failed with status ${String(response.status)}`);
    }
    const isStream = (response.headers.get("content-type") ?? "").includes("text/event-stream");
    if (isStream && response.body !== null) {
      return readEvents(response.body, call.onEvent);
    }
    return A2AResponseSchema.parse(await response.json());
  }
}
