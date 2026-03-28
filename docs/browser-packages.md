# Browser Release Packages

This repository uses [.github/workflows/browser-packages.yml](../.github/workflows/browser-packages.yml) to build browser-native installable packages and publish them to GitHub Releases.

## How it runs

- Push a tag like `v0.1.1` to trigger the workflow.
- The pipeline installs dependencies, runs unit tests once, then builds one package per browser.
- Chrome and Edge are packed as `.crx` files using a stable Chromium signing key.
- Firefox is signed with `web-ext sign --channel=unlisted` and published as a `.xpi` file.
- The workflow publishes the release files to a GitHub Release that matches the tag.

## Browser outputs

The GitHub Release will include these assets:

- `chatgpt-turborender-<version>-chrome.crx`
- `chatgpt-turborender-<version>-edge.crx`
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

- `CHROMIUM_CRX_PRIVATE_KEY_PEM`: a stable PEM key shared by Chrome and Edge packaging so the extension ID stays constant across releases.
- `AMO_JWT_ISSUER`: the JWT issuer from addons.mozilla.org for Firefox signing.
- `AMO_JWT_SECRET`: the JWT secret from addons.mozilla.org for Firefox signing.

You can generate the Chromium key once with `pnpm exec crx keygen /tmp/chatgpt-turborender-key`, then copy the resulting `key.pem` into the GitHub secret.

Firefox packaging also requires the manifest to include `browser_specific_settings.gecko.id`, which is configured in [wxt.config.ts](../wxt.config.ts).

## Download flow

1. Open the latest GitHub Release for the tagged version.
2. Download the package for the browser you need.
3. Install the file directly in the browser.

## Manual install

- Chrome: open `chrome://extensions`, enable developer mode, then drag the `.crx` file onto the page and confirm the install prompt.
- Edge: open `edge://extensions`, enable developer mode, then drag the `.crx` file onto the page and confirm the install prompt.
- Firefox: open `about:addons`, click the gear icon, choose `Install Add-on From File...`, then select the signed `.xpi` file.

These are the direct-install files users can download from GitHub Releases. Store publishing is documented separately in [docs/store-publishing.md](./store-publishing.md) and uses the browser store APIs instead of these release assets.
