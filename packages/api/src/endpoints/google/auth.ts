import { AuthKeys } from 'librechat-data-provider';
import type { GoogleCredentials, GoogleConfigOptions } from '~/types';

export function resolveGoogleAuth(
  credentials: string | GoogleCredentials | undefined,
  options: Pick<GoogleConfigOptions, 'forceVertex' | 'projectId'> = {},
  acceptRawApiKey = false,
) {
  let creds: GoogleCredentials = {};
  if (acceptRawApiKey && typeof credentials === 'string') {
    creds[AuthKeys.GOOGLE_API_KEY] = credentials;
  } else if (typeof credentials === 'string') {
    try {
      creds = JSON.parse(credentials);
    } catch {
      throw new Error('Error parsing string credentials');
    }
  } else if (credentials && typeof credentials === 'object') {
    creds = credentials;
  }

  const serviceKeyRaw = creds[AuthKeys.GOOGLE_SERVICE_KEY] ?? {};
  const serviceKey =
    typeof serviceKeyRaw === 'string' ? JSON.parse(serviceKeyRaw) : (serviceKeyRaw ?? {});

  const apiKey = creds[AuthKeys.GOOGLE_API_KEY] ?? null;
  let projectId = null;
  if (options.forceVertex === true) {
    projectId = options.projectId ?? serviceKey?.project_id ?? null;
  } else if (!apiKey) {
    projectId = serviceKey?.project_id ?? null;
  }
  return { apiKey, serviceKey, projectId };
}
