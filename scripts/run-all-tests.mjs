#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

function runStep(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error != null) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runStep(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['test:unit']);
runStep(process.execPath, ['./scripts/run-live-test.mjs', ...process.argv.slice(2)]);
