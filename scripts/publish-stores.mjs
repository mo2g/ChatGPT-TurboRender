#!/usr/bin/env node

import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildStoreZipPath,
  getSourceDir,
} from './package-browser-release-lib.mjs';

const DEFAULT_TARGET = 'all';
const DEFAULT_CHROME_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const CHROME_STATUS_POLL_INTERVAL_MS = 2000;
const CHROME_STATUS_POLL_TIMEOUT_MS = 120_000;
const EDGE_STATUS_POLL_INTERVAL_MS = 2000;
const EDGE_STATUS_POLL_TIMEOUT_MS = 120_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function printHelp() {
  console.log(`ChatGPT TurboRender browser store publisher

Usage:
  pnpm release:publish-stores -- --target <chrome|edge|firefox|all> --version <version> [options]

Options:
  --target                 Store target to publish to. Defaults to "all".
  --version                Release version without the leading "v".
  --chrome-zip             Path to the Chrome ZIP package.
  --edge-zip               Path to the Edge ZIP package.
  --firefox-source-dir     Path to the built Firefox source directory.
  --firefox-amo-metadata   Path to the AMO metadata JSON file for Firefox.
  --firefox-artifacts-dir  Directory where web-ext should write signed Firefox artifacts.
  -h, --help               Show this help message.

Required environment variables for Chrome:
  CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON
  CHROME_WEB_STORE_PUBLISHER_ID
  CHROME_WEB_STORE_ITEM_ID

Required environment variables for Edge:
  EDGE_ADDONS_API_KEY
  EDGE_ADDONS_CLIENT_ID
  EDGE_ADDONS_PRODUCT_ID

Required environment variables for Firefox:
  AMO_JWT_ISSUER
  AMO_JWT_SECRET
`);
}

export function parseArgs(argv) {
  const result = {
    target: DEFAULT_TARGET,
    version: '',
    chromeZip: '',
    edgeZip: '',
    firefoxSourceDir: '',
    firefoxAmoMetadata: '',
    firefoxArtifactsDir: '',
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--target') {
      result.target = argv[++index] ?? '';
      continue;
    }

    if (arg === '--version') {
      result.version = argv[++index] ?? '';
      continue;
    }

    if (arg === '--chrome-zip') {
      result.chromeZip = argv[++index] ?? '';
      continue;
    }

    if (arg === '--edge-zip') {
      result.edgeZip = argv[++index] ?? '';
      continue;
    }

    if (arg === '--firefox-source-dir') {
      result.firefoxSourceDir = argv[++index] ?? '';
      continue;
    }

    if (arg === '--firefox-amo-metadata') {
      result.firefoxAmoMetadata = argv[++index] ?? '';
      continue;
    }

    if (arg === '--firefox-artifacts-dir') {
      result.firefoxArtifactsDir = argv[++index] ?? '';
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

export function normalizeTarget(value) {
  if (value === 'chrome' || value === 'edge' || value === 'firefox' || value === 'all') {
    return value;
  }

  if (value === 'both') {
    return 'all';
  }

  throw new Error(`Invalid target: ${value}`);
}

export function extractOperationId(location) {
  if (typeof location !== 'string' || location.trim().length === 0) {
    throw new Error('Missing operation location header.');
  }

  const normalized = location.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  const operationId = parts[parts.length - 1];

  if (!operationId) {
    throw new Error(`Unable to extract operation ID from location header: ${location}`);
  }

  return operationId;
}

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signJwt(privateKey, payload) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const signature = signer.sign(privateKey);

  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`;
}

async function assertFileExists(filePath, label) {
  try {
    await stat(filePath);
  } catch {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
}

async function parseJsonResponse(response, label) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${label} failed (${response.status} ${response.statusText}): ${text || '<empty response>'}`);
  }

  if (text.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${text}`, { cause: error });
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const fileStat = await stat(filePath);
        return { filePath, mtimeMs: fileStat.mtimeMs };
      }),
  );

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.filePath ?? null;
}

async function getGoogleAccessToken() {
  const serviceAccountJson = requireEnv('CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON');
  const scope = process.env.CHROME_WEB_STORE_SCOPE ?? DEFAULT_CHROME_SCOPE;
  const serviceAccount = JSON.parse(serviceAccountJson);
  const clientEmail = serviceAccount.client_email;
  const privateKey = serviceAccount.private_key;
  const tokenUri = serviceAccount.token_uri ?? 'https://oauth2.googleapis.com/token';

  if (typeof clientEmail !== 'string' || clientEmail.length === 0) {
    throw new Error('Chrome service account JSON is missing client_email.');
  }

  if (typeof privateKey !== 'string' || privateKey.length === 0) {
    throw new Error('Chrome service account JSON is missing private_key.');
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(privateKey, {
    iss: clientEmail,
    scope,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  });

  const tokenResponse = await fetch(tokenUri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const tokenPayload = await parseJsonResponse(tokenResponse, 'Chrome OAuth token exchange');
  if (tokenPayload == null || typeof tokenPayload.access_token !== 'string' || tokenPayload.access_token.length === 0) {
    throw new Error(`Chrome OAuth token exchange did not return an access token: ${JSON.stringify(tokenPayload)}`);
  }

  return tokenPayload.access_token;
}

async function waitForChromeUpload(accessToken, publisherId, itemId) {
  const statusUrl = `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${itemId}:fetchStatus`;
  const deadline = Date.now() + CHROME_STATUS_POLL_TIMEOUT_MS;
  let lastState = null;

  while (Date.now() < deadline) {
    const statusResponse = await fetch(statusUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const statusPayload = await parseJsonResponse(statusResponse, 'Chrome upload status');
    lastState = statusPayload?.lastAsyncUploadState ?? null;
    console.log(`Chrome upload status: ${lastState ?? 'unknown'}`);

    if (lastState !== 'IN_PROGRESS') {
      if (lastState !== 'SUCCEEDED') {
        throw new Error(`Chrome upload did not succeed. Last state: ${lastState ?? 'unknown'}`);
      }

      return statusPayload;
    }

    await sleep(CHROME_STATUS_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for Chrome upload to finish. Last state: ${lastState ?? 'unknown'}`);
}

