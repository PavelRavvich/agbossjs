import { z } from "zod";

/** What starts an execution (external input, validated here): its start, its input, its thread. */
export const RunInputSchema = z.object({
  /** The `name` of the workflow start the execution begins at. */
  start: z.string().min(1),
  /** The start's input as given; checked against the start's `input` before anything runs. */
  input: z.unknown(),
  /** Omit on first contact: a new thread is created and returned. */
  threadId: z.string().min(1).optional(),
});

export type RunInput = z.infer<typeof RunInputSchema>;
