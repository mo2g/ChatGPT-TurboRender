import { chromium, expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('harness parks and restores turns inside the extension build', async () => {
  const extensionPath = path.resolve('.output/chrome-mv3');
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'turborender-playwright-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    let extensionId = '';
    const serviceWorker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
    const serviceWorkerUrl = serviceWorker.url();
    extensionId = new URL(serviceWorkerUrl).host;

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/harness.html`);

    const inlineHistoryRoot = page.locator('[data-turbo-render-inline-history-root="true"]');
    await expect(inlineHistoryRoot).toBeVisible({ timeout: 15_000 });

    const firstBatch = page.locator('[data-turbo-render-batch-anchor="true"]').first();
    await expect(firstBatch).toBeVisible();
    await expect(firstBatch.locator('[data-lane]')).toHaveCount(0);

    const firstToggle = firstBatch.locator('[data-turbo-render-action="toggle-archive-group"]');
    await expect(firstToggle).toBeVisible();
    await firstToggle.click();
    await expect(firstBatch.locator('[data-lane]').first()).toBeVisible();
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
