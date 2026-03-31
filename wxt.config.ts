import { defineConfig } from 'wxt';

const FIREFOX_GECKO_ID = 'chatgpt-turborender@mo2g.dev';
const ICON_PATH = '/favicon.png';
const ICON_128_PATH = '/favicon_128x128.png';

export default defineConfig({
  manifest: (env) => ({
    name: 'ChatGPT TurboRender',
    short_name: 'TurboRender',
    description:
      'Keep long ChatGPT conversations responsive by parking cold history blocks and restoring them on demand.',
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    icons: {
      16: ICON_PATH,
      32: ICON_PATH,
      48: ICON_PATH,
      128: ICON_128_PATH,
    },
    action: {
      default_title: 'ChatGPT TurboRender',
      default_icon: {
        16: ICON_PATH,
        32: ICON_PATH,
        48: ICON_PATH,
        128: ICON_128_PATH,
      },
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
