# Judges and Quality Gates

The internal retry loop helps agents reflect on their outputs without bloating the LangGraph checkpoint history with massive chains of intermediate thoughts and failed tools.

## Setup
Use the `@Judge` decorator on a class extending `BaseJudge`. You can provide `model`, `systemPrompt`, and declarative `metrics`. 

```ts
import { Judge, BaseJudge } from "graphcompose";

@Judge({
  name: "CorrectnessJudge",
  model: "gpt-4o",
  systemPrompt: "You are an expert judge. Evaluate the user response.",
  metrics: {
    accuracy: { min: 8, feedback: "Ensure accuracy is at least 8/10." },
    hallucination: { exact: false, feedback: "Do not hallucinate." }
  }
})
export class CorrectnessJudge extends BaseJudge {}
```

## Adding Judges to Agents
Attach the judge to the agent definition:
```ts
@Agent({
  name: "Writer",
  judges: [CorrectnessJudge],
  maxRetries: 3
})
class WriterAgent {}
```

## How It Works
1. The agent responds to the task (`model` -> `replyWith`).
2. The `judge` node runs after `replyWith`.
3. If the judge returns `passed: false`, it appends a `HumanMessage` to the agent's scratchpad with feedback, increments the internal `retries` counter, and nullifies `state.reply`.
4. The loop unconditionally routes back to `model` (if retries not exceeded), keeping the retry loop entirely inside the agent's local subgraph! 
