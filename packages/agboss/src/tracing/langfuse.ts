import { CallbackHandler } from "@langfuse/langchain";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { langfuseSettings } from "./settings.js";
import type { RunTracing } from "./types.js";

/**
 * Tracing into a (self-hosted) Langfuse when LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and
 * LANGFUSE_BASE_URL are set; undefined otherwise. LANGFUSE_PROJECT_ID (optional) enables links. Uses an isolated tracer provider — the core does
 * not register global OpenTelemetry. Session = conversation thread, tags = workflow.
 */
export function langfuseTracing(env: NodeJS.ProcessEnv): RunTracing | undefined {
  const settings = langfuseSettings(env);
  if (settings === undefined) return undefined;
  const { publicKey, secretKey, baseUrl } = settings;
  const projectId = env.LANGFUSE_PROJECT_ID === "" ? undefined : env.LANGFUSE_PROJECT_ID;
  const processor = new LangfuseSpanProcessor({ publicKey, secretKey, baseUrl });
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  setLangfuseTracerProvider(provider);
  return {
    callbacks: ({ bundle, threadId, runId }) => [
      new CallbackHandler({
        sessionId: threadId,
        tags: [bundle],
        traceMetadata: { bundle, runId },
      }),
    ],
    sessionUrl: (threadId) =>
      projectId === undefined
        ? undefined
        : `${baseUrl.replace(/\/+$/, "")}/project/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(threadId)}`,
    shutdown: async () => {
      await provider.shutdown();
      setLangfuseTracerProvider(null);
    },
  };
}
