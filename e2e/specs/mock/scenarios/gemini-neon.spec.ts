import { expect, test } from '@playwright/test';
import {
  NEW_CHAT_PATH,
  getAccessToken,
  messagesView,
  requestJson,
  selectModelSpec,
  sendMessageAndWaitForCompletion,
} from '../helpers';
import { cleanupAgent, uniqueAgentName } from '../agents.helpers';

for (const mode of ['chat', 'agent'] as const) {
  test(`Neon ${mode} retains its foreground budget on reload @scenario:neon-${mode}-reload`, async ({
    page,
  }) => {
    const model = 'gemini-4-neon';
    await page.goto(NEW_CHAT_PATH);
    const agent =
      mode === 'agent'
        ? await requestJson<{ id: string }>(page, {
            path: '/api/agents',
            token: await getAccessToken(page),
            method: 'POST',
            body: {
              name: uniqueAgentName('Neon'),
              provider: 'google',
              model,
              instructions: 'Respond briefly.',
              model_parameters: { maxOutputTokens: 1000000, thinkingLevel: 'xhigh' },
            },
          })
        : undefined;
    try {
      if (agent) {
        await page.goto(`${NEW_CHAT_PATH}?agent_id=${encodeURIComponent(agent.id)}`);
      } else {
        await selectModelSpec(page, 'Neon Fixture');
      }
      for (const restored of [false, true]) {
        if (restored) await page.reload();
        await sendMessageAndWaitForCompletion(page, `E2E_REPORT_LLM_CONFIG ${Date.now()}`);
        const reply = messagesView(page)
          .getByText(/E2E llm config: /)
          .last();
        const text = (await reply.textContent()) ?? '';
        const config = JSON.parse(text.slice(text.indexOf('{')));
        expect(config).toMatchObject({
          model,
          maxOutputTokens: 65536,
          thinkingLevel: agent ? 'XHIGH' : 'HIGH',
          location: process.env.E2E_GOOGLE_VERTEX === 'true' ? 'eu' : null,
        });
        expect(config.maxContextTokens).toBeGreaterThan(0);
        expect(config.maxContextTokens).toBeLessThanOrEqual(983040);
      }
    } finally {
      if (agent) await cleanupAgent(page, agent.id);
    }
  });
}
