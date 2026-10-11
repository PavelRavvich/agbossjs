import { describe, expect, it, vi } from "vitest";
import { A2AAgent, A2AClient, A2ARemoteError } from "../../src/a2a/index.js";
import { ComponentError } from "../../src/components/metadata.js";
import { DtoValidationError, Text } from "../../src/dto/index.js";

class Answer {
  @Text()
  text!: string;
}

const jsonFetch = (body: unknown) =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
    );

describe("A2AClient", () => {
  it("posts { input } to <url>/execute and returns the output validated by the DTO", async () => {
    const fetcher = jsonFetch({ status: "answered", reply: "hi", output: { text: "hi" } });
    const client = new A2AClient({ url: "http://desk", fetcher });

    const result = await client.execute({ text: "q" }, Answer);

    expect(result).toEqual({ text: "hi" });
    expect(fetcher).toHaveBeenCalledWith(
      "http://desk/execute",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ input: { text: "q" } }) }),
    );
  });

  it("rejects an output the DTO does not accept", async () => {
    const fetcher = jsonFetch({ status: "answered", reply: "", output: { text: 42 } });

    await expect(
      new A2AClient({ url: "http://desk", fetcher }).execute({ text: "q" }, Answer),
    ).rejects.toBeInstanceOf(DtoValidationError);
  });

  it("throws A2ARemoteError for any status but answered", async () => {
    const fetcher = jsonFetch({ status: "limited", reply: "", error: "limits.perRun.cost" });

    await expect(
      new A2AClient({ url: "http://desk", fetcher }).execute({ text: "q" }, Answer),
    ).rejects.toBeInstanceOf(A2ARemoteError);
  });

  it("passes the abort signal to fetch", async () => {
    const fetcher = jsonFetch({ status: "answered", reply: "", output: { text: "" } });
    const ac = new AbortController();

    await new A2AClient({ url: "http://desk", fetcher }).send({ text: "q" }, { signal: ac.signal });

    expect(fetcher).toHaveBeenCalledWith(
      "http://desk/execute",
      expect.objectContaining({ signal: ac.signal }),
    );
  });

  it("takes its url from @A2AAgent at construction", () => {
    @A2AAgent({ name: "desk", url: "http://desk.internal" })
    class Desk extends A2AClient {}

    expect(new Desk().url).toBe("http://desk.internal");
  });

  it("without @A2AAgent and without a url it fails at construction", () => {
    class Bare extends A2AClient {}

    expect(() => new Bare()).toThrow(ComponentError);
    expect(() => new Bare()).toThrow(/a2a\.no-url/);
  });
});
