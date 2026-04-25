#!/usr/bin/env node

import {
  collectMissingChatgptFixtureProblems,
  formatMissingChatgptFixturesMessage,
  resolveChatgptFixtureRoot,
} from './chatgpt-fixture-utils.mjs';

const fixtureRoot = resolveChatgptFixtureRoot();
const problems = collectMissingChatgptFixtureProblems(undefined, fixtureRoot);

if (problems.length > 0) {
  console.error(formatMissingChatgptFixturesMessage(problems, fixtureRoot));
  process.exit(1);
}

console.log(`[TurboRender] Offline ChatGPT fixtures are ready under ${fixtureRoot}.`);
