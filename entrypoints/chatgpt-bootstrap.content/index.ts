import { defineContentScript } from 'wxt/utils/define-content-script';
import { installConversationBootstrap } from '../../lib/main-world/conversation-bootstrap';

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installConversationBootstrap(window, document);
  },
});
