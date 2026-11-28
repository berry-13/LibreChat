import { logger } from '@librechat/data-schemas';
import {
  Providers,
  isGeminiNeon,
  isGeminiHydrogen,
  ErrorTypes,
  EModelEndpoint,
  normalizeEndpointName,
} from 'librechat-data-provider';
import type { TModelsConfig, TTokenConfigMap, TEndpoint } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { EndpointTokenConfig, ServerRequest } from '~/types';
import type { RequestModelsConfigResult } from './config/service';
import type { TokenomicsDeps } from '~/endpoints/pricing';
import { getTokenConfigKey } from '~/endpoints/custom/initialize';
import { getGoogleTokenConfig } from '~/endpoints/google/pricing';
import { buildTokenConfigMap } from '~/endpoints/pricing';
import { getSafeErrorMetadata } from '~/utils/errors';
import { resolveGoogleAuth } from './google/auth';
import { tokenConfigCache } from '~/cache';

export interface ResolveTokenConfigParams {
  appConfig?: AppConfig;
  /** endpoint → model list, from the resolved models config */
  modelsConfig: TModelsConfig;
  userId: string;
  tenantId?: string | null;
  googleUsesVertex?: boolean;
  googleLocation?: string;
}

/**
 * Server-side token-config resolution for the `/endpoints/token-config`
 * route. Gathers each custom endpoint's override — a static yaml `tokenConfig`
 * or the cached fetched config — then resolves context windows (and pricing,
 * when `interface.contextCost` is enabled) via {@link buildTokenConfigMap}.
 * Lives in TypeScript so the `/api` controller stays a thin wrapper.
 */
export async function resolveTokenConfigMap(
  {
    appConfig,
    modelsConfig,
    userId,
    tenantId,
    googleUsesVertex,
    googleLocation,
  }: ResolveTokenConfigParams,
  deps: TokenomicsDeps,
): Promise<TTokenConfigMap> {
  const includePricing = appConfig?.interfaceConfig?.contextCost === true;
  const customEndpoints = (appConfig?.endpoints?.[EModelEndpoint.custom] ?? []) as TEndpoint[];
  const cache = tokenConfigCache();
  const endpointTokenConfigs: Record<string, EndpointTokenConfig | undefined> = {};

  const resolvedModelsConfig = { ...modelsConfig };
  const googleModels = modelsConfig[EModelEndpoint.google];
  const hasCustomVertex = customEndpoints.some(
    (endpoint) => normalizeEndpointName(endpoint.name) === Providers.VERTEXAI,
  );
  if (
    !hasCustomVertex &&
    googleModels != null &&
    resolvedModelsConfig[Providers.VERTEXAI] == null
  ) {
    resolvedModelsConfig[Providers.VERTEXAI] = googleModels;
  }
  for (const endpoint of [
    EModelEndpoint.google,
    ...(hasCustomVertex ? [] : [Providers.VERTEXAI]),
  ]) {
    const ratesByModel: EndpointTokenConfig = {};
    const location =
      endpoint === Providers.VERTEXAI || googleUsesVertex ? googleLocation : undefined;
    for (const model of resolvedModelsConfig[endpoint] ?? []) {
      const rates = getGoogleTokenConfig(
        model,
        appConfig?.endpoints?.google?.tokenConfig,
        location,
      );
      if (rates) ratesByModel[model] = rates;
    }
    endpointTokenConfigs[endpoint] = ratesByModel;
  }

  for (const endpointConfig of customEndpoints) {
    /** Models config and the token-config cache key by the normalized name */
    const name = normalizeEndpointName(endpointConfig?.name);
    if (!name || !Object.prototype.hasOwnProperty.call(modelsConfig, name)) {
      continue;
    }
    if (endpointConfig.tokenConfig != null) {
      endpointTokenConfigs[name] = endpointConfig.tokenConfig as EndpointTokenConfig;
      continue;
    }
    /** Model fetches and chat initialization both store under this key —
     *  user-scoped whenever the fetched config can be user-specific */
    const tokenKey = getTokenConfigKey(endpointConfig, name, userId, tenantId);
    const cached = (await cache.get(tokenKey)) as EndpointTokenConfig | undefined;
    if (cached) {
      endpointTokenConfigs[name] = cached;
    }
  }

  return buildTokenConfigMap(
    { modelsConfig: resolvedModelsConfig, endpointTokenConfigs, includePricing },
    deps,
  );
}

export type GoogleBillingConfig = Pick<
  ResolveTokenConfigParams,
  'googleUsesVertex' | 'googleLocation'
> & { userUsesVertex?: (userId: string) => Promise<boolean> };

/** Resolve existing deployment settings at the application wiring boundary. */
export function getGoogleBillingConfig(
  environment: {
    GOOGLE_KEY?: string;
    GOOGLE_LOC?: string;
  },
  getUserKey?: (params: { userId: string; name: string; activeOnly: boolean }) => Promise<string>,
): GoogleBillingConfig {
  return {
    googleUsesVertex: !environment.GOOGLE_KEY?.trim(),
    googleLocation: environment.GOOGLE_LOC,
    ...(environment.GOOGLE_KEY === 'user_provided' &&
      getUserKey && {
        async userUsesVertex(userId: string) {
          let credentials: string;
          try {
            credentials = await getUserKey({
              userId,
              name: EModelEndpoint.google,
              activeOnly: true,
            });
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === JSON.stringify({ type: ErrorTypes.NO_USER_KEY })
            )
              return false;
            throw error;
          }
          try {
            return Boolean(resolveGoogleAuth(credentials).projectId);
          } catch {
            // An unusable saved credential cannot select Vertex for a Google request.
            return false;
          }
        },
      }),
  };
}

export interface TokenConfigControllerDeps extends TokenomicsDeps {
  googleBillingConfig?: GoogleBillingConfig;
  getRequestModelsConfig: (
    req: ServerRequest,
    endpointOverride?: string,
  ) => Promise<RequestModelsConfigResult>;
}

export function createTokenConfigController(
  deps: TokenConfigControllerDeps,
): (req: ServerRequest, res: Response) => Promise<Response> {
  return async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const endpoint = req.query.endpoint;
      const isNativeVertex =
        endpoint === Providers.VERTEXAI &&
        !req.config?.endpoints?.custom?.some(
          (custom) => normalizeEndpointName(custom.name) === endpoint,
        );
      const result = await deps.getRequestModelsConfig(
        req,
        isNativeVertex ? EModelEndpoint.google : undefined,
      );
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      const billing = deps.googleBillingConfig;
      const needsUserMode =
        (endpoint == null || endpoint === EModelEndpoint.google) &&
        req.config?.interfaceConfig?.contextCost === true &&
        !!billing?.userUsesVertex &&
        !!billing.googleLocation &&
        billing.googleLocation !== 'global' &&
        result.modelsConfig.google?.some((model) => isGeminiNeon(model) || isGeminiHydrogen(model));
      const map = await resolveTokenConfigMap(
        {
          appConfig: req.config,
          modelsConfig: result.modelsConfig,
          userId: req.user.id,
          tenantId: req.user.tenantId,
          googleLocation: billing?.googleLocation,
          googleUsesVertex:
            needsUserMode && billing?.userUsesVertex
              ? await billing.userUsesVertex(req.user.id)
              : billing?.googleUsesVertex,
        },
        deps,
      );
      return res.json(typeof endpoint === 'string' ? { [endpoint]: map[endpoint] ?? {} } : map);
    } catch (error) {
      logger.error('[tokenConfigController]', getSafeErrorMetadata(error));
      return res.status(500).json({ error: 'Failed to resolve token config' });
    }
  };
}
