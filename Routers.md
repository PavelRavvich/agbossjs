# Routers

A router picks one option for a piece of text. It knows nothing about graphs or agents.

```ts
interface Router {
  readonly name: string;
  readonly route: (request: {
    input: string;
    options: RouteOption[];
  }) => Promise<RouteOutcome>;
}
type RouteOutcome =
  | {
      kind: "decided";
      decision: { next: string; reason: string };
      usage: UsageRecord;
    }
  | { kind: "failed"; reason: string; usage: UsageRecord };
```

| Kind  | How it decides                                             | Cost source          |
| ----- | ---------------------------------------------------------- | -------------------- |
| `jev` | OpenRouter Decisions API, `choice` question, probabilities | reported by the API  |
| `llm` | chat model replies with JSON, validated with zod           | tokens × price table |

Failures (HTTP error, malformed output, unknown option) are `failed` outcomes, never exceptions.
Routers default to Jev — see [ADR-0001](ADR-0001-Jev-default-router).

## Isolation

- `src/routers` imports only `config`, `finops`, `llm`; the rest of `src` imports routers only via
  `src/routers/index.ts`. Enforced by ESLint.
- The graph talks to a router through `renderRouteInput(task, contributions)` → `input`.

## Testing routers on their own

`npm run test:routers` runs `tests/routers/` — plain `RouteRequest` fixtures, no graph, no agents.
Jev is tested with a fake `JevClient`, the LLM router with `FakeListChatModel`.
