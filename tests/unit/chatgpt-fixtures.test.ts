import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CHATGPT_FIXTURE_CAPTURE_COMMAND,
  collectMissingChatgptFixtureProblems,
  createMissingChatgptFixturesError,
  getChatgptFixture,
  loadChatgptFixtures,
} from '../legacy/fixtures/chatgpt-fixtures';

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
});

describe('chatgpt fixture manifest', () => {
  it('tracks the two local-only real conversation fixtures', () => {
    const fixtures = loadChatgptFixtures();
    expect(fixtures).toHaveLength(2);
    expect(fixtures.map((fixture) => fixture.conversationId)).toEqual([
      'e77b97e5-a8b7-4380-a2d7-f3f6b775bc5f',
      'ceb4ea77-5357-49fb-b35c-607b533846f1',
    ]);
  });

  it('reports a single remediation when fixture files are missing', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'turbo-render-fixtures-'));
    createdDirs.push(tempRoot);

    const fixture = getChatgptFixture('small-real-conversation');
    const problems = collectMissingChatgptFixtureProblems([fixture], tempRoot);
    const error = createMissingChatgptFixturesError([fixture], tempRoot);

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((problem) => problem.includes('replay.har.zip'))).toBe(true);
    expect(error?.message).toContain(CHATGPT_FIXTURE_CAPTURE_COMMAND);
    expect(error?.message).not.toContain('pnpm test:e2e');
  });
});
