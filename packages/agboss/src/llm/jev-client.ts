import type { DecisionQuestions, DecisionState } from "./decisions.js";

/** Where the Decisions API is: OpenRouter's base URL and key. */
export interface JevConnection {
  readonly apiKey: string;
  readonly baseUrl: string;
}

/** A Decisions API request: `POST {base}/alpha/decisions` with `{ model, state, questions }`. */
export interface JevDecisionRequest {
  readonly model: string;
  /** What the decision is made about: a text, a JSON object, or text and image parts. */
  readonly state: DecisionState;
  readonly questions: DecisionQuestions;
}

/** Raw transport; the response is validated by the caller. */
export type JevClient = (request: JevDecisionRequest) => Promise<unknown>;

export class JevApiError extends Error {
  override name = "JevApiError";
}

export function jevDecisionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/v1\/?$/, "")}/alpha/decisions`;
}

/** A decision that gets no answer in time fails (a router falls back as usual). */
export const JEV_TIMEOUT_MS = 30_000;

/** OpenRouter Decisions API (alpha): POST {base}/alpha/decisions, for every decision model. */
export function createJevClient(
  connection: JevConnection,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = JEV_TIMEOUT_MS,
): JevClient {
  const url = jevDecisionsUrl(connection.baseUrl);
  return async (request) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new JevApiError(`Decisions API ${String(response.status)}: ${await response.text()}`);
    }
    const body: unknown = await response.json();
    return body;
  };
}
