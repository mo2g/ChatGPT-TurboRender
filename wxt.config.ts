import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'ChatGPT TurboRender',
    short_name: 'TurboRender',
    description:
      'Keep long ChatGPT conversations responsive by parking cold history blocks and restoring them on demand.',
    permissions: ['storage'],
    host_permissions: ['https://chatgpt.com/*'],
    action: {
      default_title: 'ChatGPT TurboRender',
    },
  },
});
