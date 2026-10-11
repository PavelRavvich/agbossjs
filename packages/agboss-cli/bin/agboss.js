#!/usr/bin/env node
// Launcher kept in the repo, so npm links the command even before the first build.
import { existsSync } from "node:fs";

const main = new URL("../dist/cli/main.js", import.meta.url);
if (!existsSync(main)) {
  process.stderr.write(
    "agboss-cli is not built yet: run `npm run build` at the repository root.\n",
  );
  process.exit(1);
}
await import(main.href);
