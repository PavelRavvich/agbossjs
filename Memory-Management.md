# Ticket #128: Memory Management & Context Compaction

## 1. Goal
Provide a flexible, scalable, and DI-friendly architecture to manage LangGraph state size and LLM context limits. 

The architecture separates **"Where data is saved" (Storage)** from **"How context is formatted/compressed" (Strategy)**.

---

## 2. Core Interfaces

### 2.1 Memory Storage (Physical Persistence)
An abstract class defining how intermediate memory data (like summaries or knowledge graphs) is persisted.

```typescript
export abstract class BaseMemoryStorage {
  abstract load<V>(runId: string, namespace: string): Promise<V | undefined>;
  abstract save<V>(runId: string, namespace: string, data: V): Promise<void>;
}
```

### 2.2 Memory Strategy (Context Management Logic)
An abstract class defining how raw message history is transformed into the LLM context, and how memories are updated post-turn.

```typescript
import type { BaseMessage } from "@langchain/core/messages";

export interface BaseMemoryOptions {
  windowSize: number; // How many raw messages to always pass to the LLM
}

export interface MemoryState {
  runId: string;
  [key: string]: unknown;
}

export abstract class BaseMemoryStrategy<T extends BaseMemoryOptions> {
  // Reads from storage and formats the prompt for the LLM
  abstract buildContext(messages: BaseMessage[], state: MemoryState, options: T): Promise<BaseMessage[]>;
  
  // Compresses history, extracts facts, and saves back to storage
  abstract updateMemory(messages: BaseMessage[], state: MemoryState, options: T): Promise<void>;
}
```

---

## 3. Decorator & Out-of-the-Box Implementations

### 3.1 `@MemoryStrategy` Decorator
A class decorator that registers the strategy in the DI container and injects its strongly-typed configuration options.

```typescript
export declare function MemoryStrategy<T>(options: T): ClassDecorator;
```

### 3.2 Starter Implementations (Batteries Included)

1. **`GraphStateMemoryStorage`**: Extends `BaseMemoryStorage`. The default storage engine that writes to LangGraph's native state object.
2. **`SlidingWindowStrategy`**: Extends `BaseMemoryStrategy`. A zero-cost strategy that simply slices the array to `windowSize`.
3. **`StandardCompactionStrategy`**: Extends `BaseMemoryStrategy`. Uses an LLM to periodically create a FIFO queue of conversation summaries.

---

## 4. End-User API

Developers configure memory entirely via declarative properties on `@Workflow` and `@Agent`, utilizing Dependency Injection (DI) to resolve tokens.

### Global Workflow Configuration
```typescript
@Workflow({
  // INFRASTRUCTURE: Overrides where memories are physically stored
  memoryStorage: RedisMemoryStorage,

  defaults: {
    // LOGIC: The default compression strategy inherited by all agents
    compaction: StandardCompactionStrategy 
  }
})
export class EnterpriseWorkflow {}
```

### Local Agent Configuration
```typescript
@Agent({
  name: "DataAnalyst",
  // Overrides the default compaction strategy for this specific agent
  compaction: FactExtractionStrategy 
})
export class AnalystAgent {}
```
