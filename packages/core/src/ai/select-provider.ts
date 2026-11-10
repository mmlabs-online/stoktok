import { AI_CONFIG, AI_PROVIDERS, type AiConfig, type AiProvider, type AiTask } from './config';

export type SelectProviderResult =
  | { ok: true; provider: AiProvider; model: string }
  | { ok: false; reason: 'provider_unavailable' };

/**
 * An explicit provider is used or refused, never switched. Without one: the task default, else the other enabled provider.
 */
export function selectProvider(
  input: { task: AiTask; requested?: AiProvider; enabled: readonly AiProvider[] },
  cfg: AiConfig = AI_CONFIG,
): SelectProviderResult {
  const { task, requested, enabled } = input;
  const pick = (provider: AiProvider): SelectProviderResult => ({ ok: true, provider, model: cfg.modelsByTask[provider][task] });
  if (requested) return enabled.includes(requested) ? pick(requested) : { ok: false, reason: 'provider_unavailable' };
  const preferred = cfg.defaultProviderByTask[task];
  if (enabled.includes(preferred)) return pick(preferred);
  const other = AI_PROVIDERS.find((p) => p !== preferred && enabled.includes(p));
  return other ? pick(other) : { ok: false, reason: 'provider_unavailable' };
}
