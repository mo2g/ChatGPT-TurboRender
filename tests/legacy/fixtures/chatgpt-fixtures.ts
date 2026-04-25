import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContext, Page } from '@playwright/test';

function resolveRepoRoot(): string {
  const metaUrl = import.meta.url;
  if (metaUrl.startsWith('file://')) {
    return path.resolve(fileURLToPath(new URL('../../../', metaUrl)));
  }

  return path.resolve(process.cwd());
}

const repoRoot = resolveRepoRoot();
const manifestPath = path.join(repoRoot, 'tests', 'fixtures', 'chatgpt-fixtures.manifest.json');

export const CHATGPT_FIXTURE_CAPTURE_COMMAND = 'pnpm legacy:fixtures:capture';
export const DEFAULT_CHATGPT_FIXTURE_ROOT = path.join(repoRoot, 'tests', 'fixtures-local', 'chatgpt');
export const requiredChatgptFixtureFiles = [
  'replay.har.zip',
  'page.mhtml',
  'conversation.json',
  'storage-state.json',
  'metadata.json',
] as const;

export interface ChatgptFixtureDefinition {
  id: string;
  url: string;
  conversationId: string;
  expectedMinTurns: number;
  warmupProfile: string;
}

export interface ChatgptFixturePaths {
  dir: string;
  // Legacy HAR-based fixtures
  replayHarZip: string;
  pageMhtml: string;
  conversationJson: string;
  storageStateJson: string;
  metadataJson: string;
  // New origin fixture replay files
  shellHtml: string;
  metaJson: string;
  synthesizeJson: string;
  // Phase 4: Offline static assets
  assetsDir: string;
  assetsJson: string;
  // P2: Fallback minimal shell for degraded replay
  fallbackHtml: string;
}

export interface ChatgptStorageItem {
  name: string;
  value: string;
}

