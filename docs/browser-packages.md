# Browser Release Packages

This repository uses [.github/workflows/browser-packages.yml](../.github/workflows/browser-packages.yml) to build release archives for GitHub Releases.

## How it runs

- Push a tag like `v0.1.1` to trigger the workflow.
- The pipeline installs dependencies, runs unit tests once, then builds one package per browser.
- Chrome and Edge are packaged as `.zip` archives from the built extension output.
- Firefox downloads the signed `.xpi` from AMO after the store workflow submits the version, then publishes it as a release asset.
- If AMO has not exposed the signed file URL yet, the packaging step keeps polling until it can download the file or times out.
- The workflow publishes the release files to a GitHub Release that matches the tag.

## Browser outputs

The GitHub Release will include these assets:

- `chatgpt-turborender-<version>-chrome.zip`
- `chatgpt-turborender-<version>-edge.zip`
- `chatgpt-turborender-<version>-firefox.xpi`

Each package is built from the corresponding WXT output directory:

- `.output/chrome-mv3`
- `.output/edge-mv3`
- `.output/firefox-mv2`

## Local builds

You can generate the same release-ready browser packages locally with:

```bash
pnpm package:chrome
pnpm package:edge
pnpm package:firefox
```

## Maintainer setup

The release workflow expects these GitHub secrets:

- `AMO_JWT_ISSUER`: the JWT issuer from addons.mozilla.org for Firefox AMO access.
- `AMO_JWT_SECRET`: the JWT secret from addons.mozilla.org for Firefox AMO access.

Firefox packaging also requires the manifest to include `browser_specific_settings.gecko.id`, which is configured in [wxt.config.ts](../wxt.config.ts).
The Firefox store workflow is the only step that submits the version to AMO; this workflow only consumes the AMO-signed file.

The custom GitHub Release intro copy lives in [.github/release-body.md](../.github/release-body.md).

## Download flow

1. Open the latest GitHub Release for the tagged version.
2. Download the package for the browser you need.
3. Unzip the Chrome or Edge archive, then load the extracted folder as an unpacked extension.
4. Install the signed Firefox `.xpi` file directly from `about:addons`.

## Manual install

- Chrome: unzip the downloaded archive, open `chrome://extensions`, enable developer mode, click `Load unpacked`, and select the extracted folder.
- Edge: unzip the downloaded archive, open `edge://extensions`, enable developer mode, click `Load unpacked`, and select the extracted folder.
- Firefox: open `about:addons`, click the gear icon, choose `Install Add-on From File...`, then select the signed `.xpi` file.

These are release archives users can download from GitHub Releases. Chrome desktop does not support direct installation of GitHub Release archives, so unpacked loading is the supported manual path. Store publishing is documented separately in [docs/store-publishing.md](./store-publishing.md) and uses the browser store APIs instead of these release assets.
