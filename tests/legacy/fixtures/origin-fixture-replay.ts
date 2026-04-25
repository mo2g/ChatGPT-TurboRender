import type { BrowserContext, Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { ChatgptFixtureDefinition } from './chatgpt-fixtures';
import { resolveChatgptFixturePaths, resolveChatgptFixtureRoot } from './chatgpt-fixtures';

declare global {
  interface Window {
    __TURBO_RENDER_FIXTURE__?: {
      mode: string;
      fixtureId: string;
      conversationId: string;
    };
  }
}

/**
 * Origin Fixture Replay - Level 1: Same-origin "semi-offline" replay
 *
 * This harness uses Playwright's context.route() to intercept requests
 * at the browser network layer, keeping the URL bar at https://chatgpt.com/...
 *
 * Benefits:
 * - Extension host permissions still match
 * - Content script injects into chatgpt.com origin
 * - No cookies / storageState / login state required
 * - Precise fixture data control
 */

export interface OriginFixtureReplayOptions {
  /**
   * Whether to block auth/session-related requests.
   * Default: true
   */
  blockAuthRequests?: boolean;

  /**
   * Whether to block telemetry/experiment endpoints.
   * Default: true
   */
  blockTelemetry?: boolean;

  /**
   * Custom route handlers for additional requests.
   */
  customRoutes?: Array<{
    pattern: string | RegExp;
    handler: (route: import('@playwright/test').Route) => Promise<void>;
  }>;
}

/**
 * Loads fixture files and sets up context routes for origin replay.
 */
export async function setupOriginFixtureReplay(
  context: BrowserContext,
  fixture: ChatgptFixtureDefinition,
  options: OriginFixtureReplayOptions = {},
): Promise<void> {
  const { blockAuthRequests = true, blockTelemetry = true, customRoutes = [] } = options;
  const filePaths = resolveChatgptFixturePaths(fixture, resolveChatgptFixtureRoot());

  // Load fixture files - P2: include fallback.html
  const [shellHtml, fallbackHtml, conversationJson, synthesizeJson, assetsJson] = await Promise.all([
    readFile(filePaths.shellHtml, 'utf-8').catch(() => null),
    readFile(filePaths.fallbackHtml, 'utf-8').catch(() => null),
    readFile(filePaths.conversationJson, 'utf-8')
      .then(JSON.parse)
      .catch(() => null),
    readFile(filePaths.synthesizeJson, 'utf-8')
      .then(JSON.parse)
      .catch(() => null),
    readFile(filePaths.assetsJson, 'utf-8')
      .then(JSON.parse)
      .catch(() => null),
  ]);

  // P2: Use fallback if shell.html is missing
  const effectiveShellHtml = shellHtml ?? fallbackHtml;
  if (!effectiveShellHtml) {
    throw new Error(
      `Neither shell.html nor fallback.html found for fixture ${fixture.id}. Run 'pnpm legacy:fixtures:capture' first.`,
    );
  }
  if (!shellHtml && fallbackHtml) {
    console.warn(`[OriginReplay] WARNING: shell.html missing, using fallback.html for ${fixture.id}`);
  }
  if (!conversationJson) {
    throw new Error(
      `conversation.json not found for fixture ${fixture.id}. Run 'pnpm legacy:fixtures:capture' first.`,
    );
  }

  // P3: Warn about missing critical resources
  if (assetsJson?.missingCritical > 0) {
    console.warn(`[OriginReplay] WARNING: Fixture has ${assetsJson.missingCritical} uncaptured critical resources`);
    for (const url of (assetsJson.missingCriticalUrls || []).slice(0, 3)) {
      console.warn(`  - ${url}`);
    }
    console.warn(`[OriginReplay] Consider recapturing the fixture for complete offline support`);
  }

  // 1. Intercept main document: /c/<conversationId>
  await context.route(
    new RegExp(`https://chatgpt\\.com/c/${fixture.conversationId}($|\\?|#)`),
    async (route) => {
      const request = route.request();
      if (request.resourceType() === 'document') {
        console.log(`[OriginReplay] Serving ${shellHtml ? 'shell.html' : 'fallback.html'} for ${fixture.id}`);
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: effectiveShellHtml,
        });
      } else {
        await route.continue();
      }
    },
  );

  // 2. Intercept conversation API: /backend-api/conversation/<id>
  await context.route(
    `https://chatgpt.com/backend-api/conversation/${fixture.conversationId}*`,
    async (route) => {
      console.log(`[OriginReplay] Serving conversation.json for ${fixture.id}`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(conversationJson),
      });
    },
  );

  // 3. Intercept synthesize API: /backend-api/synthesize
  await context.route(
    'https://chatgpt.com/backend-api/synthesize*',
    async (route) => {
      if (synthesizeJson) {
        console.log(`[OriginReplay] Serving synthesize.json`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(synthesizeJson),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            url: 'https://www.soundjay.com/misc/sounds/beep-01a.mp3',
            duration_ms: 1000,
            voice: 'cove',
            conversation_id: fixture.conversationId,
            message_id: 'mock-message-id',
          }),
        });
      }
    },
  );

  // 4. Block auth/session requests (optional)
  if (blockAuthRequests) {
    const authPatterns = [
      'https://chatgpt.com/api/auth/*',
      'https://chatgpt.com/backend-api/accounts/*',
      'https://chatgpt.com/auth/*',
    ];
    for (const pattern of authPatterns) {
      await context.route(pattern, async (route) => {
        console.log(`[OriginReplay] Blocking auth request: ${route.request().url()}`);
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Not authenticated (fixture replay mode)' }),
        });
      });
    }
  }

  // 5. Block telemetry/experiment endpoints (optional)
  if (blockTelemetry) {
    const telemetryPatterns = [
      'https://chatgpt.com/ces/*',
      'https://chatgpt.com/telemetry/*',
      'https://chatgpt.com/admin_api/*',
      '**/analytics*',
      '**/statsig*',
    ];
    for (const pattern of telemetryPatterns) {
      await context.route(pattern, async (route) => {
        await route.abort('aborted');
      });
    }
  }

  // 6. Block WebSocket/SSE (Phase 1)
  await context.route('wss://chatgpt.com/*', async (route) => {
    await route.abort('blockedbyclient');
  });

  // Phase 4: Serve static assets (CSS/JS/fonts) from local fixture directory for offline replay
  try {
    const assetsJson = await readFile(filePaths.assetsJson, 'utf-8')
      .then(JSON.parse)
      .catch(() => null);

    if (assetsJson?.assets?.length > 0) {
      console.log(`[OriginReplay] Setting up ${assetsJson.assets.length} static asset routes`);

      for (const asset of assetsJson.assets) {
        const assetPath = asset.localPath;
        const assetUrl = asset.url;

        await context.route(assetUrl, async (route) => {
          try {
            const fs = await import('node:fs/promises');
            const localFilePath = path.join(filePaths.assetsDir, assetPath);
            const content = await fs.readFile(localFilePath);

            console.log(`[OriginReplay] Serving local asset: ${assetUrl}`);
            await route.fulfill({
              status: 200,
              contentType: asset.contentType || 'application/octet-stream',
              body: content,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(`[OriginReplay] Failed to serve local asset ${assetUrl}: ${message}`);
            await route.continue();
          }
        });
      }
    }
  } catch {
    // Assets manifest not found, skip static asset interception
    console.log(`[OriginReplay] No static assets manifest found for ${fixture.id}`);
  }

  // 7. Custom routes (user-provided)
  for (const { pattern, handler } of customRoutes) {
    await context.route(pattern, handler);
  }

  console.log(`[OriginReplay] Routes configured for fixture ${fixture.id}`);
}

/**
 * Navigates to the fixture URL with origin replay enabled.
 */
export async function gotoWithOriginFixtureReplay(
  page: Page,
  fixture: ChatgptFixtureDefinition,
  options: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' } = {},
): Promise<void> {
  const { timeout = 60000, waitUntil = 'load' } = options;

  console.log(`[OriginReplay] Navigating to ${fixture.url}`);
  await page.goto(fixture.url, {
    waitUntil,
    timeout,
  });

  // Wait for extension initialization
  await page.waitForTimeout(2000);

  // Inject fixture data marker for extension detection
  await page.evaluate((fixtureData) => {
    // Signal to extension that this is a fixture replay
    window.__TURBO_RENDER_FIXTURE__ = {
      mode: 'origin-fixture-replay',
      fixtureId: fixtureData.id,
      conversationId: fixtureData.conversationId,
    };
  }, fixture);
}

/**
 * Helper to run a test with origin fixture replay.
 */
export async function withOriginFixturePage(
  context: BrowserContext,
  fixture: ChatgptFixtureDefinition,
  callback: (page: Page) => Promise<void>,
  options: OriginFixtureReplayOptions & { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' } = {},
): Promise<void> {
  await setupOriginFixtureReplay(context, fixture, options);

  const page = await context.newPage();

  // Listen for extension console logs
  page.on('console', (msg) => {
    if (msg.text().includes('TurboRender')) {
      console.log(`[ExtConsole] ${msg.type()}: ${msg.text()}`);
    }
  });

  try {
    await gotoWithOriginFixtureReplay(page, fixture, options);
    await callback(page);
  } finally {
    await page.close();
  }
}
