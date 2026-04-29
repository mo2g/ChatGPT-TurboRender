import { describe, expect, it } from 'vitest';

import { normalizeSettings } from '../../lib/shared/settings';
import type { Settings } from '../../lib/shared/types';
import {
  buildSlidingWindowPairIndex,
  buildSlidingWindowSearchIndex,
  createSlidingWindowSignature,
  getCenteredWindowRange,
  getFirstWindowRange,
  getLatestWindowRange,
  getNewerWindowRange,
  getOlderWindowRange,
  getWindowPageCount,
  getWindowPageForRange,
  getWindowPageRange,
  getWindowPairCount,
  isLatestWindow,
  resolveSlidingWindowActiveChain,
  searchSlidingWindowPairs,
  serializeSlidingWindowSignature,
  sliceConversationToWindow,
  validateConversationPayload,
  validateSyntheticPayload,
} from '../../lib/shared/sliding-window';
import {
  buildBasicSlidingWindowPayload,
  buildBranchSlidingWindowPayload,
  buildHiddenSlidingWindowPayload,
  buildInvalidSlidingWindowPayload,
  buildShortSlidingWindowPayload,
  buildToolSlidingWindowPayload,
} from '../fixtures/sliding-window';

function expectValidSyntheticPayload(payload: unknown): void {
  const validation = validateSyntheticPayload(payload);
  expect(validation).toEqual({ ok: true, issues: [] });
}

function expectMappingKeys(payload: unknown, keys: string[]): void {
  expect(Object.keys((payload as { mapping: Record<string, unknown> }).mapping)).toEqual(keys);
}

describe('sliding-window settings', () => {
  it('normalizes the sliding-window mode and clamps window size', () => {
    expect(
      normalizeSettings({
        mode: 'sliding-window',
        slidingWindowPairs: 99,
      }),
    ).toMatchObject({
      mode: 'sliding-window',
      slidingWindowPairs: 50,
    });

    expect(normalizeSettings({ slidingWindowPairs: 0 }).slidingWindowPairs).toBe(1);
    expect(normalizeSettings({ mode: 'sliding-window-inplace' }).mode).toBe('sliding-window-inplace');
    expect(normalizeSettings({ mode: 'reader' } as unknown as Partial<Settings>).mode).toBe('sliding-window-inplace'); // 默认模式
  });
});

describe('sliding-window range utilities', () => {
  it('computes latest, older, newer, centered, and short ranges', () => {
    const latest = getLatestWindowRange(12, 5);
    expect(latest).toEqual({ startPairIndex: 7, endPairIndex: 11 });
    expect(getWindowPairCount(latest)).toBe(5);
    expect(isLatestWindow(latest, 12)).toBe(true);

    const older = getOlderWindowRange(latest, 12, 5);
    expect(older).toEqual({ startPairIndex: 5, endPairIndex: 9 });
    expect(isLatestWindow(older, 12)).toBe(false);

    expect(getOlderWindowRange(older, 12, 5)).toEqual({ startPairIndex: 0, endPairIndex: 4 });
    expect(getNewerWindowRange({ startPairIndex: 0, endPairIndex: 4 }, 12, 5)).toEqual({
      startPairIndex: 5,
      endPairIndex: 9,
    });
    expect(getNewerWindowRange(older, 12, 5)).toEqual({ startPairIndex: 7, endPairIndex: 11 });
    expect(getCenteredWindowRange(6, 12, 5)).toEqual({ startPairIndex: 4, endPairIndex: 8 });
    expect(getLatestWindowRange(3, 5)).toEqual({ startPairIndex: 0, endPairIndex: 2 });
    expect(getLatestWindowRange(0, 5)).toEqual({ startPairIndex: 0, endPairIndex: -1 });
  });

  it('maps first, latest, and direct page jumps onto the same reload windows', () => {
    expect(getWindowPageCount(12, 5)).toBe(3);
    expect(getFirstWindowRange(12, 5)).toEqual({ startPairIndex: 0, endPairIndex: 4 });
    expect(getWindowPageRange(12, 5, 1)).toEqual({ startPairIndex: 0, endPairIndex: 4 });
    expect(getWindowPageRange(12, 5, 2)).toEqual({ startPairIndex: 5, endPairIndex: 9 });
    expect(getWindowPageRange(12, 5, 3)).toEqual({ startPairIndex: 7, endPairIndex: 11 });
    expect(getWindowPageRange(12, 5, 99)).toEqual({ startPairIndex: 7, endPairIndex: 11 });
    expect(getWindowPageForRange({ startPairIndex: 5, endPairIndex: 9 }, 12, 5)).toBe(2);
    expect(getWindowPageForRange({ startPairIndex: 7, endPairIndex: 11 }, 12, 5)).toBe(3);
    expect(getWindowPageCount(0, 3)).toBe(0);
  });
});

