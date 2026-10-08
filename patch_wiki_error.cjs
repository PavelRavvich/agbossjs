const fs = require('fs');
const path = 'Advanced-Routing.md';
let content = fs.readFileSync(path, 'utf8');

const oldStr = `catchError(FailingInventoryAgent, Error).next(SagaOrchestrator),`;
const newStr = `// Catch the error and trigger the SAGA rollback.
    // (If the second argument is omitted, it defaults to catching the base 'Error' class).
    catchError(FailingInventoryAgent).next(SagaOrchestrator),`;

content = content.replace(`// Catch the error and trigger the SAGA rollback\n    catchError(FailingInventoryAgent, Error).next(SagaOrchestrator),`, newStr);
fs.writeFileSync(path, content);
