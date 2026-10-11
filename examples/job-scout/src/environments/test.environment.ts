import { defineEnvironment } from "agboss";

/** `testWith(JobScout, { env: "test" })`: a host no test reaches (fetches are stubbed or recorded). */
export default defineEnvironment({
  greenhouseApiUrl: "https://greenhouse.test",
});
