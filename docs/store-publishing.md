# Store Publishing

This repository has a separate GitHub Actions workflow for publishing browser-store updates after a tagged release:

- [.github/workflows/store-publish.yml](../.github/workflows/store-publish.yml)

It submits Chrome, Edge, and Firefox releases to their respective stores.

## Trigger

- Push a tag like `v0.1.1` to publish all supported browsers.
- Or run the workflow manually and choose `chrome`, `edge`, `firefox`, or `all`.

## Required secrets

### Chrome Web Store

Store these in GitHub Secrets:

- `CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON`
  - The full Google Cloud service account JSON key.
  - Store the raw JSON document, including `client_email`, `private_key`, and `token_uri`.
- `CHROME_WEB_STORE_PUBLISHER_ID`
  - The Chrome Web Store publisher ID from the developer dashboard.
- `CHROME_WEB_STORE_ITEM_ID`
  - The extension item ID in the Chrome Web Store dashboard.

One-time setup:

- Enable the Chrome Web Store API in Google Cloud.
- Create a Google Cloud service account and link the service account email to the Chrome Web Store developer dashboard.
- Keep 2-step verification enabled on the Google account that owns the Web Store item, per Chrome's requirements.

### Microsoft Edge Add-ons

Store these in GitHub Secrets:

- `EDGE_ADDONS_API_KEY`
  - The API key from Partner Center's Publish API page.
- `EDGE_ADDONS_CLIENT_ID`
  - The Client ID from Partner Center.
- `EDGE_ADDONS_PRODUCT_ID`
  - The product ID of the Edge extension.
  - This is not secret, but the workflow needs it to address the upload and publish endpoints.

One-time setup:

- In Partner Center, enable the new Publish API experience.
- Create API credentials and save the Client ID and API key.
- The first-ever listing still needs to be created in Partner Center before the API can update it.

### Firefox Add-ons

Store these in GitHub Secrets:

- `AMO_JWT_ISSUER`
  - The AMO JWT issuer from the Firefox Add-ons developer credentials page.
- `AMO_JWT_SECRET`
  - The AMO JWT secret from the same credentials page.

One-time setup:

- Add `browser_specific_settings.gecko.id` to the Firefox manifest.
- Keep `store/firefox-amo-metadata.json` up to date for the first listed submission.

## Release artifacts

The store workflow does not publish GitHub Release assets. It submits each browser directly to its store:

- Chrome: ZIP package built by `wxt zip -b chrome`
- Edge: ZIP package built by `wxt zip -b edge`
- Firefox: signed submission created by `web-ext sign --channel=listed`

If you only want user-downloadable files, use [docs/browser-packages.md](./browser-packages.md) instead.
