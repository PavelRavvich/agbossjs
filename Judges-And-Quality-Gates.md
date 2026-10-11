# Judges and Quality Gates

A judge checks an agent's reply before it leaves the agent. A rejected reply goes back to the agent
with the judge's feedback — inside the agent's own loop, so the checkpoint history does not fill up
with failed attempts — and once `maxRetries` retries are spent the run throws `QualityGateError`
(`code: "step.agent.quality-gate"`, `feedback` per judge).

## A judge

A `@Judge({ name, model, deps })` class implements `JudgeHandler`; the container creates it with its
`deps`, and its **own** model is called through the model gateway, so its spend is in the run's cost
report (`judge:<name>`). A judge without a model fails at app start (`[judge.no-model]`).

```ts file=judges/correctness.judge.ts
import { Judge, type JudgeContext, type JudgeHandler, type JudgeVerdict } from "agboss";

@Judge({ name: "correctness", model: "moonshotai/kimi-k2.6" })
export class CorrectnessJudge implements JudgeHandler {
  async judge(reply: string, ctx: JudgeContext): Promise<JudgeVerdict> {
    const verdict = await ctx.model.invoke(
      `Task: ${ctx.task}\nReply: ${reply}\nAnswer PASS if the reply is correct and complete, else explain what is wrong.`,
    );
    return verdict.trim().startsWith("PASS")
      ? { passed: true }
      : { passed: false, feedback: verdict, metrics: { attempt: ctx.attempt } };
  }
}
```

On a **decision model** the judge asks typed questions instead — `ctx.model.decide({ state, questions })`
with `Decision.noul` (yes/no → P(yes)), `Decision.choice` (an option, probabilities, confidence) and
`Decision.score` (levels, lowest first → the level's index); the answers are typed by the questions:

```ts file=judges/grounded.judge.ts
import { Decision, Judge, type JudgeContext, type JudgeHandler } from "agboss";

@Judge({ name: "grounded", model: "openai/gpt-6-luna-decisions" })
export class GroundedJudge implements JudgeHandler {
  async judge(reply: string, ctx: JudgeContext) {
    const a = await ctx.model.decide({
      state: { task: ctx.task, reply },
      questions: {
        grounded: Decision.noul("Every fact in the reply follows from the task"),
        quality: Decision.score("Overall usefulness", ["useless", "partial", "complete"]),
      },
    });
    return a.grounded.noul > 0.7 && a.quality.score >= 1
      ? { passed: true }
      : { passed: false, feedback: "Only state facts you can support, and answer the whole task." };
  }
}
```

`decide` on a chat model or `invoke` on a decision model throws `ModelKindError` (`model.wrong-kind`).

## Adding judges to an agent

```ts
import { Agent } from "agboss";
import { CorrectnessJudge } from "./judges/correctness.judge.js";
import { GroundedJudge } from "./judges/grounded.judge.js";

@Agent({
  name: "writer",
  description: "Writes the answer",
  prompt: "Write the answer to the task.",
  model: "moonshotai/kimi-k2.6",
  judges: [CorrectnessJudge, GroundedJudge],
  maxRetries: 2,
})
export class WriterAgent {}
```

The judges are registered by the agent; list a judge's own dependencies in the workflow's
`providers`.

## How it works

1. The agent's loop produces its reply (`agent-replyWith`).
2. Every judge of the agent runs on it (observers see `onJudgeStart` / `onJudgeEnd`).
3. A rejection (`passed: false`) goes back to the agent's model as feedback, and the loop runs again
   — until every judge passes or `maxRetries` retries are spent (`QualityGateError`).

In tests, script a chat judge like an agent — `mockLlm(CorrectnessJudge).thenReturn(replyWith("PASS"))`
— and a decision judge with its answers by question id:
`mockLlm(GroundedJudge).thenReturn(decideWith({ grounded: 0.9, quality: 2 }))` ([Testing](Testing)).
