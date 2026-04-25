#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { DEFAULT_LIVE_CHAT_URL, parseExactChatTargetUrl } from './live-targets-lib.mjs';

function printHelp() {
  console.log('Usage: pnpm test:e2e -- [live options] [playwright options]');
  console.log('');
  console.log('Live options:');
  console.log('  --chat-url=<https://chatgpt.com/c/...>');
  console.log('  --use-active-tab                  Convenience mode; resolve the missing target from the active ChatGPT tab');
  console.log('  --help                            Show this message');
  console.log('');
  console.log('Examples:');
  console.log(`  pnpm test:e2e                          Defaults to ${DEFAULT_LIVE_CHAT_URL}`);
  console.log(`  pnpm test:e2e -- --chat-url=${DEFAULT_LIVE_CHAT_URL}`);
  console.log('  pnpm test:e2e -- --use-active-tab');
  console.log(`  pnpm test:all -- --chat-url=${DEFAULT_LIVE_CHAT_URL}`);
}

function fail(message) {
  console.error(`[live-e2e] ${message}`);
  process.exit(1);
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (value == null || value.startsWith('--')) {
    fail(`Missing value for ${optionName}.`);
  }

  return value;
}

function parseArgs(argv) {
  let chatUrl = null;
  let useActiveTab = false;
  const playwrightArgs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--' && index === 0) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--') {
      playwrightArgs.push(...argv.slice(index + 1));
      break;
    }

    if (arg === '--use-active-tab') {
      useActiveTab = true;
      continue;
    }

    if (arg === '--scenario' || arg.startsWith('--scenario=')) {
      fail('The live chat smoke no longer supports --scenario. Use --chat-url or --use-active-tab.');
    }

    if (arg === '--share-url' || arg.startsWith('--share-url=')) {
      fail('The live chat smoke no longer accepts --share-url.');
    }

    if (arg === '--chat-url') {
      chatUrl = readOptionValue(argv, index, '--chat-url');
      index += 1;
      continue;
    }

    if (arg.startsWith('--chat-url=')) {
      chatUrl = arg.slice('--chat-url='.length);
      continue;
    }

    playwrightArgs.push(arg);
  }

  if (chatUrl == null && !useActiveTab) {
    chatUrl = DEFAULT_LIVE_CHAT_URL;
  }

  if (chatUrl != null && useActiveTab) {
    fail('Use either --chat-url or --use-active-tab for live chat smoke, not both.');
  }

  if (chatUrl != null) {
    chatUrl = parseExactChatTargetUrl(chatUrl).url;
  }

  return {
    chatUrl,
    useActiveTab,
    playwrightArgs,
  };
}

function runStep(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
  });

  if (result.error != null) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const parsedArgs = parseArgs(process.argv.slice(2));

runStep(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['build']);
runStep(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['reload:mcp-chrome']);
if (parsedArgs.chatUrl != null) {
  runStep(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
    'check:mcp-chrome',
    '--',
    '--url',
    parsedArgs.chatUrl,
  ]);
}
runStep(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'playwright', 'test', 'tests/e2e/live-smoke.spec.ts', ...parsedArgs.playwrightArgs],
  {
    ...process.env,
    TURBO_RENDER_LIVE_TESTS: '1',
    TURBO_RENDER_LIVE_CHAT_URL: parsedArgs.chatUrl ?? '',
    TURBO_RENDER_LIVE_USE_ACTIVE_TAB: parsedArgs.useActiveTab ? '1' : '0',
  },
);
