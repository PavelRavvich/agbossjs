// npm run schema — writes schema/profile.schema.json from the zod ProfileSchema (editor autocomplete).
import { writeFileSync } from "node:fs";
import { profileJsonSchema } from "./profiles.js";

writeFileSync("schema/profile.schema.json", `${JSON.stringify(profileJsonSchema(), null, 2)}\n`);
process.stdout.write("schema/profile.schema.json written\n");
