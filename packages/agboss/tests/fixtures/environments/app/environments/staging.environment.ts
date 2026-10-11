import { defineEnvironment, fromEnv } from "../../../../../src/index.js";

export default defineEnvironment({
  apiUrl: "https://api.staging.example.com",
  apiKey: fromEnv("FIXTURE_API_KEY", { secret: true }),
  currency: fromEnv("FIXTURE_CURRENCY"),
});
