import { installConversationBootstrap } from '../../lib/main-world/conversation-bootstrap';

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installConversationBootstrap(window, document);
  },
});
