import { defineEnvironment, fromEnv } from "agboss";

/** `--env staging`: the board API from the deployment (GREENHOUSE_API_URL must be set). */
export default defineEnvironment({
  greenhouseApiUrl: fromEnv("GREENHOUSE_API_URL"),
});
