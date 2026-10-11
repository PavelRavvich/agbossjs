import { defineEnvironment } from "agboss";

/** `npm run chat` (no --env): the public Greenhouse API. */
export default defineEnvironment({
  greenhouseApiUrl: "https://boards-api.greenhouse.io",
});
