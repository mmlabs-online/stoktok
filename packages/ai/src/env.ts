export interface AiEnv {
  anthropicApiKey?: string;
  googleAiApiKey?: string;
}

const clean = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/** The only module that names the AI provider keys (r3-guard). A missing or blank key disables only that provider. */
export function readAiEnv(env: Record<string, string | undefined> = process.env): AiEnv {
  const out: AiEnv = {};
  const anthropic = clean(env.ANTHROPIC_API_KEY);
  const google = clean(env.GOOGLE_AI_API_KEY);
  if (anthropic) out.anthropicApiKey = anthropic;
  if (google) out.googleAiApiKey = google;
  return out;
}
