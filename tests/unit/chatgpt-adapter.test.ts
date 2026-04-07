import { describe, expect, it } from 'vitest';

import { scanChatPage } from '../../lib/content/chatgpt-adapter';
import { resolveHistoryAnchor } from '../../lib/content/history-anchor';
import { mountGroupedTranscriptFixture } from '../../lib/testing/transcript-fixture';

describe('chatgpt adapter', () => {
  it('preserves a history mount target for split-parent transcripts', () => {
    const fixture = mountGroupedTranscriptFixture(document, {
      turnCount: 12,
      daySizes: [6, 6],
      streaming: false,
    });

    const snapshot = scanChatPage(document);
    expect(snapshot.supported).toBe(false);
    expect(snapshot.reason).toBe('split-parents');
    expect(snapshot.historyMountTarget).toBe(fixture.dayGroups[0]);
    expect(snapshot.scrollContainer).toBe(fixture.scroller);
  });

  it('anchors to the host share button when an action bar exists', () => {
    const fixture = mountGroupedTranscriptFixture(document, {
      turnCount: 8,
      daySizes: [4, 4],
      streaming: false,
    });

    const anchor = resolveHistoryAnchor(document);
    expect(anchor.mode).toBe('host-share');
    expect(anchor.shareButton).toBe(fixture.shareButton);
    expect(anchor.actionBar).toBe(fixture.headerActions);
  });

  it('falls back to safe-top when no host action bar is available', () => {
    document.body.innerHTML = '<main><section><p>No toolbar here.</p></section></main>';

    const anchor = resolveHistoryAnchor(document);
    expect(anchor.mode).toBe('safe-top');
    expect(anchor.shareButton).toBeNull();
  });

  it('ignores TurboRender UI roots when scanning for turns', () => {
    document.body.innerHTML = `
      <main>
        <section data-turbo-render-ui-root="true">
          <article data-testid="conversation-turn-0" data-message-author-role="user">
            <p>Should not be scanned as a turn.</p>
          </article>
        </section>
      </main>
    `;

    const snapshot = scanChatPage(document);
    expect(snapshot.supported).toBe(false);
    expect(snapshot.reason).toBe('no-turns');
    expect(snapshot.turnNodes).toHaveLength(0);
  });
});