describe('sliding-window payload validation and signature', () => {
  it('accepts valid conversation and synthetic payloads', () => {
    const payload = buildBasicSlidingWindowPayload(2);

    expect(validateConversationPayload(payload)).toEqual({ ok: true, issues: [] });
    expect(validateSyntheticPayload(payload)).toEqual({ ok: true, issues: [] });
  });

  it('detects broken mapping references', () => {
    const result = validateConversationPayload(buildInvalidSlidingWindowPayload());

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('child-missing');
  });

  it('detects missing current_node', () => {
    const payload = buildBasicSlidingWindowPayload(1);
    delete payload.current_node;

    const result = validateConversationPayload(payload);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('current-node-missing');
  });

  it('creates stable payload signatures', () => {
    const signature = createSlidingWindowSignature(buildBasicSlidingWindowPayload(2), 'abc');

    expect(signature).toMatchObject({
      conversationId: 'abc',
      currentNodeId: 'assistant2',
      mappingNodeCount: 6,
      updateTime: 5,
      schemaVersion: 1,
    });
    expect(serializeSlidingWindowSignature(signature)).toBe('1:abc:assistant2:6:5');
  });
});

describe('sliding-window active chain and pair index', () => {
  it('uses only the active branch when a conversation has branches', () => {
    const payload = buildBranchSlidingWindowPayload();
    const chain = resolveSlidingWindowActiveChain(payload);

    expect(chain.nodeIds).toEqual(['root', 'system', 'user1', 'assistant1', 'user2', 'assistant2']);
    expect(chain.nodeIds).not.toContain('branchAssistant');
  });

  it('builds node-level pair indexes from ordinary user/assistant payloads', () => {
    const index = buildSlidingWindowPairIndex(buildBasicSlidingWindowPayload(3));

    expect(index.totalPairs).toBe(3);
    expect(index.pairs[0]).toMatchObject({
      pairIndex: 0,
      userNodeId: 'user1',
      relatedNodeIds: ['system', 'user1', 'assistant1'],
      startNodeId: 'system',
      endNodeId: 'assistant1',
      userPreview: 'user-1',
      assistantPreview: 'assistant-1',
    });
    expect(index.pairs[0]?.searchText).toBe('user-1 assistant-1');
    expect(index.nodeIdToPairIndex.assistant2).toBe(1);
  });

  it('handles short conversations within the configured window', () => {
    const index = buildSlidingWindowPairIndex(buildShortSlidingWindowPayload());

    expect(index.totalPairs).toBe(1);
    expect(index.pairs[0]?.relatedNodeIds).toEqual(['system', 'user1', 'assistant1']);
  });

  it('keeps tool nodes related but excludes tool raw output from search text', () => {
    const index = buildSlidingWindowPairIndex(buildToolSlidingWindowPayload());

    expect(index.pairs[0]?.relatedNodeIds).toEqual([
      'system',
      'user1',
      'assistant1',
      'tool1',
      'assistantTool',
    ]);
    expect(index.nodeIdToPairIndex.tool1).toBe(0);
    expect(index.pairs[0]?.searchText).toContain('tool-visible-answer');
    expect(index.pairs[0]?.searchText).not.toContain('secret-token');
  });

  it('keeps hidden and thinking nodes related but out of search text', () => {
    const index = buildSlidingWindowPairIndex(buildHiddenSlidingWindowPayload());

    expect(index.pairs[0]?.relatedNodeIds).toEqual(['system', 'user1', 'thinking1', 'assistant1']);
    expect(index.pairs[0]?.searchText).toContain('visible user');
    expect(index.pairs[0]?.searchText).toContain('visible assistant');
    expect(index.pairs[0]?.searchText).not.toContain('private chain of thought');
    expect(index.pairs[0]?.searchText).not.toContain('hidden system scaffold');
  });
});

