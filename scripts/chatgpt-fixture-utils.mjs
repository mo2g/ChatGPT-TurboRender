#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, '..');
export const CHATGPT_FIXTURE_CAPTURE_COMMAND = 'pnpm legacy:fixtures:capture';
export const CHATGPT_FIXTURE_MANIFEST_PATH = path.join(
  repoRoot,
  'tests',
  'fixtures',
  'chatgpt-fixtures.manifest.json',
);
export const DEFAULT_CHATGPT_FIXTURE_ROOT = path.join(repoRoot, 'tests', 'fixtures-local', 'chatgpt');
// Legacy HAR-based fixtures (Phase-out gradually)
export const REQUIRED_CHATGPT_FIXTURE_FILES = Object.freeze([
  'replay.har.zip',
  'page.mhtml',
  'conversation.json',
  'storage-state.json',
  'metadata.json',
]);

// New origin fixture replay files (Phase 1: shell.html + conversation.json)
export const ORIGIN_FIXTURE_FILES = Object.freeze([
  'shell.html', // Cleaned page shell for serving as chatgpt.com document
  'conversation.json', // API response from /backend-api/conversation/<id>
  'meta.json', // Minimal metadata without sensitive data
  'synthesize.json', // Mock response for /backend-api/synthesize
]);

export function loadChatgptFixtureManifest() {
  const text = fs.readFileSync(CHATGPT_FIXTURE_MANIFEST_PATH, 'utf8');
  return JSON.parse(text);
}

export function resolveChatgptFixtureRoot() {
  const configuredRoot = process.env.TURBO_RENDER_FIXTURE_ROOT?.trim();
  if (configuredRoot == null || configuredRoot.length === 0) {
    return DEFAULT_CHATGPT_FIXTURE_ROOT;
  }

  return path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.resolve(repoRoot, configuredRoot);
}

export function resolveChatgptFixtureDir(fixture, rootDir = resolveChatgptFixtureRoot()) {
  return path.join(rootDir, fixture.id);
}

export function resolveChatgptFixtureFiles(fixture, rootDir = resolveChatgptFixtureRoot()) {
  const dir = resolveChatgptFixtureDir(fixture, rootDir);
  return {
    dir,
    // Legacy HAR-based fixtures
    replayHarZip: path.join(dir, 'replay.har.zip'),
    pageMhtml: path.join(dir, 'page.mhtml'),
    conversationJson: path.join(dir, 'conversation.json'),
    storageStateJson: path.join(dir, 'storage-state.json'),
    metadataJson: path.join(dir, 'metadata.json'),
    // New origin fixture replay files
    shellHtml: path.join(dir, 'shell.html'),
    metaJson: path.join(dir, 'meta.json'),
    synthesizeJson: path.join(dir, 'synthesize.json'),
    // Phase 4: Offline static assets and fallback
    assetsDir: path.join(dir, 'assets'),
    assetsJson: path.join(dir, 'assets.json'),
    fallbackHtml: path.join(dir, 'fallback.html'),
  };
}

export function collectMissingChatgptFixtureProblems(
  fixtures = loadChatgptFixtureManifest(),
  rootDir = resolveChatgptFixtureRoot(),
) {
  const problems = [];

  for (const fixture of fixtures) {
    const dir = resolveChatgptFixtureDir(fixture, rootDir);
    for (const filename of REQUIRED_CHATGPT_FIXTURE_FILES) {
      const filePath = path.join(dir, filename);
      if (!fs.existsSync(filePath)) {
        problems.push(`${fixture.id}: missing ${path.relative(rootDir, filePath)}`);
      }
    }
  }

  return problems;
}

export function formatMissingChatgptFixturesMessage(
  problems,
  rootDir = resolveChatgptFixtureRoot(),
) {
  const lines = [
    `[TurboRender] Offline ChatGPT fixtures are incomplete under ${rootDir}.`,
    ...problems.map((problem) => `- ${problem}`),
    `Repair: ${CHATGPT_FIXTURE_CAPTURE_COMMAND}`,
  ];

  return lines.join('\n');
}