async function publishChrome({ zipPath, version }) {
  const publisherId = requireEnv('CHROME_WEB_STORE_PUBLISHER_ID');
  const itemId = requireEnv('CHROME_WEB_STORE_ITEM_ID');
  const accessToken = await getGoogleAccessToken();
  const zip = await readFile(zipPath);
  const uploadUrl = `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${itemId}:upload`;

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/zip',
    },
    body: zip,
  });

  const uploadPayload = await parseJsonResponse(uploadResponse, 'Chrome upload');
  console.log(`Chrome upload accepted: ${JSON.stringify(uploadPayload)}`);

  const uploadState = uploadPayload?.uploadState;
  if (typeof uploadState !== 'string') {
    throw new Error(`Chrome upload did not return a valid uploadState: ${JSON.stringify(uploadPayload)}`);
  }

  if (uploadState !== 'SUCCEEDED' && uploadState !== 'IN_PROGRESS') {
    throw new Error(`Chrome upload did not succeed. uploadState=${uploadState}`);
  }

  if (uploadState === 'IN_PROGRESS') {
    await waitForChromeUpload(accessToken, publisherId, itemId);
  }

  const publishResponse = await fetch(
    `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${itemId}:publish`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        publishType: 'DEFAULT_PUBLISH',
        skipReview: false,
      }),
    },
  );

  const publishPayload = await parseJsonResponse(publishResponse, 'Chrome publish');
  console.log(`Chrome publish accepted for version ${version}: ${JSON.stringify(publishPayload)}`);
}

async function waitForEdgeOperation({ authHeaders, productId, operationId, operationKind }) {
  const statusUrl =
    operationKind === 'upload'
      ? `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions/draft/package/operations/${operationId}`
      : `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions/operations/${operationId}`;

  const deadline = Date.now() + EDGE_STATUS_POLL_TIMEOUT_MS;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const statusResponse = await fetch(statusUrl, {
      headers: authHeaders,
    });

    const statusPayload = await parseJsonResponse(statusResponse, `Edge ${operationKind} status`);
    lastStatus = statusPayload?.status ?? null;
    console.log(`Edge ${operationKind} status: ${lastStatus ?? 'unknown'}`);

    if (lastStatus === 'InProgress') {
      await sleep(EDGE_STATUS_POLL_INTERVAL_MS);
      continue;
    }

    if (lastStatus !== 'Succeeded') {
      throw new Error(
        `Edge ${operationKind} did not succeed. Last status: ${lastStatus ?? 'unknown'}; details: ${JSON.stringify(statusPayload)}`,
      );
    }

    return statusPayload;
  }

  throw new Error(`Timed out waiting for Edge ${operationKind} to finish. Last status: ${lastStatus ?? 'unknown'}`);
}

