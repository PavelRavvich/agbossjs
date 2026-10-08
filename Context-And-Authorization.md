# Context and Authorization

When building applications with LangGraph, it's crucial to distinguish between the persisted state of your workflow and the ephemeral context of the current execution.

## WorkflowState vs. ExecutionContext

- **`WorkflowState`**: This is the data actively being processed by your graph. It is persisted to LangGraph's database (e.g., Postgres, SQLite) and survives across different steps of the graph and different thread runs. It should only contain data relevant to the ongoing process or conversation.
- **`ExecutionContext`**: This is ephemeral data about the *current execution trigger*, such as the active User Session, Authentication Tokens, or Trace IDs. This data lives **only in memory** for the duration of the execution and is never persisted to the graph's database. It is passed into the workflow to enforce security, apply user-specific limits, or carry request-scoped tracing information.

---

## Implementing Execution Context

To pass context into your workflow and access it from actions and tools, follow these steps:

### 1. Define a Custom CallContext Interface

Start by defining the shape of your execution context.

```typescript
// context.ts
export interface CallContext {
  userId: string;
  role: 'admin' | 'user';
  traceId: string;
}
```

### 2. Access Context in a `@WorkflowAction`

Use the `ActionRuntime` parameterized with your `CallContext` to retrieve the execution context inside your graph nodes/actions.

```typescript
// actions/ProcessDataAction.ts
import { WorkflowAction, ActionRuntime } from 'graphcompose/decorators';
import { CallContext } from '../context';

@WorkflowAction({ name: "ProcessDataAction" })
export class ProcessDataAction {
  async execute(state: any, runtime: ActionRuntime<CallContext>) {
    const { executionContext } = runtime;
    
    // Enforce authorization based on the in-memory context
    if (executionContext?.role !== 'admin') {
      throw new Error(`Unauthorized: User ${executionContext?.userId} lacks admin rights.`);
    }

    console.log(`Executing with trace ID: ${executionContext.traceId}`);
    
    // Return updated WorkflowState
    return { status: 'processed' };
  }
}
```

### 3. Access Context in a Tool

When defining tools, you can use `ToolContext` to access the same execution context.

```typescript
// tools/SecureDataTool.ts
import { tool } from 'graphcompose/tools';
import { z } from 'zod';
import { ToolContext } from 'graphcompose/decorators';
import { CallContext } from '../context';

export const secureDataTool = tool(
  "secure_data_tool",
  "Retrieves highly sensitive data. Requires admin role.",
  z.object({
    query: z.string().describe('The search query')
  }),
  async (input, runtimeContext: ToolContext<CallContext>) => {
    // Retrieve executionContext from the tool's runtime config
    const { executionContext } = runtimeContext;

    if (executionContext?.role !== 'admin') {
      return "Access denied: insufficient permissions.";
    }

    return `Successfully fetched secure data for trace ${executionContext?.traceId}`;
  }
);
```

### 4. Passing Context via `app.execute`

Finally, inject the context when triggering the graph execution from your application's entry point (e.g., an API route controller).

```typescript
// server.ts
import { app } from './app';
import { CallContext } from './context';

// ... inside an API request handler ...
const context: CallContext = {
  userId: 'usr_123',
  role: 'admin', // Extracted from session/JWT
  traceId: 'req_abc789'
};

const result = await app.execute(
  StartNode,
  "Process my confidential data",
  {
    executionContext: context // Passed as the ephemeral context
  }
);
```
