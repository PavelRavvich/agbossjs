import fs from 'fs';
const wikiPath = '/Users/pavelravvich/projects/langgraph-ts-template.wiki/Testing.md';
let content = fs.readFileSync(wikiPath, 'utf-8');

const enhancedDocs = `
## VCR / Snapshots (Заморозка LLM)

**VCR (Video Cassette Recorder)** — это паттерн тестирования, который перехватывает сетевые запросы к LLM и "записывает" их на кассеты (в локальные JSON-файлы). При повторном запуске тесты проходят за миллисекунды, так как ответы читаются из файлов, экономя деньги и время в CI.

### Как это выглядит на практике?

Вам достаточно добавить параметр \`vcr\` при создании приложения через \`testWith\`:

\`\`\`typescript
import { testWith } from "graphcompose/testing";
import { VCRMode } from "graphcompose/testing/vcr";

it("Агент должен провести онбординг", async () => {
  const { app } = await testWith(MyWorkflow, {
    vcr: {
      cassetteName: "onboarding-scenario", // <-- Название файла кассеты
      mode: process.env.CI ? VCRMode.REPLAY : VCRMode.AUTO
    }
  });

  const state = await app.execute({ task: "Привет, я хочу зарегистрироваться!" });
  expect(state.reply).toContain("Как вас зовут?");
});
\`\`\`

### Как с этим работать?

1. **Запись (Первый запуск):** Вы запускаете тест локально. Фреймворк видит, что кассеты нет, делает реальный запрос к OpenAI и сохраняет ответ в файл.
2. **Где хранится кассета:** Рядом с вашим тестом автоматически создается директория \`__snapshots__\`.
   \`\`\`text
   tests/
     onboarding.test.ts
     __snapshots__/
       onboarding-scenario.cassette.json  <-- Файл кассеты, который нужно закоммитить в Git
   \`\`\`
3. **Воспроизведение (CI и последующие запуски):** Вы коммитите кассету в Git. Теперь в GitHub Actions тесты будут проходить мгновенно и без затрат на токены.

### Актуальность кассет
Если вы измените системный промпт агенту или добавите новый инструмент, старая кассета перестанет подходить (сработает строгая проверка хэшей). Тест упадет с ошибкой *"Cassette mismatch: please re-record"*. Это гарантирует, что ваши тесты всегда тестируют актуальную логику, а не устаревшие моки.

*Доступные режимы:*
- \`VCRMode.AUTO\` (по умолчанию) — пишет кассету, если её нет. Воспроизводит, если есть.
- \`VCRMode.RECORD\` — всегда обращается в сеть и перезаписывает файл.
- \`VCRMode.REPLAY\` — строгое воспроизведение (упадет, если кассеты нет). Идеально для CI.
`;

// Replace the existing basic VCR docs with the enhanced ones
content = content.replace(/## VCR \/ Snapshots[\s\S]*?(?=\n## |$)/, enhancedDocs.trim() + '\n\n');

fs.writeFileSync(wikiPath, content);
