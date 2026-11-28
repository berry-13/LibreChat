import { Providers } from '@librechat/agents';
import { AuthKeys, ThinkingLevel } from 'librechat-data-provider';
import { getGoogleConfig, getGoogleInputTokenLimit } from './llm';
import { getGoogleTokenConfig } from './pricing';

describe('Gemini 4 Neon request contract', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_LOC;
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  describe.each([
    [Providers.GOOGLE, { [AuthKeys.GOOGLE_API_KEY]: 'test-key' }],
    [Providers.VERTEXAI, { [AuthKeys.GOOGLE_SERVICE_KEY]: { project_id: 'test-project' } }],
  ])('%s', (provider, credentials) => {
    it.each([
      [ThinkingLevel.unset, 'HIGH'],
      [ThinkingLevel.minimal, 'LOW'],
      [ThinkingLevel.low, 'LOW'],
      [ThinkingLevel.medium, 'MEDIUM'],
      [ThinkingLevel.high, 'HIGH'],
      [ThinkingLevel.xhigh, 'XHIGH'],
    ])('normalizes thinking %s and excludes rejected parameters', (thinkingLevel, expected) => {
      const result = getGoogleConfig(credentials, {
        modelOptions: {
          model: 'gemini-4-neon',
          thinkingLevel,
          thinkingBudget: 4096,
          temperature: 0.2,
          topP: 0.3,
          topK: 20,
        },
        addParams: {
          maxReasoningTokens: 4096,
          presencePenalty: 0.5,
          frequencyPenalty: 0.5,
          cachedContent: 'cachedContents/123',
        },
      });
      expect(result.provider).toBe(provider);
      expect(result.llmConfig).toMatchObject({
        thinkingConfig: { includeThoughts: true, thinkingLevel: expected },
      });
      for (const param of [
        'temperature',
        'topP',
        'topK',
        'thinkingBudget',
        'maxReasoningTokens',
        'presencePenalty',
        'frequencyPenalty',
        'cachedContent',
      ]) {
        expect(result.llmConfig).not.toHaveProperty(param);
      }
      expect(result.llmConfig).not.toHaveProperty('thinkingConfig.thinkingBudget');
    });

    it('clamps admin output and normalizes an unspecified thinking level', () => {
      const { llmConfig } = getGoogleConfig(credentials, {
        modelOptions: { model: 'gemini-4-neon' },
        defaultParams: { thinkingLevel: 'THINKING_LEVEL_UNSPECIFIED' },
        addParams: { maxOutputTokens: 1000000 },
      });
      expect(llmConfig).toMatchObject({
        maxOutputTokens: 65536,
        thinkingConfig: { thinkingLevel: 'HIGH' },
      });
    });

    it('applies the Neon handling to versioned and provider-prefixed ids', () => {
      const result = getGoogleConfig(credentials, {
        modelOptions: { model: 'models/gemini-4-neon-001', temperature: 0.7 },
      });
      expect(result.llmConfig).not.toHaveProperty('temperature');
      expect(result.llmConfig).toMatchObject({
        maxOutputTokens: 65536,
        thinkingConfig: { thinkingLevel: 'HIGH' },
      });
    });
  });

  it('reserves the configured or default response inside the shared window', () => {
    expect(getGoogleInputTokenLimit('gemini-4-neon')).toBe(983040);
    expect(getGoogleInputTokenLimit('models/gemini-4-neon-001', 4096)).toBe(1044480);
    expect(getGoogleInputTokenLimit('gemini-4-neon', 1000000)).toBe(983040);
  });

  it.each([
    [undefined, 3, 0.15, 15],
    ['global', 3, 0.15, 15],
    ['eu', 3.3, 0.165, 16.5],
    ['us', 3.3, 0.165, 16.5],
  ] as const)('resolves billing rates for %s', (location, prompt, read, completion) => {
    expect(getGoogleTokenConfig('models/gemini-4-neon', undefined, location)).toEqual({
      prompt,
      completion,
      read,
      cacheRead: read,
    });
  });

  it('defaults to the global Vertex AI endpoint when GOOGLE_LOC is unset', () => {
    const result = getGoogleConfig(
      { [AuthKeys.GOOGLE_SERVICE_KEY]: { project_id: 'test-project' } },
      { modelOptions: { model: 'gemini-4-neon' } },
    );
    expect(result.llmConfig).toMatchObject({
      location: 'global',
      endpoint: 'aiplatform.googleapis.com',
    });
  });

  it.each([
    ['global', 'global', 'aiplatform.googleapis.com'],
    ['eu', 'eu', 'aiplatform.eu.rep.googleapis.com'],
    ['us', 'us', 'aiplatform.us.rep.googleapis.com'],
    ['europe-west4', 'eu', 'aiplatform.eu.rep.googleapis.com'],
    ['us-central1', 'us', 'aiplatform.us.rep.googleapis.com'],
  ])(
    'serves a configured %s Vertex AI location from the %s multi-region',
    (configured, location, endpoint) => {
      process.env.GOOGLE_LOC = configured;
      const result = getGoogleConfig(
        { [AuthKeys.GOOGLE_SERVICE_KEY]: { project_id: 'test-project' } },
        { modelOptions: { model: 'gemini-4-neon' } },
      );
      expect(result.llmConfig).toMatchObject({ location, endpoint });
    },
  );
});
