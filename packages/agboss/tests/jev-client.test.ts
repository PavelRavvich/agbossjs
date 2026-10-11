import { describe, expect, it, vi } from "vitest";
import { createJevClient, JevApiError, jevDecisionsUrl } from "../src/llm/jev-client.js";
import { OPENROUTER_BASE_URL } from "../src/models/index.js";

const request = {
  model: "typesafe/jev-1.13",
  state: "text",
  questions: { route: { type: "choice" as const, instructions: "i", criteria: { a: "a" } } },
};

describe("jevDecisionsUrl", () => {
  it("maps the OpenRouter chat base URL to the Decisions endpoint", () => {
    expect(jevDecisionsUrl(OPENROUTER_BASE_URL)).toBe("https://openrouter.ai/api/alpha/decisions");
  });
});

describe("createJevClient", () => {
  it("posts the request with bearer auth and returns the body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: 1 }), { status: 200 })),
    );
    const client = createJevClient({ apiKey: "k", baseUrl: OPENROUTER_BASE_URL }, fetchImpl);

    const body = await client(request);

    expect(body).toEqual({ ok: 1 });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer k" });
    expect(init?.body).toBe(JSON.stringify(request));
  });

  it("throws JevApiError with status and body on HTTP errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("insufficient credits", { status: 402 })),
    );
    const client = createJevClient({ apiKey: "k", baseUrl: OPENROUTER_BASE_URL }, fetchImpl);

    await expect(client(request)).rejects.toThrow(
      new JevApiError("Decisions API 402: insufficient credits"),
    );
  });
});
