import type { RouteRequest } from "../../src/routers/index.js";

/** Routers are tested with plain requests — no graph, no agents. */
export const request: RouteRequest = {
  input: "Implement a parser",
  options: [
    { name: "alpha", description: "facts" },
    { name: "finish", description: "done" },
  ],
};

export const jevAnswer = (
  route: Record<string, unknown>,
  usage?: Record<string, number>,
): Record<string, unknown> => ({
  model: "typesafe/jev-1.13-20260917",
  answers: { route },
  ...(usage ? { usage } : {}),
});
