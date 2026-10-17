#!/usr/bin/env node
// The `check:types` step (#272 S3): generates `packages/agboss/.agboss/types.d.ts` for the framework's
// v2 test fixtures before typecheck, the way `agboss check` does in a project. It runs the framework's
// sources (through tsx, transpile-only), the same modules the fixtures import.
import { register } from "tsx/esm/api";

register();
const framework = new URL("../packages/agboss/", import.meta.url);
const { writeFlowTypes, FlowTypesStatus } = await import(
  new URL("src/flow/types/write.ts", framework).href
);
const { FIXTURE_WORKFLOWS } = await import(
  new URL("tests/flow/types/fixture-workflows.ts", framework).href
);
const result = await writeFlowTypes({
  files: FIXTURE_WORKFLOWS,
  project: new URL(".", framework).pathname,
  tablesModule: new URL("src/flow/generated-types.ts", framework).pathname,
});
for (const note of result.notes) console.log(note);
if (result.status !== FlowTypesStatus.Written) {
  for (const found of result.errors) console.error(`[${found.code}] ${found.message}`);
  console.error(`check:types: ${result.outFile} was not written`);
  process.exit(1);
}
console.log(`check:types: wrote ${result.outFile}`);
