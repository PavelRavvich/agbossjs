# Saga Pattern & Global Cancellation

При проектировании сложных AI-пайплайнов, взаимодействующих с внешними API (оплаты, бронирования, интеграции), неизбежны ошибки. Если в середине процесса произошел сбой (или пользователь сам отменил выполнение), нам нужно безопасно **откатить** уже совершенные действия. 

GraphCompose решает эту задачу с помощью паттерна **Saga** и механизма **Global Cancellation**.

---

## 1. Разделение понятий: «Что отменять» и «Как отменять»

Архитектура GraphCompose разделяет бизнес-логику отката от инфраструктуры его выполнения.

### А. Бизнес-логика (Что отменять)
Каждый агент знает только про свою часть работы. В метадате `@Agent` мы указываем специальный класс (Action), который будет отвечать за откат именно этого агента.

```typescript
import { Agent, WorkflowAction, type ActionRuntime } from "graphcompose";

// 1. Экшен для возврата денег (Компенсатор)
@WorkflowAction({ name: "RefundPayment" })
class RefundPaymentAction {
  async execute(state: any, ctx: ActionRuntime) {
    // Безопасный запрос к API благодаря idempotencyKey
    await fetch("https://api.stripe.com/refund", {
      headers: { "Idempotency-Key": ctx.idempotencyKey! }
    });
  }
}

// 2. Агент оплаты, привязанный к компенсатору
@Agent({ 
  name: "ProcessPayment", 
  compensate: RefundPaymentAction // <-- Рецепт отката
})
class ProcessPaymentAgent {
  async run() { /* Логика списания */ }
}
```

### Б. Движок отката (Как отменять)
В роутере графа мы перехватываем ошибку и указываем **Стратегию** отката с помощью метода `.compensateWith()`. 

Фреймворк предоставляет встроенную `LocalSagaStrategy`. Она берет историю графа (`state.history`), находит все успешно пройденные узлы и вызывает их `compensate`-классы в **обратном порядке**.

```typescript
import { Workflow, LocalSagaStrategy, WorkflowCancelledError } from "graphcompose";
import { from, catchError } from "graphcompose/router";

@Workflow({
  flow: [
    from(WorkflowStart).next(ProcessPaymentAgent),
    from(ProcessPaymentAgent).next(BookHotelAgent),
    
    // Перехватываем любую ошибку и запускаем движок Саги
    catchError(BookHotelAgent, Error).compensateWith(LocalSagaStrategy),
    
    // Перехватываем системную отмену пользователя и тоже запускаем Сагу
    catchError(BookHotelAgent, WorkflowCancelledError).compensateWith(LocalSagaStrategy)
  ]
})
class TravelWorkflow {}
```

---

## 2. Глобальная отмена (Soft Cancel)

Что, если процесс не упал сам по себе, а **пользователь нажал кнопку "Отмена"** в браузере?

Если мы просто жестко убьем процесс (например, через `AbortSignal`), граф умрет, а деньги не вернутся. Вместо этого в GraphCompose есть концепция "Мягкой отмены" (Soft Cancel).

Вызовите метод `app.cancel(runId)`:
```typescript
// Где-то в вашем API-контроллере:
await app.cancel(runId);
```

**Что происходит под капотом:**
1. Фреймворк делает транзакционную запись в БД графа: `cancelRequested = true`.
2. Перед запуском следующего агента ядро видит этот флаг и вместо запуска выкидывает специальную ошибку `WorkflowCancelledError`.
3. Эта ошибка перехватывается вашим роутером (`catchError(..., WorkflowCancelledError)`).
4. Запускается `LocalSagaStrategy`, которая штатно откатывает все пройденные шаги.
5. Процесс безопасно завершается.

Если сервер перезагрузится прямо во время отката, вы всегда можете вызвать `app.resume(runId)`, и граф продолжит откатывать транзакцию с нужного места, так как `LocalSagaStrategy` работает прямо внутри LangGraph State Machine!

---

## 3. Защита от двойной доставки (Idempotency)

В распределенных системах (особенно если вы напишете свою `KafkaSagaStrategy`) сообщения об откате могут дублироваться.

Все классы-компенсаторы **обязаны быть идемпотентными**. Чтобы вам не приходилось самим генерировать уникальные ключи, фреймворк прокидывает `ctx.idempotencyKey` в каждый `ActionRuntime`. 
Ключ формируется как хеш от `runId` и имени узла, поэтому он всегда статичен для конкретной попытки отката конкретного узла. Просто передавайте его во внешние API (Stripe, Booking и т.д.), и они сами отфильтруют дубли!
