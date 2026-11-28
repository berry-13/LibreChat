import { isGeminiNeon, isGeminiHydrogen, getGeminiHydrogenRates } from 'librechat-data-provider';
import type { TGoogleTokenConfig } from 'librechat-data-provider';
import type { EndpointTokenConfig } from '~/types';

/** Resolve operator rates identically for usage billing and the context-cost display. */
export function getGoogleTokenConfig(
  model: string,
  configured?: TGoogleTokenConfig,
  location?: string,
): EndpointTokenConfig[string] | undefined {
  const bareModel = model.replace(/^models\//, '');
  const keys = [model, bareModel, `models/${bareModel}`];
  const key = keys.find(
    (candidate) => configured && Object.prototype.hasOwnProperty.call(configured, candidate),
  );
  const rates = key == null ? undefined : configured?.[key];
  if (rates) {
    return { ...rates, read: rates.cacheRead };
  }
  if (isGeminiNeon(model)) {
    const regional = location != null && location !== '' && location !== 'global';
    const read = regional ? 0.165 : 0.15;
    return { prompt: regional ? 3.3 : 3, completion: regional ? 16.5 : 15, read, cacheRead: read };
  }
  if (!isGeminiHydrogen(model)) {
    return undefined;
  }
  const standard = getGeminiHydrogenRates(location);
  return { ...standard, cacheRead: standard.read };
}
