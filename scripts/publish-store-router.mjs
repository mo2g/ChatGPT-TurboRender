#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseTarget(argv) {
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      return argv[index + 1] ?? 'all';
    }
  }
  return 'all';
}

function runNodeScript(scriptRelativePath, forwardedArgs) {
  const scriptPath = path.join(__dirname, scriptRelativePath);
  const result = spawnSync(process.execPath, [scriptPath, ...forwardedArgs], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${scriptRelativePath} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function normalizeArgsForTarget(argv, target) {
  const args = [];
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      index += 1;
      args.push('--target', target);
      continue;
    }
    args.push(arg);
  }

  if (!args.includes('--target')) {
    args.push('--target', target);
  }

  return args;
}

function main() {
  const forwardedArgs = process.argv.slice(2);
  if (forwardedArgs.includes('--check-chrome') || forwardedArgs.includes('--help') || forwardedArgs.includes('-h')) {
    runNodeScript('publish-stores.mjs', forwardedArgs);
    return;
  }

  const target = parseTarget(process.argv);
  if (target === 'chrome') {
    runNodeScript('publish-chrome-release.mjs', normalizeArgsForTarget(process.argv, 'chrome'));
    return;
  }

  if (target === 'edge' || target === 'firefox') {
    runNodeScript('publish-stores.mjs', normalizeArgsForTarget(process.argv, target));
    return;
  }

  if (target === 'all') {
    runNodeScript('publish-chrome-release.mjs', normalizeArgsForTarget(process.argv, 'chrome'));
    runNodeScript('publish-stores.mjs', normalizeArgsForTarget(process.argv, 'edge'));
    runNodeScript('publish-stores.mjs', normalizeArgsForTarget(process.argv, 'firefox'));
    return;
  }

  throw new Error(`Invalid target: ${target}`);
}

main();