#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertSupportedBrowser,
  buildArtifactPath,
  buildFirefoxSignArgs,
  getSourceDir,
} from './package-browser-release-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const releaseDir = path.join(repoRoot, 'release');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const AMO_API_BASE_URL = 'https://addons.mozilla.org/api/v5/';
const DEFAULT_EXISTING_FIREFOX_ARTIFACT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_EXISTING_FIREFOX_ARTIFACT_POLL_MS = 2_000;
const FIREFOX_SIGNED_ARTIFACT_NAME = 'firefox-signed.xpi';

function printHelp() {
  console.log(`ChatGPT TurboRender browser package builder

Usage:
  pnpm package:chrome
  pnpm package:edge
  pnpm package:firefox

Environment:
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

function writeCommandOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function runCommand(command, args, description, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
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

function runCommandCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  return result;
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

function base64UrlEncode(text) {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function buildFirefoxAmoAuthHeader(apiKey, apiSecret) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({ iss: apiKey, iat: now, exp: now + 300 }));
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `JWT ${header}.${payload}.${signature}`;
}

export function isFirefoxVersionAlreadyExistsError(output) {
  if (typeof output !== 'string' || output.trim().length === 0) {
    return false;
  }

  return /already exists/i.test(output) && /(web-ext|WebExtError|Submission failed)/i.test(output);
}

export function readFirefoxAddonId(manifest, manifestPath = 'manifest.json') {
  const addonId =
    manifest?.browser_specific_settings?.gecko?.id ?? manifest?.applications?.gecko?.id;

  if (typeof addonId !== 'string' || addonId.length === 0) {
    throw new Error(`Firefox manifest ${manifestPath} is missing browser_specific_settings.gecko.id.`);
  }

  return addonId;
}

export function buildFirefoxAmoVersionDetailUrl(addonId, version) {
  return new URL(
    `addons/addon/${encodeURIComponent(addonId)}/versions/${encodeURIComponent(`v${version}`)}/`,
    AMO_API_BASE_URL,
  );
}

async function loadFirefoxAddonId(sourceDir) {
  const manifestPath = path.join(sourceDir, 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  let manifest;

  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse Firefox manifest ${manifestPath}: ${reason}`);
  }

  return readFirefoxAddonId(manifest, manifestPath);
}

async function fetchFirefoxVersionDetail({
  addonId,
  version,
  apiKey,
  apiSecret,
  fetchImpl = globalThis.fetch,
}) {
  const response = await fetchImpl(buildFirefoxAmoVersionDetailUrl(addonId, version), {
    headers: {
      Authorization: buildFirefoxAmoAuthHeader(apiKey, apiSecret),
      Accept: 'application/json',
    },
  });

  if (response.status === 404) {
    return null;
  }

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Firefox AMO version lookup failed (${response.status} ${response.statusText}): ${body || '<empty response>'}`,
    );
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Firefox AMO version lookup returned invalid JSON: ${reason}`);
  }
}

function getFirefoxVersionFile(detail) {
  return detail?.file ?? detail?.files?.[0] ?? null;
}

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForFirefoxVersionFileUrl({
  addonId,
  version,
  apiKey,
  apiSecret,
  timeoutMs = DEFAULT_EXISTING_FIREFOX_ARTIFACT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_EXISTING_FIREFOX_ARTIFACT_POLL_MS,
  fetchImpl = globalThis.fetch,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastFileStatus = '<missing>';

  while (Date.now() <= deadline) {
    const detail = await fetchFirefoxVersionDetail({
      addonId,
      version,
      apiKey,
      apiSecret,
      fetchImpl,
    });

    if (detail === null) {
      await sleep(pollIntervalMs);
      continue;
    }

    const file = getFirefoxVersionFile(detail);
    lastFileStatus = file?.status ?? '<missing>';
    if (file?.status === 'public' && typeof file.url === 'string' && file.url.length > 0) {
      return file.url;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Firefox AMO version ${version} did not become downloadable before timeout. Last file status: ${lastFileStatus}`,
  );
}

async function downloadFirefoxArtifactFromUrl({
  fileUrl,
  artifactsDir,
  apiKey,
  apiSecret,
  fetchImpl = globalThis.fetch,
}) {
  await ensureDirectory(artifactsDir);

  const response = await fetchImpl(fileUrl, {
    headers: {
      Authorization: buildFirefoxAmoAuthHeader(apiKey, apiSecret),
    },
  });

  const body = response.ok ? null : await response.text();
  if (!response.ok) {
    throw new Error(
      `Firefox signed XPI download failed (${response.status} ${response.statusText}): ${body || '<empty response>'}`,
    );
  }

  const outputPath = path.join(artifactsDir, FIREFOX_SIGNED_ARTIFACT_NAME);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, bytes);
  return outputPath;
}

export async function downloadExistingFirefoxSignedArtifact({
  sourceDir,
  version,
  artifactsDir,
  apiKey,
  apiSecret,
  timeoutMs = DEFAULT_EXISTING_FIREFOX_ARTIFACT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_EXISTING_FIREFOX_ARTIFACT_POLL_MS,
  fetchImpl = globalThis.fetch,
}) {
  const addonId = await loadFirefoxAddonId(sourceDir);
  const fileUrl = await waitForFirefoxVersionFileUrl({
    addonId,
    version,
    apiKey,
    apiSecret,
    timeoutMs,
    pollIntervalMs,
    fetchImpl,
  });

  return downloadFirefoxArtifactFromUrl({
    fileUrl,
    artifactsDir,
    apiKey,
    apiSecret,
    fetchImpl,
  });
}

async function packageChromium(browser, version) {
  const sourceDir = getSourceDir(repoRoot, browser);
  const outputFile = buildArtifactPath(releaseDir, version, browser);

  await ensureDirectory(releaseDir);
  await removeIfExists(outputFile);

  runCommand('zip', ['-qr', outputFile, '.'], `ZIP packaging for ${browser}`, {
    cwd: sourceDir,
  });
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

  const signResult = runCommandCapture(
    pnpmCommand,
    buildFirefoxSignArgs({
      sourceDir,
      artifactsDir,
      apiKey,
      apiSecret,
    }),
    {
      cwd: repoRoot,
    },
  );

  const combinedOutput = `${signResult.stdout ?? ''}${signResult.stderr ?? ''}`;
  if (signResult.status !== 0) {
    if (isFirefoxVersionAlreadyExistsError(combinedOutput)) {
      console.log(`Firefox AMO already has version ${version}; reusing the existing signed XPI.`);
      const signedXpi = await downloadExistingFirefoxSignedArtifact({
        sourceDir,
        version,
        artifactsDir,
        apiKey,
        apiSecret,
      });
      await fs.rename(signedXpi, outputFile);
      await removeIfExists(artifactsDir);
      return outputFile;
    }

    writeCommandOutput(signResult);
    throw new Error(`Firefox signing failed with exit code ${signResult.status ?? 'unknown'}`);
  }

  writeCommandOutput(signResult);

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export { main, packageFirefox, packageChromium };
