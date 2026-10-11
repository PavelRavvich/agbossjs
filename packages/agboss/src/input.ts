import { z } from "zod";

/** External input is validated here; inside the system types are trusted. */
export const RunInputSchema = z.object({
  task: z.string().trim().min(1, "task must not be empty"),
  /** Omit on first contact: a new thread is created and returned. */
  threadId: z.string().min(1).optional(),
  /** The workflow start the run begins at (name); default: the workflow's text start. */
  start: z.string().min(1).optional(),
  /** The start's whole validated input (`ctx.run.input`, `{{input.<field>}}`); default `{}`. */
  input: z.record(z.string(), z.unknown()).optional(),
});

export type RunInput = z.infer<typeof RunInputSchema>;
