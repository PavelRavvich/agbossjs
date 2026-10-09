# Управление Памятью (Memory Management & Compaction)

В сложных графах и при длительном общении с пользователем массив сообщений (история) может разрастись до огромных размеров, превышая лимиты токенов LLM-моделей (Context Window Limit).

В **GraphCompose** управление памятью построено на основе строгой архитектуры Dependency Injection (DI) и разделено на два слоя:
1. **Стратегии (Memory Strategy)** — алгоритмы, определяющие, *как именно* обрезать, суммаризировать или извлекать факты из истории сообщений.
2. **Хранилища (Memory Storage)** — механизмы, определяющие, *куда физически* сохраняются эти сжатые данные (в оперативную память, в LangGraph State, в Redis, базу данных и т.д.).

---

## Как это работает?

Конфигурация памяти задается декларативно через декораторы `@Workflow` и `@Agent`. Фреймворк берет на себя вызов вашей стратегии памяти **перед** каждым обращением к LLM (чтобы собрать контекст) и **после** ответа агента (чтобы обновить память).

### Глобальная настройка (Workflow)

Вы можете задать дефолтную стратегию и хранилище для всего воркфлоу:

```typescript
import { Workflow } from "graphcompose";
import { StandardCompactionStrategy, InMemoryStorage } from "graphcompose/memory";

@Workflow({
  name: "EnterpriseWorkflow",
  version: "1.0.0",
  // 1. Указываем класс-хранилище (DI сам создаст инстанс)
  memoryStorage: InMemoryStorage,
  // 2. Указываем дефолтную стратегию для всех агентов в графе
  defaultMemoryStrategy: StandardCompactionStrategy,
  agents: [/* ... */]
})
export class EnterpriseWorkflow {}
```

### Локальная настройка (Agent)

Если конкретному агенту нужна своя, специфичная стратегия памяти (например, он должен помнить только последние 2 сообщения, или наоборот, анализировать всю выжимку фактов), её можно переопределить:

```typescript
import { Agent } from "graphcompose";
import { SlidingWindowStrategy } from "graphcompose/memory";

@Agent({
  name: "QuickResponder",
  model: "openai:gpt-4o-mini",
  description: "Агент для быстрых ответов",
  // Переопределяет глобальную стратегию
  memoryStrategy: SlidingWindowStrategy 
})
export class QuickResponder {}
```

---

## Встроенные стратегии

GraphCompose предоставляет несколько стратегий "из коробки":

### 1. SlidingWindowStrategy
Самая простая, нулевая по стоимости стратегия. Просто обрезает массив сообщений, оставляя только `N` последних. Не использует хранилище и не вызывает LLM.

### 2. StandardCompactionStrategy
Умная стратегия компакции (суммирования). 
Когда количество сообщений превышает лимит окна, стратегия берет старые сообщения, вызывает быструю LLM для их суммаризации, и складывает результат в `MemoryStorage`. 
При следующем вызове агента, LLM получит системный промпт со списком всех прошлых саммари + несколько последних сырых сообщений.

---

## Создание своей Стратегии (Custom Memory Strategy)

Чтобы создать свою собственную логику работы с памятью (например, выделение ключевых фактов или графа знаний), вам нужно унаследоваться от `BaseMemoryStrategy` и использовать декоратор `@MemoryStrategy`.

```typescript
import { BaseMessage, SystemMessage } from "@langchain/core/messages";
import { 
  MemoryStrategy, 
  BaseMemoryStrategy, 
  BaseMemoryOptions, 
  MemoryState 
} from "graphcompose/memory";

// 1. Описываем интерфейс опций для вашей стратегии
export interface MyFactOptions extends BaseMemoryOptions {
  extractFacts: boolean;
}

// 2. Создаем класс с декоратором @MemoryStrategy
@MemoryStrategy<MyFactOptions>({
  windowSize: 5,
  extractFacts: true
})
export class FactExtractionStrategy extends BaseMemoryStrategy<MyFactOptions> {
  
  // Этот метод вызывается ДО обращения к LLM. 
  // Здесь мы должны сформировать контекст.
  async buildContext(
    messages: BaseMessage[],
    state: MemoryState,
    options: MyFactOptions
  ): Promise<BaseMessage[]> {
    // Просто отдаем последние `windowSize` сообщений
    return messages.slice(-options.windowSize);
  }

  // Этот метод вызывается ПОСЛЕ хода агента.
  // Здесь можно запустить фоновую LLM для извлечения фактов и сохранить их.
  async updateMemory(
    messages: BaseMessage[],
    state: MemoryState,
    options: MyFactOptions
  ): Promise<void> {
    if (options.extractFacts) {
      // Логика вызова LLM и сохранения фактов
    }
  }
}
```

---

## Создание своего Хранилища (Custom Memory Storage)

Чтобы сохранять данные памяти в вашу базу данных, создайте класс-наследник `BaseMemoryStorage` и пометьте его декоратором `@Injectable`:

```typescript
import { Injectable } from "graphcompose";
import { BaseMemoryStorage } from "graphcompose/memory";
import { MyDatabaseClient } from "./db"; // Ваш клиент БД

@Injectable()
export class RedisMemoryStorage extends BaseMemoryStorage {
  constructor(private readonly db: MyDatabaseClient) {
    super();
  }

  async load<V>(runId: string, namespace: string): Promise<V | undefined> {
    // Читаем из базы по ключу runId + namespace
    return this.db.get(`${runId}:${namespace}`);
  }

  async save<V>(runId: string, namespace: string, data: V): Promise<void> {
    // Сохраняем в базу
    await this.db.set(`${runId}:${namespace}`, data);
  }
}
```

После этого просто передайте `RedisMemoryStorage` в `memoryStorage` конфигурации вашего `@Workflow`!

---

## Обработка Ошибок

При работе со storage или LLM-компакцией могут возникать ошибки. Модуль памяти использует строгие типизированные классы ошибок, наследуемые от `MemoryError`:

- `MemoryStorageError` — выбрасывается при ошибках чтения или записи в хранилище.
- `MemoryCompactionError` — выбрасывается при сбоях LLM (таймауты, лимиты, невалидный формат ответа) во время обновления памяти.

Они автоматически интегрируются в общий механизм `catchError` фреймворка, поэтому их можно корректно перехватить на уровне роутинга воркфлоу.