describe('sliding-window search index', () => {
  it('returns pair indexes and previews for matching cached text', () => {
    const pairIndex = buildSlidingWindowPairIndex(buildBasicSlidingWindowPayload(3));
    const searchIndex = buildSlidingWindowSearchIndex(pairIndex);

    expect(searchSlidingWindowPairs(searchIndex, 'assistant-2')).toEqual([
      {
        pairIndex: 1,
        userPreview: 'user-2',
        assistantPreview: 'assistant-2',
        excerpt: 'user-2 assistant-2',
      },
    ]);
    expect(searchSlidingWindowPairs(searchIndex, 'missing')).toEqual([]);
  });
});

describe('sliding-window window slicer', () => {
  it('slices to the latest N pairs and keeps the active graph valid', () => {
    const payload = buildBasicSlidingWindowPayload(5);
    const pairIndex = buildSlidingWindowPairIndex(payload);
    const result = sliceConversationToWindow(payload, pairIndex, getLatestWindowRange(pairIndex.totalPairs, 2));

    expect(result).toMatchObject({
      ok: true,
      range: { startPairIndex: 3, endPairIndex: 4 },
      reason: null,
      keptNodeCount: 6,
      removedNodeCount: 6,
    });
    expect(result.payload?.current_node).toBe('assistant5');
    expectMappingKeys(result.payload, ['root', 'system', 'user4', 'assistant4', 'user5', 'assistant5']);
    expect(result.payload?.mapping?.system?.children).toEqual(['user4']);
    expectValidSyntheticPayload(result.payload);
  });

  it('slices a middle window without retaining older or newer heavy message nodes', () => {
    const payload = buildBasicSlidingWindowPayload(5);
    const pairIndex = buildSlidingWindowPairIndex(payload);
    const result = sliceConversationToWindow(payload, pairIndex, { startPairIndex: 1, endPairIndex: 2 });

    expect(result.ok).toBe(true);
    expect(result.payload?.current_node).toBe('assistant3');
    expectMappingKeys(result.payload, ['root', 'system', 'user2', 'assistant2', 'user3', 'assistant3']);
    expect(result.payload?.mapping?.system).toMatchObject({
      parent: 'root',
      children: ['user2'],
    });
    expect(result.payload?.mapping?.assistant3).toMatchObject({
      parent: 'user3',
      children: [],
    });
    expect(result.payload?.mapping?.user1).toBeUndefined();
    expect(result.payload?.mapping?.user4).toBeUndefined();
    expectValidSyntheticPayload(result.payload);
  });

  it('slices the oldest window and preserves the root/system spine', () => {
    const payload = buildBasicSlidingWindowPayload(5);
    const pairIndex = buildSlidingWindowPairIndex(payload);
    const result = sliceConversationToWindow(payload, pairIndex, { startPairIndex: 0, endPairIndex: 1 });

    expect(result.ok).toBe(true);
    expect(result.payload?.current_node).toBe('assistant2');
    expectMappingKeys(result.payload, ['root', 'system', 'user1', 'assistant1', 'user2', 'assistant2']);
    expect(result.payload?.mapping?.root?.children).toEqual(['system']);
    expectValidSyntheticPayload(result.payload);
  });

  it('keeps short conversations effectively whole', () => {
    const payload = buildShortSlidingWindowPayload();
    const pairIndex = buildSlidingWindowPairIndex(payload);
    const result = sliceConversationToWindow(payload, pairIndex, getLatestWindowRange(pairIndex.totalPairs, 5));

    expect(result).toMatchObject({
      ok: true,
      keptNodeCount: 4,
      removedNodeCount: 0,
    });
    expect(result.payload?.current_node).toBe('assistant1');
    expectMappingKeys(result.payload, ['root', 'system', 'user1', 'assistant1']);
    expectValidSyntheticPayload(result.payload);
  });

  it('keeps tool call nodes inside the selected pair', () => {
    const payload = buildToolSlidingWindowPayload();
    const pairIndex = buildSlidingWindowPairIndex(payload);
    const result = sliceConversationToWindow(payload, pairIndex, { startPairIndex: 0, endPairIndex: 0 });

    expect(result.ok).toBe(true);
    expect(result.payload?.current_node).toBe('assistantTool');
    expectMappingKeys(result.payload, ['root', 'system', 'user1', 'assistant1', 'tool1', 'assistantTool']);
    expect(result.payload?.mapping?.tool1?.children).toEqual(['assistantTool']);
    expectValidSyntheticPayload(result.payload);
  });

  it('keeps hidden/thinking nodes that belong to the selected window', () => {
    const payload = buildHiddenSlidingWindowPayload();
    const pairIndex = buildSlidingWindowPairIndex(payload);
    const result = sliceConversationToWindow(payload, pairIndex, getLatestWindowRange(pairIndex.totalPairs, 1));

    expect(result.ok).toBe(true);
    expect(result.payload?.current_node).toBe('assistant1');
    expectMappingKeys(result.payload, ['root', 'system', 'user1', 'thinking1', 'assistant1']);
    expect(result.payload?.mapping?.thinking1?.children).toEqual(['assistant1']);
    expectValidSyntheticPayload(result.payload);
  });

  it('removes inactive branches while preserving the selected current branch', () => {
    const payload = buildBranchSlidingWindowPayload();
    const pairIndex = buildSlidingWindowPairIndex(payload);
    const result = sliceConversationToWindow(payload, pairIndex, getLatestWindowRange(pairIndex.totalPairs, 5));

    expect(result.ok).toBe(true);
    expect(result.payload?.current_node).toBe('assistant2');
    expect(result.payload?.mapping?.branchUser).toBeUndefined();
    expect(result.payload?.mapping?.branchAssistant).toBeUndefined();
    expectMappingKeys(result.payload, ['root', 'system', 'user1', 'assistant1', 'user2', 'assistant2']);
    expectValidSyntheticPayload(result.payload);
  });

  it('returns structured failure for invalid mapping', () => {
    const payload = buildInvalidSlidingWindowPayload();
    const pairIndex = buildSlidingWindowPairIndex(payload);
    const result = sliceConversationToWindow(payload, pairIndex, { startPairIndex: 0, endPairIndex: 0 });

    expect(result).toMatchObject({
      ok: false,
      payload: null,
      reason: 'invalid-payload:child-missing',
    });
  });

  it('returns structured failure when current_node is missing', () => {
    const payload = buildBasicSlidingWindowPayload(1);
    const pairIndex = buildSlidingWindowPairIndex(payload);
    delete payload.current_node;

    const result = sliceConversationToWindow(payload, pairIndex, { startPairIndex: 0, endPairIndex: 0 });

    expect(result).toMatchObject({
      ok: false,
      payload: null,
      reason: 'invalid-payload:current-node-missing',
    });
  });
});