export interface ChatgptCookieState {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface ChatgptOriginStorageState {
  origin: string;
  localStorage: ChatgptStorageItem[];
  sessionStorage?: ChatgptStorageItem[];
}

export interface ChatgptFixtureStorageState {
  cookies: ChatgptCookieState[];
  origins: ChatgptOriginStorageState[];
}

export function loadChatgptFixtures(): ChatgptFixtureDefinition[] {
  const text = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(text) as ChatgptFixtureDefinition[];
}

export function getChatgptFixture(
  id: string,
  fixtures = loadChatgptFixtures(),
): ChatgptFixtureDefinition {
  const fixture = fixtures.find((candidate) => candidate.id === id) ?? null;
  if (fixture == null) {
    throw new Error(`Unknown ChatGPT fixture: ${id}`);
  }

  return fixture;
}

export function resolveChatgptFixtureRoot(customRoot?: string): string {
  const configuredRoot = customRoot ?? process.env.TURBO_RENDER_FIXTURE_ROOT?.trim() ?? '';
  if (configuredRoot.length === 0) {
    return DEFAULT_CHATGPT_FIXTURE_ROOT;
  }

  return path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.resolve(repoRoot, configuredRoot);
}

export function resolveChatgptFixturePaths(
  fixture: ChatgptFixtureDefinition,
  rootDir = resolveChatgptFixtureRoot(),
): ChatgptFixturePaths {
  const dir = path.join(rootDir, fixture.id);
  return {
    dir,
    replayHarZip: path.join(dir, 'replay.har.zip'),
    pageMhtml: path.join(dir, 'page.mhtml'),
    conversationJson: path.join(dir, 'conversation.json'),
    storageStateJson: path.join(dir, 'storage-state.json'),
    metadataJson: path.join(dir, 'metadata.json'),
    shellHtml: path.join(dir, 'shell.html'),
    metaJson: path.join(dir, 'meta.json'),
    synthesizeJson: path.join(dir, 'synthesize.json'),
    // Phase 4: Offline static assets
    assetsDir: path.join(dir, 'assets'),
    assetsJson: path.join(dir, 'assets.json'),
    // P2: Fallback minimal shell
    fallbackHtml: path.join(dir, 'fallback.html'),
  };
}

export function collectMissingChatgptFixtureProblems(
  fixtures = loadChatgptFixtures(),
  rootDir = resolveChatgptFixtureRoot(),
): string[] {
  const problems: string[] = [];

  for (const fixture of fixtures) {
    const filePaths = resolveChatgptFixturePaths(fixture, rootDir);
    for (const filename of requiredChatgptFixtureFiles) {
      const filePath = filePaths[
        filename === 'replay.har.zip'
          ? 'replayHarZip'
          : filename === 'page.mhtml'
            ? 'pageMhtml'
            : filename === 'conversation.json'
              ? 'conversationJson'
              : filename === 'storage-state.json'
                ? 'storageStateJson'
                : 'metadataJson'
      ];
      if (!fs.existsSync(filePath)) {
        problems.push(`${fixture.id}: missing ${path.relative(rootDir, filePath)}`);
      }
    }
  }

  return problems;
}

export function formatMissingChatgptFixturesMessage(
  problems: string[],
  rootDir = resolveChatgptFixtureRoot(),
): string {
  return [
    `[TurboRender] Offline ChatGPT fixtures are incomplete under ${rootDir}.`,
    ...problems.map((problem) => `- ${problem}`),
    `Repair: ${CHATGPT_FIXTURE_CAPTURE_COMMAND}`,
  ].join('\n');
}

export function createMissingChatgptFixturesError(
  fixtures = loadChatgptFixtures(),
  rootDir = resolveChatgptFixtureRoot(),
): Error | null {
  const problems = collectMissingChatgptFixtureProblems(fixtures, rootDir);
  if (problems.length === 0) {
    return null;
  }

  return new Error(formatMissingChatgptFixturesMessage(problems, rootDir));
}

export function assertChatgptFixturesAvailable(
  fixtures = loadChatgptFixtures(),
  rootDir = resolveChatgptFixtureRoot(),
): void {
  const error = createMissingChatgptFixturesError(fixtures, rootDir);
  if (error != null) {
    throw error;
  }
}

export async function readChatgptFixtureStorageState(
  fixture: ChatgptFixtureDefinition,
  rootDir = resolveChatgptFixtureRoot(),
): Promise<ChatgptFixtureStorageState> {
  const { storageStateJson } = resolveChatgptFixturePaths(fixture, rootDir);
  const text = await fsPromises.readFile(storageStateJson, 'utf8');
  return JSON.parse(text) as ChatgptFixtureStorageState;
}

export async function setDebugConversationId(page: Page, conversationId: string): Promise<void> {
  await page.evaluate((inputConversationId) => {
    const debugConversationId = inputConversationId.trim();
    (window as Window & { __turboRenderDebugConversationId?: string }).__turboRenderDebugConversationId =
      debugConversationId;
    document.documentElement.dataset.turboRenderDebugConversationId = debugConversationId;
    if (document.body != null) {
      document.body.dataset.turboRenderDebugConversationId = debugConversationId;
    }
  }, conversationId);
}

export async function applyChatgptFixtureStorageState(
  context: BrowserContext,
  page: Page,
  storageState: ChatgptFixtureStorageState,
  conversationId: string,
): Promise<void> {
  await context.clearCookies();
  if (storageState.cookies.length > 0) {
    await context.addCookies(storageState.cookies);
  }

  const origins = storageState.origins.map((origin) => ({
    origin: origin.origin,
    localStorage: origin.localStorage.map((item) => ({ name: item.name, value: item.value })),
    sessionStorage: (origin.sessionStorage ?? []).map((item) => ({ name: item.name, value: item.value })),
  }));

  await page.addInitScript(
    ({ configuredOrigins, configuredConversationId }) => {
      const currentOrigin = window.location.origin;
      const matchedOrigin = configuredOrigins.find((origin) => origin.origin === currentOrigin) ?? null;
      if (matchedOrigin != null) {
        try {
          window.localStorage.clear();
          for (const item of matchedOrigin.localStorage) {
            window.localStorage.setItem(item.name, item.value);
          }
        } catch {
          // Ignore local storage write failures during bootstrap.
        }

        try {
          window.sessionStorage.clear();
          for (const item of matchedOrigin.sessionStorage) {
            window.sessionStorage.setItem(item.name, item.value);
          }
        } catch {
          // Ignore session storage write failures during bootstrap.
        }
      }

      const debugConversationId = configuredConversationId.trim();
      if (debugConversationId.length > 0) {
        (window as Window & { __turboRenderDebugConversationId?: string }).__turboRenderDebugConversationId =
          debugConversationId;
        document.documentElement.dataset.turboRenderDebugConversationId = debugConversationId;
      }
    },
    {
      configuredOrigins: origins,
      configuredConversationId: conversationId,
    },
  );
}
