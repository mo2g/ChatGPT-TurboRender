#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  assertSupportedBrowser,
  buildArtifactPath,
  buildChromiumPackArgs,
  buildFirefoxSignArgs,
  getSourceDir,
} from './package-browser-release-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const releaseDir = path.join(repoRoot, '.release');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function printHelp() {
  console.log(`ChatGPT TurboRender browser package builder

Usage:
  pnpm package:chrome
  pnpm package:edge
  pnpm package:firefox

Environment:
  CHROMIUM_CRX_PRIVATE_KEY_FILE  Path to the shared Chromium/Edge PEM key.
  AMO_JWT_ISSUER                 AMO JWT issuer for Firefox signing.
  AMO_JWT_SECRET                 AMO JWT secret for Firefox signing.
`);
}

function getBrowserFromArgs() {
  const browser = process.argv[2];
  if (!browser || browser === '--help' || browser === '-h') {
    printHelp();
    process.exit(browser ? 0 : 1);
  }

  return assertSupportedBrowser(browser);
}

async function readPackageVersion() {
  const raw = await fs.readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(`Unable to read package version from ${packageJsonPath}`);
  }

  return parsed.version;
}

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
}

async function removeIfExists(targetPath) {
  await fs.rm(targetPath, { force: true, recursive: true });
}

function runCommand(command, args, description) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${description} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

async function findNewestFile(directory, extension) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      }),
  );

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.filePath ?? null;
}

async function packageChromium(browser, version) {
  const sourceDir = getSourceDir(repoRoot, browser);
  const outputFile = buildArtifactPath(releaseDir, version, browser);
  const keyFile = process.env.CHROMIUM_CRX_PRIVATE_KEY_FILE;

  if (!keyFile) {
    throw new Error(
      'CHROMIUM_CRX_PRIVATE_KEY_FILE is required for chrome and edge packages. Provide a stable PEM key so the CRX ID stays the same across releases.',
    );
  }

  await ensureDirectory(releaseDir);
  await removeIfExists(outputFile);

  runCommand(pnpmCommand, buildChromiumPackArgs({ sourceDir, keyFile, outputFile }), `CRX packaging for ${browser}`);
  return outputFile;
}

async function packageFirefox(version) {
  const sourceDir = getSourceDir(repoRoot, 'firefox');
  const outputFile = buildArtifactPath(releaseDir, version, 'firefox');
  const artifactsDir = path.join(releaseDir, '.firefox-artifacts');
  const apiKey = process.env.AMO_JWT_ISSUER;
  const apiSecret = process.env.AMO_JWT_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      'AMO_JWT_ISSUER and AMO_JWT_SECRET are required for Firefox signing. web-ext sign must produce a signed XPI before the file can be installed from Firefox.',
    );
  }

  await ensureDirectory(releaseDir);
  await removeIfExists(outputFile);
  await removeIfExists(artifactsDir);
  await ensureDirectory(artifactsDir);

  runCommand(
    pnpmCommand,
    buildFirefoxSignArgs({
      sourceDir,
      artifactsDir,
      apiKey,
      apiSecret,
    }),
    'Firefox signing',
  );

  const signedXpi = await findNewestFile(artifactsDir, '.xpi');
  if (!signedXpi) {
    throw new Error(`Firefox signing finished, but no .xpi file was created in ${artifactsDir}`);
  }

  await fs.rename(signedXpi, outputFile);
  await removeIfExists(artifactsDir);
  return outputFile;
}

async function main() {
  const browser = getBrowserFromArgs();
  const version = await readPackageVersion();
  const sourceDir = getSourceDir(repoRoot, browser);

  try {
    await fs.access(sourceDir);
  } catch {
    throw new Error(`Build output missing: ${sourceDir}. Run the matching pnpm build command first.`);
  }

  const outputFile =
    browser === 'firefox' ? await packageFirefox(version) : await packageChromium(browser, version);

  console.log(`[TurboRender] wrote ${outputFile}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
