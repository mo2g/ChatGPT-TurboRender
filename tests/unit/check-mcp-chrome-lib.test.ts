import { describe, expect, it } from 'vitest';

import {
  collectChatgptPages,
  createLivePerformanceSample,
  formatLivePerformanceSample,
  hasArchiveAccess,
  hasTurboRenderInjection,
  selectExactChatgptPage,
  selectExactChatgptExtensionTab,
  validateLivePerformanceSample,
} from '../../scripts/check-mcp-chrome-lib.mjs';

type MockPage = {
  url: () => string;
};

function mockPage(url: string): MockPage {
  return {
    url: () => url,
  };
}

describe('controlled Chrome ChatGPT page selection', () => {
  it('collects only ChatGPT host tabs', () => {
    const pages = [
      mockPage('https://chatgpt.com/c/target'),
      mockPage('https://chat.openai.com/share/demo'),
      mockPage('https://example.com/'),
    ];

    expect(collectChatgptPages(pages).map((page) => page.url())).toEqual([
      'https://chatgpt.com/c/target',
      'https://chat.openai.com/share/demo',
    ]);
  });

  it('selects the exact target tab even when query strings or hashes are present', () => {
    const targetUrl = 'https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1';
    const exactUrl = `${targetUrl}?utm_source=devtools#turn-12`;

    const result = selectExactChatgptPage(
      [
        mockPage('https://chatgpt.com/c/other-thread'),
        mockPage(exactUrl),
        mockPage('https://chatgpt.com/'),
      ],
      targetUrl,
    );

    expect(result.chatgptPages.map((page) => page.url())).toEqual([
      'https://chatgpt.com/c/other-thread',
      exactUrl,
      'https://chatgpt.com/',
    ]);
    expect(result.exactPages.map((page) => page.url())).toEqual([exactUrl]);
    expect(result.matchedPage?.url()).toBe(exactUrl);
  });

  it('does not fall back to an unrelated ChatGPT tab when the exact target is absent', () => {
    const result = selectExactChatgptPage(
      [
        mockPage('https://chatgpt.com/c/other-thread'),
        mockPage('https://chatgpt.com/'),
        mockPage('https://example.com/'),
      ],
      'https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1',
    );

    expect(result.chatgptPages.map((page) => page.url())).toEqual([
      'https://chatgpt.com/c/other-thread',
      'https://chatgpt.com/',
    ]);
    expect(result.exactPages).toEqual([]);
    expect(result.matchedPage).toBeNull();
  });

  it('selects the exact target extension tab without falling back', () => {
    const targetUrl = 'https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1';
    const tabs = [
      { id: 1, url: 'https://chatgpt.com/c/other-thread' },
      { id: 2, url: `${targetUrl}?model=gpt-5` },
      { id: 3, url: 'https://example.com/' },
    ];

    expect(selectExactChatgptExtensionTab(tabs, targetUrl)).toEqual(tabs[1]);
    expect(selectExactChatgptExtensionTab([{ id: 1, url: 'https://chatgpt.com/' }], targetUrl)).toBeNull();
  });

  it('treats archive batches as ready even when the boundary bar is not visible', () => {
    expect(
      hasArchiveAccess({
        visibleInlineHistoryRoots: 0,
        visibleBoundaryRoots: 0,
        batchAnchors: 60,
        boundaryButtons: 0,
      }),
    ).toBe(true);

    expect(
      hasArchiveAccess({
        visibleInlineHistoryRoots: 0,
        visibleBoundaryRoots: 1,
        batchAnchors: 0,
        boundaryButtons: 0,
      }),
    ).toBe(true);

    expect(
      hasArchiveAccess({
        visibleInlineHistoryRoots: 1,
        visibleBoundaryRoots: 0,
        batchAnchors: 0,
        boundaryButtons: 5,
      }),
    ).toBe(true);

    expect(
      hasArchiveAccess({
        visibleInlineHistoryRoots: 0,
        visibleBoundaryRoots: 0,
        batchAnchors: 0,
        boundaryButtons: 5,
      }),
    ).toBe(false);

    expect(
      hasArchiveAccess({
        visibleInlineHistoryRoots: 0,
        visibleBoundaryRoots: 0,
        batchAnchors: 0,
        boundaryButtons: 0,
      }),
    ).toBe(false);
  });

  it('treats any inline-history or boundary marker as TurboRender injection', () => {
    expect(
      hasTurboRenderInjection({
        inlineHistoryRoots: 0,
        uiRoots: 0,
        boundaryRoots: 0,
        boundaryButtons: 1,
        batchAnchors: 0,
        groups: 0,
        toggleActions: 0,
      }),
    ).toBe(true);

    expect(
      hasTurboRenderInjection({
        inlineHistoryRoots: 0,
        uiRoots: 0,
        boundaryRoots: 0,
        boundaryButtons: 0,
        batchAnchors: 0,
        groups: 0,
        toggleActions: 0,
      }),
    ).toBe(false);
  });

  it('normalizes and validates live performance samples', () => {
    const sample = createLivePerformanceSample('check', {
      archivePageCount: 5,
      currentArchivePageIndex: null,
      liveDescendantCount: 120,
      spikeCount: 1,
      parkedGroups: 4,
      residentParkedGroups: 2,
      serializedParkedGroups: 2,
    });

    expect(sample).toEqual({
      phase: 'check',
      archivePageCount: 5,
      currentArchivePageIndex: null,
      liveDescendantCount: 120,
      spikeCount: 1,
      parkedGroups: 4,
      residentParkedGroups: 2,
      serializedParkedGroups: 2,
    });
    expect(validateLivePerformanceSample(sample)).toEqual([]);
    expect(formatLivePerformanceSample(sample)).toContain('current-page=recent');
  });

  it('rejects live performance samples with invalid metrics or parking splits', () => {
    expect(validateLivePerformanceSample(null)).toEqual(['runtime status is unavailable']);

    const invalid = createLivePerformanceSample('check', {
      archivePageCount: 2,
      currentArchivePageIndex: -1,
      liveDescendantCount: Number.NaN,
      spikeCount: 0,
      parkedGroups: 3,
      residentParkedGroups: 2,
      serializedParkedGroups: 0,
    });

    expect(validateLivePerformanceSample(invalid)).toEqual([
      'liveDescendantCount must be a finite non-negative number',
      'currentArchivePageIndex must be null or a finite non-negative number',
    ]);

    const mismatched = createLivePerformanceSample('check', {
      archivePageCount: 2,
      currentArchivePageIndex: 1,
      liveDescendantCount: 100,
      spikeCount: 0,
      parkedGroups: 3,
      residentParkedGroups: 1,
      serializedParkedGroups: 1,
    });

    expect(validateLivePerformanceSample(mismatched)).toEqual([
      'residentParkedGroups + serializedParkedGroups must equal parkedGroups',
    ]);
  });
});
