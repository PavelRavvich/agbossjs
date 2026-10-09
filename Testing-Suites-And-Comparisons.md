# Element Suites and Comparisons (A/B testing)

Graphcompose provides a data-driven A/B testing mechanism called **Suites** to batch-evaluate targets against datasets using Judges. This allows developers to quantitatively measure the performance of different prompts, models, agents, or workflow topologies.

## Core Concepts

* **Dataset**: A collection of test cases. Each test case provides an `input` (the message or state to feed into the target) and optionally an `expectedOutput` or `context` for evaluation.
* **Target (Element)**: The system under test. This can be an `@Agent` class, a specific `@Workflow`, or a `ScriptedChatModel` configuration.
* **Judge**: Reusable evaluators (e.g., `AccuracyJudge`, `ToneJudge`, `ContextRelevanceJudge`) that score the output of the target.
* **Suite Orchestrator**: A test runner that takes a Dataset, a Target, and a set of Judges, then runs the Target over all test cases in parallel (up to a concurrency limit), and aggregates the scores.
* **Comparison (A/B Test)**: An engine to run a Suite over multiple Targets (e.g., a baseline and a candidate) and generate a side-by-side metric comparison report.

## How to Run Declarative A/B Testing

Graphcompose exposes `Dataset`, `Suite`, and `Compare` from `graphcompose/testing` to implement programmatic A/B testing.

### 1. Define a Dataset

Create a `Dataset` to hold the test cases you want to use for evaluation:

```typescript
import { Dataset } from "graphcompose/testing";

const dataset = new Dataset([
  { input: { topic: "GraphQL" }, expected: "A query language for your API" },
  { input: { topic: "REST" }, expected: "Representational State Transfer" }
]);
```

### 2. Define a Suite

Configure a `Suite` with your dataset and the Judges that should evaluate the outputs:

```typescript
import { Suite } from "graphcompose/testing";
import { AccuracyJudge, ToneJudge } from "graphcompose/judges";

const suite = new Suite({
  name: "Tech Explanations Suite",
  dataset,
  judges: [
    new AccuracyJudge({ threshold: 0.8 }),
    new ToneJudge({ expectedTone: "professional" })
  ]
});
```

### 3. Evaluate a Single Target

You can use a suite to evaluate a single Target and review the metrics report:

```typescript
import { TechExplainerAgent } from "./agents";

const report = await suite.evaluate(TechExplainerAgent);

console.log(`Accuracy: ${report.metrics.accuracy.mean}`);
console.log(`Pass Rate: ${report.metrics.passRate}`);
```

### 4. Compare Multiple Targets (A/B Testing)

To measure improvements or regressions, run a Comparison across multiple Targets. The Comparison Engine handles the parallel execution and statistical aggregation automatically.

```typescript
import { Compare } from "graphcompose/testing";
import { TechExplainerAgentV1, TechExplainerAgentV2 } from "./agents";

const comparison = await Compare.suites(suite, {
  baseline: TechExplainerAgentV1,
  candidate: TechExplainerAgentV2
});

console.log(comparison.summary());
// Output example: candidate improved Accuracy by +12%, but dropped Tone by -2%
```

## Integration with VCR

Suites integrate seamlessly with the VCR functionality. When A/B tests are run with VCR enabled, baseline runs can be replayed quickly without hitting the LLM, dramatically speeding up evaluation loops when comparing against cached targets.
