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

    await expect(page.locator('#harness-status')).toContainText('parked', { timeout: 15_000 });
    await expect(page.locator('[data-turbo-render-group-id]').first()).toBeVisible();

    await page.getByRole('button', { name: 'Restore all' }).click();
    await expect(page.locator('[data-turbo-render-group-id]')).toHaveCount(0);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
