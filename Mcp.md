# Интеграция с протоколом MCP (Model Context Protocol)

GraphCompose позволяет из коробки экспортировать свои компоненты (утилиты `@Tool` и точки запуска графов `@WorkflowStart`) по стандарту MCP.

Это полезно для интеграции ваших бэкенд-утилит напрямую в Claude Desktop или для предоставления инструментов внешним LLM-агентам.

## 1. Конфигурация MCP Сервера

Для описания того, что именно мы хотим открыть наружу, используется декоратор `@McpServer`:

```typescript
// src/mcp/job-scout.mcp.ts
import { McpServer } from "graphcompose";
import { SearchJiraTool, QueryDbTool } from "../tools/my.tool.js";
import { JobScoutStart } from "../workflows/job-scout.workflow.js";

@McpServer({
  name: "job-scout-mcp",
  version: "1.0.0",
  // Массив экспортов. Фреймворк сам разберется, что это — тул или воркфлоу, 
  // и сгенерирует для них JSON Schema.
  exports: [SearchJiraTool, QueryDbTool, JobScoutStart]
})
export class JobScoutMcpServer {}
```

## 2. Создание сервиса и локальный запуск (Stdio)

Вы можете создать чистый, не зависящий от фреймворка `McpService` с помощью функции `createMcpService`.

Если вы хотите запустить сервер локально (например, для **Claude Desktop**), который общается через стандартный ввод-вывод (`stdio`), вам не нужен HTTP-фреймворк:

```typescript
import { createMcpService } from "graphcompose";
import { app } from "./graphcompose-app.js"; 
import { JobScoutMcpServer } from "./mcp/job-scout.mcp.js";

async function main() {
  const mcpService = createMcpService(app, JobScoutMcpServer);
  
  // Сервер заблокирует процесс и начнет слушать stdin/stdout
  await mcpService.connectStdio();
}
```

## 3. Использование с HTTP (Express.js, NestJS, Fastify)

Протокол MCP использует SSE (Server-Sent Events) для работы поверх HTTP. 
`McpService` полностью агностичен и ничего не знает про фреймворки, он просто предоставляет методы для работы с потоками.

Пример интеграции в Express.js. Заметьте, как легко мы прокидываем контекст (авторизацию), не загрязняя этим логику инструментов!

```typescript
import express from "express";
import { createMcpService } from "graphcompose";
import { app } from "./graphcompose-app.js"; 
import { JobScoutMcpServer } from "./mcp/job-scout.mcp.js";

const expressApp = express();

// 1. Инициализируем сервис один раз
const mcpService = createMcpService(app, JobScoutMcpServer);

// 2. Эндпоинт GET: открывает поток SSE
expressApp.get("/mcp", async (req, res) => {
  // Проверяем авторизацию. tenantId безопасно "привяжется" к сессии.
  const context = { tenantId: req.headers.authorization };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Отдаем ответ сервису, чтобы он писал туда события, 
  // и указываем URL, куда клиент должен посылать POST сообщения.
  const session = await mcpService.handleSse(res, "/mcp/messages", context);
});

// 3. Эндпоинт POST: прием сообщений RPC от клиента
expressApp.post("/mcp/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  
  // Прокидываем сырой JSON payload в сервис
  await mcpService.handleMessage(req, res, sessionId, req.body);
});
```

Внутри кода вашего инструмента `@Tool` вы можете безопасно достать этот `context`, переданный при создании сессии.
