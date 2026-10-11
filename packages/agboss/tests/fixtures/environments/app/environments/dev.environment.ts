import { defineEnvironment, fromEnv } from "../../../../../src/index.js";

export default defineEnvironment({
  apiUrl: "https://api.dev.example.com",
  apiKey: fromEnv("FIXTURE_API_KEY", { secret: true, default: "dev-key" }),
  currency: fromEnv("FIXTURE_CURRENCY", { default: "USD" }),
});
