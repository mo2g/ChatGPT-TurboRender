import { expect } from 'vitest';

import { getChatIdFromPathname } from '../../lib/shared/chat-id';
import type { InitialTrimSession } from '../../lib/shared/types';

export async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

type ArchiveBoundaryAction =
  | 'open-archive-newest'
  | 'go-archive-older'
  | 'go-archive-newer'
  | 'go-archive-recent';

async function clickArchiveBoundaryAction(action: ArchiveBoundaryAction): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>(`[data-turbo-render-action="${action}"]`);
  expect(button).not.toBeNull();
  button?.click();
  await flush();
}

export async function openNewestArchivePage(): Promise<void> {
  await clickArchiveBoundaryAction('open-archive-newest');
}

export async function goOlderArchivePage(): Promise<void> {
  await clickArchiveBoundaryAction('go-archive-older');
}

export async function goNewerArchivePage(): Promise<void> {
  await clickArchiveBoundaryAction('go-archive-newer');
}

export async function goToRecentArchiveView(): Promise<void> {
  await clickArchiveBoundaryAction('go-archive-recent');
}

export async function toggleArchiveSearch(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('[data-turbo-render-action="toggle-archive-search"]');
  expect(button).not.toBeNull();
  button?.click();
  await flush();
}

export function getArchiveSearchInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('[data-turbo-render-action="archive-search-input"]');
}

export async function setArchiveSearchQuery(query: string): Promise<void> {
  const input = getArchiveSearchInput();
  expect(input).not.toBeNull();
  input!.value = query;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
}

export async function clearArchiveSearch(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('[data-turbo-render-action="clear-archive-search"]');
  expect(button).not.toBeNull();
  button?.click();
  await flush();
}

export async function clickArchiveSearchResult(index = 0): Promise<void> {
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-turbo-render-action="open-archive-search-result"]');
  const button = buttons[index] ?? null;
  expect(button).not.toBeNull();
  button?.click();
  await flush();
}

export function createSessionTurn(
  index: number,
  override: Partial<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    parts: string[];
    renderKind: 'markdown-text' | 'host-snapshot' | 'structured-message';
    contentType: string | null;
    snapshotHtml: string | null;
    structuredDetails: string | null;
    hiddenFromConversation: boolean;
  }> = {},
) {
  return {
    id: `session-turn-${index}`,
    role: override.role ?? (index % 2 === 0 ? 'user' as const : 'assistant' as const),
    parts: override.parts ?? [`Turn ${index + 1} archived content.`],
    renderKind: override.renderKind ?? 'markdown-text',
    contentType: override.contentType ?? 'text',
    snapshotHtml: override.snapshotHtml ?? null,
    structuredDetails: override.structuredDetails ?? null,
    hiddenFromConversation: override.hiddenFromConversation ?? false,
    createTime: index,
  };
}

export function createInitialTrimSession(totalTurns: number, hotStartIndex: number): InitialTrimSession {
  const turns = Array.from({ length: totalTurns }, (_, index) => createSessionTurn(index));
  const totalPairs = Math.ceil(totalTurns / 2);
  const hotTurnCount = totalTurns - hotStartIndex;
  const hotPairCount = Math.ceil(hotTurnCount / 2);

  return {
    chatId: getChatIdFromPathname(document.location.pathname),
    routeKind: document.location.pathname.includes('/share/') ? 'share' : 'chat',
    routeId: document.location.pathname.split('/').filter(Boolean).at(-1) ?? null,
    conversationId: 'conversation-inline-batches',
    applied: true,
    reason: 'trimmed',
    mode: 'performance',
    totalMappingNodes: totalTurns + 12,
    totalVisibleTurns: totalTurns,
    activeBranchLength: totalTurns,
    hotVisibleTurns: hotTurnCount,
    coldVisibleTurns: hotStartIndex,
    initialHotPairs: hotPairCount,
    hotPairCount,
    archivedPairCount: totalPairs - hotPairCount,
    initialHotTurns: hotPairCount * 2,
    hotStartIndex,
    hotTurnCount,
    archivedTurnCount: hotStartIndex,
    activeNodeId: `session-turn-${totalTurns - 1}`,
    turns,
    coldTurns: turns.slice(0, hotStartIndex),
    capturedAt: Date.now(),
  };
}

