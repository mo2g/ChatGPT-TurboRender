import { expect, test, type Page } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

import { launchControlledBrowser, type ControlledBrowserHandle } from './controlled-browser';

const OUTPUT_DIR = path.resolve('.output/chrome-mv3');

function createStaticServer(rootDir: string): Promise<{ baseUrl: string; close(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      try {
        const parsedUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        const pathname = decodeURIComponent(parsedUrl.pathname);
        const relativePath = pathname === '/' ? '/harness.html' : pathname;
        const resolvedPath = path.resolve(rootDir, `.${relativePath}`);
        const relativeToRoot = path.relative(rootDir, resolvedPath);

        if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
          response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Forbidden');
          return;
        }

        const fileBuffer = await fs.readFile(resolvedPath);
        const extension = path.extname(resolvedPath).toLowerCase();
        const contentType =
          extension === '.html'
            ? 'text/html; charset=utf-8'
            : extension === '.js'
              ? 'text/javascript; charset=utf-8'
              : extension === '.css'
                ? 'text/css; charset=utf-8'
                : extension === '.json'
                  ? 'application/json; charset=utf-8'
                  : 'application/octet-stream';

        response.writeHead(200, { 'Content-Type': contentType });
        response.end(fileBuffer);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(message);
      }
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address == null || typeof address === 'string') {
        reject(new Error('Unable to start harness smoke-test server.'));
        return;
      }

      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }

              closeResolve();
            });
          }),
      });
    });
  });
}

let browserHandle: ControlledBrowserHandle | null = null;

test.beforeAll(async () => {
  browserHandle = await launchControlledBrowser('about:blank');
});

test.afterAll(async () => {
  await browserHandle?.cleanup();
  browserHandle = null;
});

async function withHarnessPage(baseUrl: string, callback: (page: Page) => Promise<void>) {
  if (browserHandle == null) {
    throw new Error('Controlled browser is unavailable.');
  }

  const context = browserHandle.browser.contexts()[0];
  if (context == null) {
    throw new Error('Controlled browser did not expose a default context.');
  }

  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/harness.html`);
    await callback(page);
  } finally {
    await page.close();
  }
}

test('harness parks and restores turns inside the extension build', async () => {
  const server = await createStaticServer(OUTPUT_DIR);

  try {
    await withHarnessPage(server.baseUrl, async (page) => {
      const inlineHistoryRoot = page.locator('[data-turbo-render-inline-history-root="true"]');
      await expect(inlineHistoryRoot).toBeVisible({ timeout: 15_000 });

      const firstBatch = page.locator('[data-turbo-render-batch-anchor="true"]').first();
      await expect(firstBatch).toBeVisible();
      await expect(firstBatch.locator('[data-lane]')).toHaveCount(0);

      const firstToggle = firstBatch.locator('[data-turbo-render-action="toggle-archive-group"]');
      await expect(firstToggle).toBeVisible();
      await firstToggle.click();
      await expect(firstBatch.locator('[data-lane]').first()).toBeVisible();
    });
  } finally {
    await server.close();
  }
});