async function publishEdge({ zipPath, version }) {
  const apiKey = requireEnv('EDGE_ADDONS_API_KEY');
  const clientId = requireEnv('EDGE_ADDONS_CLIENT_ID');
  const productId = requireEnv('EDGE_ADDONS_PRODUCT_ID');
  const zip = await readFile(zipPath);
  const authHeaders = {
    Authorization: `ApiKey ${apiKey}`,
    'X-ClientID': clientId,
  };

  const uploadResponse = await fetch(
    `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions/draft/package`,
    {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/zip',
      },
      body: zip,
    },
  );

  const uploadText = await uploadResponse.text();
  if (!uploadResponse.ok && uploadResponse.status !== 202) {
    throw new Error(`Edge upload failed (${uploadResponse.status} ${uploadResponse.statusText}): ${uploadText || '<empty response>'}`);
  }

  const uploadOperationId = extractOperationId(uploadResponse.headers.get('location'));
  console.log(`Edge upload accepted: ${uploadOperationId}`);

  if (uploadText.trim().length > 0) {
    console.log(`Edge upload response: ${uploadText}`);
  }

  await waitForEdgeOperation({
    authHeaders,
    productId,
    operationId: uploadOperationId,
    operationKind: 'upload',
  });

  const publishResponse = await fetch(
    `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions`,
    {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        notes: `Automated release ${version}`,
      }),
    },
  );

  const publishText = await publishResponse.text();
  if (!publishResponse.ok && publishResponse.status !== 202) {
    throw new Error(`Edge publish failed (${publishResponse.status} ${publishResponse.statusText}): ${publishText || '<empty response>'}`);
  }

  const publishOperationId = extractOperationId(publishResponse.headers.get('location'));
  console.log(`Edge publish accepted: ${publishOperationId}`);

  if (publishText.trim().length > 0) {
    console.log(`Edge publish response: ${publishText}`);
  }

  await waitForEdgeOperation({
    authHeaders,
    productId,
    operationId: publishOperationId,
    operationKind: 'publish',
  });
}

async function publishFirefox({ sourceDir, metadataFile, artifactsDir, version }) {
  const apiKey = requireEnv('AMO_JWT_ISSUER');
  const apiSecret = requireEnv('AMO_JWT_SECRET');

  await assertFileExists(sourceDir, 'Firefox build output');
  await assertFileExists(metadataFile, 'Firefox AMO metadata');

  await rm(artifactsDir, { force: true, recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  runCommand(
    pnpmCommand,
    [
      'exec',
      'web-ext',
      'sign',
      '--channel=listed',
      `--source-dir=${sourceDir}`,
      `--artifacts-dir=${artifactsDir}`,
      `--api-key=${apiKey}`,
      `--api-secret=${apiSecret}`,
      `--amo-metadata=${metadataFile}`,
      '--approval-timeout=0',
    ],
    'Firefox AMO publish',
  );

  const signedXpi = await findNewestFile(artifactsDir, '.xpi');
  if (!signedXpi) {
    throw new Error(`Firefox signing finished, but no .xpi file was created in ${artifactsDir}`);
  }

  console.log(`Firefox publish accepted for version ${version}: ${signedXpi}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const target = normalizeTarget(args.target);
  const version = (args.version || process.env.RELEASE_VERSION || '').replace(/^v/, '');

  if (version.length === 0) {
    throw new Error('Missing release version. Pass --version or set RELEASE_VERSION.');
  }

  const selectedTargets =
    target === 'all' ? ['chrome', 'edge', 'firefox'] : [target];

  if (selectedTargets.includes('chrome')) {
    const chromeZip = args.chromeZip || buildStoreZipPath(path.join(repoRoot, '.output'), version, 'chrome');
    await assertFileExists(chromeZip, 'Chrome ZIP');
    await publishChrome({ zipPath: chromeZip, version });
  }

  if (selectedTargets.includes('edge')) {
    const edgeZip = args.edgeZip || buildStoreZipPath(path.join(repoRoot, '.output'), version, 'edge');
    await assertFileExists(edgeZip, 'Edge ZIP');
    await publishEdge({ zipPath: edgeZip, version });
  }

  if (selectedTargets.includes('firefox')) {
    const sourceDir = args.firefoxSourceDir || getSourceDir(repoRoot, 'firefox');
    const metadataFile =
      args.firefoxAmoMetadata || path.join(repoRoot, 'store', 'firefox-amo-metadata.json');
    const artifactsDir = args.firefoxArtifactsDir || path.join(repoRoot, '.store', 'firefox-artifacts');

    await publishFirefox({
      sourceDir,
      metadataFile,
      artifactsDir,
      version,
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
