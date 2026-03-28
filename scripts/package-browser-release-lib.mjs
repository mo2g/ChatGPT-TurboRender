import path from 'node:path';

export const PACKAGE_TARGETS = {
  chrome: {
    artifactExtension: 'crx',
    sourceDir: '.output/chrome-mv3',
  },
  edge: {
    artifactExtension: 'crx',
    sourceDir: '.output/edge-mv3',
  },
  firefox: {
    artifactExtension: 'xpi',
    sourceDir: '.output/firefox-mv2',
  },
};

export function isSupportedBrowser(browser) {
  return Object.hasOwn(PACKAGE_TARGETS, browser);
}

export function assertSupportedBrowser(browser) {
  if (!isSupportedBrowser(browser)) {
    throw new Error(`Unsupported browser "${browser}". Expected chrome, edge, or firefox.`);
  }

  return browser;
}

export function getSourceDir(repoRoot, browser) {
  return path.join(repoRoot, PACKAGE_TARGETS[assertSupportedBrowser(browser)].sourceDir);
}

export function getArtifactExtension(browser) {
  return PACKAGE_TARGETS[assertSupportedBrowser(browser)].artifactExtension;
}

export function buildArtifactFileName(version, browser) {
  return `chatgpt-turborender-${version}-${assertSupportedBrowser(browser)}.${getArtifactExtension(browser)}`;
}

export function buildArtifactPath(releaseDir, version, browser) {
  return path.join(releaseDir, buildArtifactFileName(version, browser));
}

export function buildChromiumPackArgs({ sourceDir, keyFile, outputFile }) {
  return ['exec', 'crx', 'pack', sourceDir, '-p', keyFile, '-o', outputFile];
}

export function buildFirefoxSignArgs({ sourceDir, artifactsDir, apiKey, apiSecret }) {
  return [
    'exec',
    'web-ext',
    'sign',
    '--channel=unlisted',
    `--source-dir=${sourceDir}`,
    `--artifacts-dir=${artifactsDir}`,
    `--api-key=${apiKey}`,
    `--api-secret=${apiSecret}`,
  ];
}
