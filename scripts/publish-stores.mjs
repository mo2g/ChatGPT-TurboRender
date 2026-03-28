#!/usr/bin/env node

import crypto from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_CHROME_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const DEFAULT_TARGET = 'both';
const EDGE_STATUS_POLL_INTERVAL_MS = 2000;
const EDGE_STATUS_POLL_TIMEOUT_MS = 120_000;
const CHROME_STATUS_POLL_INTERVAL_MS = 2000;
const CHROME_STATUS_POLL_TIMEOUT_MS = 120_000;

function printHelp() {
  console.log(`Usage:
  pnpm release:publish -- --target <chrome|edge|both> --version <version> [options]

Options:
  --target        Store target to publish to. Defaults to "both".
  --version       Release version without the leading "v".
  --chrome-zip    Path to the Chrome zip artifact.
  --edge-zip      Path to the Edge zip artifact.
  -h, --help      Show this help message.

Required environment variables for Chrome:
  CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON
  CHROME_WEB_STORE_PUBLISHER_ID
  CHROME_WEB_STORE_ITEM_ID

Required environment variables for Edge:
  EDGE_ADDONS_API_KEY
  EDGE_ADDONS_CLIENT_ID
  EDGE_ADDONS_PRODUCT_ID
`);
}

export function parseArgs(argv) {
  const result = {
    target: DEFAULT_TARGET,
    version: '',
    chromeZip: '',
    edgeZip: '',
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

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

export function normalizeTarget(value) {
  if (value === 'chrome' || value === 'edge' || value === 'both') {
    return value;
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
  const uploadUrl = `https://chromewebstore.googleapis.com/upload/v2/publishers/${publisherId}/items/${itemId}:upload`;

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
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: `Automated release ${version}`,
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

async function main() {
  const args = parseArgs(process.argv);
  const target = normalizeTarget(args.target);
  const version = (args.version || process.env.RELEASE_VERSION || '').replace(/^v/, '');

  if (version.length === 0) {
    throw new Error('Missing release version. Pass --version or set RELEASE_VERSION.');
  }

  const chromeZip = args.chromeZip || `.output/chatgpt-turborender-${version}-chrome.zip`;
  const edgeZip = args.edgeZip || `.output/chatgpt-turborender-${version}-edge.zip`;

  const selectedTargets =
    target === 'both' ? ['chrome', 'edge'] : [target];

  if (selectedTargets.includes('chrome')) {
    await assertFileExists(chromeZip, 'Chrome zip');
    await publishChrome({ zipPath: chromeZip, version });
  }

  if (selectedTargets.includes('edge')) {
    await assertFileExists(edgeZip, 'Edge zip');
    await publishEdge({ zipPath: edgeZip, version });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
