const fs = require('fs');
const path = 'Advanced-Routing.md';
let content = fs.readFileSync(path, 'utf8');

const regex = /## 4\. Dynamic Parallelism[\s\S]*?## 7\./;

const replacement = `## 4. Dynamic Parallelism (BatchParallel / Map-Reduce)

When you don't know how many agents you need to spawn at runtime, use \`batchParallel\` combined with a Strategy class. GraphCompose enforces strict database safety by chunking massive arrays and controlling thread execution concurrency.

\`\`\`typescript
import { BatchParallelStrategy } from "graphcompose/concurrency";
import { Agent, WorkflowAction } from "graphcompose/decorators";

// 1. Strategy to extract the raw data
@BatchParallelStrategy()
class UrlExtractorStrategy {
  extract(state: MyState): string[] {
    return state.urls; // Suppose this array has 10,000 URLs
  }
}

// 2. The Worker that processes the chunks
@WorkflowAction({ name: "ScraperAgent" })
class ScraperAgent {
  execute(state: MyState) {
    // The agent receives a safe chunk of data!
    // E.g., if batchSize = 100, chunk.length will be 100
    const chunk: string[] = state.batchItem;
    // Process URLs...
    return { /* state updates */ };
  }
}
\`\`\`

\`\`\`typescript
flow: [
  from(WorkflowStart).next(DispatcherAgent),
  
  // Slices the 10,000 URLs into 100 chunks of 100 URLs each.
  // Spawns up to 10 ScraperAgent workers concurrently to process those chunks.
  from(DispatcherAgent)
    .batchParallel(ScraperAgent, UrlExtractorStrategy, { 
      batchSize: 100,
      concurrencyLimit: 10
    }),
    
  from(ScraperAgent).next(SummaryAgent)
]
\`\`\`

## 7.`;

content = content.replace(regex, replacement);
fs.writeFileSync(path, content);
