/** The Langfuse settings, when all three are set (`LANGFUSE_PUBLIC_KEY`, `_SECRET_KEY`, `_BASE_URL`). */
export interface LangfuseSettings {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly baseUrl: string;
}

export function langfuseSettings(env: NodeJS.ProcessEnv): LangfuseSettings | undefined {
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  const baseUrl = env.LANGFUSE_BASE_URL;
  return publicKey && secretKey && baseUrl ? { publicKey, secretKey, baseUrl } : undefined;
}
