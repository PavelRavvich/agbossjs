import { A2AEventSchema, type A2AEvent, type A2AExecutionResponse } from "./types.js";

/** The events in a chunk of server-sent events text, and the unfinished rest. */
function splitEvents(buffer: string): { readonly events: A2AEvent[]; readonly rest: string } {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events = blocks.flatMap((block) =>
    block
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => A2AEventSchema.parse(JSON.parse(line.slice("data: ".length)))),
  );
  return { events, rest };
}

/** Reads an A2A event stream: progress events go to `onEvent`, the `finish` event is the response. */
export async function readEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: ((event: A2AEvent) => void) | undefined,
): Promise<A2AExecutionResponse> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    const { events, rest } = splitEvents(buffer + decoder.decode(chunk, { stream: true }));
    buffer = rest;
    for (const event of events) {
      if (event.type === "finish") return event.payload.result;
      onEvent?.(event);
    }
  }
  throw new Error("A2A stream closed without a finish event");
}
