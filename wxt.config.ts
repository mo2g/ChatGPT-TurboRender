import { defineConfig } from 'wxt';

const FIREFOX_GECKO_ID = 'chatgpt-turborender@mo2g.dev';

export default defineConfig({
  manifest: (env) => ({
    name: 'ChatGPT TurboRender',
    short_name: 'TurboRender',
    description:
      'Keep long ChatGPT conversations responsive by parking cold history blocks and restoring them on demand.',
    permissions: ['storage'],
    host_permissions: ['https://chatgpt.com/*'],
    action: {
      default_title: 'ChatGPT TurboRender',
    },
    ...(env.browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: FIREFOX_GECKO_ID,
            },
          },
        }
      : {}),
  }),
});
