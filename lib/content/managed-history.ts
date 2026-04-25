import {
  buildInteractionBatches,
  buildInteractionPairs,
  stripLeadingRolePrefix,
  type InteractionBatch,
  type InteractionPair,
} from '../shared/interaction-pairs';
import type {
  ArchivePage,
  ArchivePageMatch,
  ArchivePageMeta,
  BatchSource,
  InitialTrimSession,
  ManagedHistoryEntry,
  ManagedHistoryGroup,
  ManagedHistoryMatch,
  ManagedHistoryRenderKind,
  TurnRecord,
  TurnRole,
} from '../shared/types';

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function buildText(
  parts: string[],
  structuredDetails?: string | null,
  contentType?: string | null,
  hiddenFromConversation = false,
): string {
  if (hiddenFromConversation) {
    return '';
  }

  return normalizeText(
    [parts.join('\n'), contentType ?? '', structuredDetails ?? '']
      .filter((part) => part.length > 0)
      .join('\n'),
  );
}

function createExcerpt(text: string, query: string): string {
  if (query.length === 0) {
    return text;
  }

  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const index = normalizedText.indexOf(normalizedQuery);
  if (index === -1) {
    return text;
  }

  const start = Math.max(0, index - 48);
  const end = Math.min(text.length, index + normalizedQuery.length + 64);
  const excerpt = text.slice(start, end).trim();
  return start > 0 ? `…${excerpt}` : excerpt;
}

function extractNodeParts(node: HTMLElement | null): string[] {
  const text = node?.textContent?.trim() ?? '';
  if (text.length === 0) {
    return [];
  }

  return text
    .split(/\n+/)
    .map((part) => stripLeadingRolePrefix(part.replace(/\s+/g, ' ').trim()))
    .filter((part) => part.length > 0);
}

function createHostSnapshotHtml(node: HTMLElement | null): string | null {
  if (node == null) {
    return null;
  }

  const clone = node.cloneNode(true);
  if (!(clone instanceof HTMLElement)) {
    return null;
  }

  clone
    .querySelectorAll(
      'button, input, textarea, select, form, nav, [role="button"], [contenteditable="true"], [aria-haspopup="menu"]',
    )
    .forEach((element) => element.remove());
  clone.querySelectorAll<HTMLElement>('[id]').forEach((element) => element.removeAttribute('id'));
  clone.querySelectorAll<HTMLElement>('[tabindex]').forEach((element) => element.removeAttribute('tabindex'));

  const messageId = clone.getAttribute('data-message-id')?.trim() ?? '';
  const html = clone.innerHTML.trim();
  if (messageId.length > 0) {
    return html.length > 0 ? `<!--data-message-id:${messageId}-->${html}` : `<!--data-message-id:${messageId}-->`;
  }
  return html.length > 0 ? html : null;
}

export function extractMessageIdFromHtml(html: string | null | undefined): string | null {
  if (html == null || html.length === 0) {
    return null;
  }

  const attributeMatch = html.match(/\bdata-message-id=(["'])(.*?)\1/i);
  if (attributeMatch?.[2] != null) {
    const messageId = attributeMatch[2].trim();
    if (messageId.length > 0) {
      return messageId;
    }
  }

  const commentMatch = html.match(/<!--\s*data-message-id\s*:\s*([^>]+?)\s*-->/i);
  const messageId = commentMatch?.[1]?.trim() ?? null;
  return messageId != null && messageId.length > 0 ? messageId : null;
}

export function isSyntheticMessageId(messageId: string | null | undefined): boolean {
  if (messageId == null) {
    return false;
  }

  const normalized = messageId.trim();
  return normalized.startsWith('turn-chat:') || normalized.startsWith('turn-');
}

export function resolvePreferredMessageId(...candidates: Array<string | null | undefined>): string | null {
  const normalizedCandidates = candidates
    .map((candidate) => candidate?.trim() ?? '')
    .filter((candidate) => candidate.length > 0);

  if (normalizedCandidates.length === 0) {
    return null;
  }

  const preferred = normalizedCandidates.find((candidate) => !isSyntheticMessageId(candidate));
  return preferred ?? normalizedCandidates[0] ?? null;
}

function countBatchMatches(batch: InteractionBatch<ManagedHistoryEntry>, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return 0;
  }

  return batch.pairs.filter((pair) => pair.searchText.toLowerCase().includes(normalizedQuery)).length;
}

function deriveBatchSource(entries: ManagedHistoryEntry[]): BatchSource {
  const hasInitialTrim = entries.some((entry) => entry.source === 'initial-trim');
  const hasParkedDom = entries.some((entry) => entry.source !== 'initial-trim');

  if (hasInitialTrim && hasParkedDom) {
    return 'mixed';
  }
  if (hasInitialTrim) {
    return 'initial-trim';
  }
  return 'parked-dom';
}

function summarizePreviewText(text: string, maxLength = 72): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function pickVisiblePreview(entries: ManagedHistoryEntry[], roles: TurnRole[]): string {
  for (const entry of entries) {
    if (isSupplementalHistoryEntry(entry) || !roles.includes(entry.role)) {
      continue;
    }

    const cleaned = summarizePreviewText(stripLeadingRolePrefix(entry.text));
    if (cleaned.length > 0) {
      return cleaned;
    }

    const fallback = summarizePreviewText(entry.text);
    if (fallback.length > 0) {
      return fallback;
    }
  }

  return '';
}

function toManagedGroup(
  batch: InteractionBatch<ManagedHistoryEntry>,
  query: string,
  expanded: boolean,
): ManagedHistoryGroup {
  const source = deriveBatchSource(batch.entries);
  return {
    id: batch.id,
    source,
    slotIndex: batch.slotIndex,
    slotPairStartIndex: batch.slotPairStartIndex,
    slotPairEndIndex: batch.slotPairEndIndex,
    filledPairCount: batch.filledPairCount,
    capacity: batch.capacity,
    pairStartIndex: batch.pairStartIndex,
    pairEndIndex: batch.pairEndIndex,
    turnStartIndex: batch.turnStartIndex,
    turnEndIndex: batch.turnEndIndex,
    pairCount: batch.pairCount,
    collapsed: !expanded,
    expanded,
    entries: batch.entries,
    userPreview: pickVisiblePreview(batch.entries, ['user']) || batch.userPreview,
    assistantPreview: pickVisiblePreview(batch.entries, ['assistant', 'tool', 'system']) || batch.assistantPreview,
    matchCount: countBatchMatches(batch, query),
    parkedGroupId: batch.entries.some((entry) => entry.liveTurnId != null) ? batch.id : null,
  };
}

function toSearchMatch(batch: InteractionBatch<ManagedHistoryEntry>, query: string): ManagedHistoryMatch | null {
  const matchCount = countBatchMatches(batch, query);
  if (query.length > 0 && matchCount === 0) {
    return null;
  }

  return {
    batchId: batch.id,
    source: deriveBatchSource(batch.entries),
    pairStartIndex: batch.pairStartIndex,
    pairEndIndex: batch.pairEndIndex,
    slotPairStartIndex: batch.slotPairStartIndex,
    slotPairEndIndex: batch.slotPairEndIndex,
    matchCount,
    excerpt: createExcerpt(batch.searchText, query),
  };
}

function createEntry(input: {
  id: string;
  turnIndex: number;
  role: TurnRole;
  pairIndex?: number;
  parts: string[];
  renderKind: ManagedHistoryRenderKind;
  contentType?: string | null;
  snapshotHtml?: string | null;
  structuredDetails?: string | null;
  hiddenFromConversation?: boolean;
  createTime?: number | null;
  citations?: ManagedHistoryEntry['citations'];
  turnId?: string | null;
  liveTurnId?: string | null;
  messageId?: string | null;
  source?: ManagedHistoryEntry['source'];
}): ManagedHistoryEntry {
  const parts = input.parts.map((part) => part.trim()).filter((part) => part.length > 0);
  return {
    id: input.id,
    source: input.source ?? 'parked-group',
    role: input.role,
    turnIndex: input.turnIndex,
    pairIndex: input.pairIndex ?? 0,
    turnId: input.turnId ?? null,
    liveTurnId: input.liveTurnId ?? null,
    messageId: resolvePreferredMessageId(
      input.messageId,
      extractMessageIdFromHtml(input.snapshotHtml),
      input.turnId,
      input.liveTurnId,
    ),
    groupId: null,
    parts,
    text: buildText(parts, input.structuredDetails ?? null, input.contentType ?? null, input.hiddenFromConversation ?? false),
    renderKind: input.renderKind,
    contentType: input.contentType ?? null,
    snapshotHtml: input.snapshotHtml ?? null,
    structuredDetails: input.structuredDetails ?? null,
    hiddenFromConversation: input.hiddenFromConversation ?? false,
    createTime: input.createTime ?? null,
    citations: [...(input.citations ?? [])],
  };
}

export function isSupplementalHistoryEntry(
  entry: Pick<ManagedHistoryEntry, 'renderKind' | 'hiddenFromConversation'>,
): boolean {
  return entry.hiddenFromConversation || entry.renderKind === 'structured-message';
}

export class ManagedHistoryStore {
  private turns: ManagedHistoryEntry[] = [];
  private domStartIndex = 0;
  private liveStartIndex = 0;
  private readonly liveTurnRevisionCache = new Map<string, string>();
  private revision = 0;
  private pairsCache: {
    revision: number;
    pairs: InteractionPair<ManagedHistoryEntry>[];
  } | null = null;
  private readonly archiveBatchCache = new Map<
    string,
    {
      revision: number;
      batches: InteractionBatch<ManagedHistoryEntry>[];
    }
  >();

  clear(): void {
    this.turns = [];
    this.domStartIndex = 0;
    this.liveStartIndex = 0;
    this.liveTurnRevisionCache.clear();
    this.invalidateDerivedCaches();
  }

  setInitialTrimSession(session: InitialTrimSession | null): void {
    if (session?.applied !== true || session.turns.length === 0) {
      this.clear();
      return;
    }

    this.domStartIndex = session.hotStartIndex;
    this.liveStartIndex = session.hotStartIndex;
    this.turns = session.turns.map((turn, index) =>
      createEntry({
        id: `history:${turn.id}:${index}`,
        source: index < session.hotStartIndex ? 'initial-trim' : 'parked-group',
        role: turn.role,
        turnIndex: index,
        turnId: turn.id,
        messageId: turn.id,
        parts: [...turn.parts],
        renderKind: turn.renderKind,
        contentType: turn.contentType,
        snapshotHtml: turn.snapshotHtml,
        structuredDetails: turn.structuredDetails,
        hiddenFromConversation: turn.hiddenFromConversation,
        createTime: turn.createTime,
        citations: turn.citations,
      }),
    );
    this.liveTurnRevisionCache.clear();
    this.invalidateDerivedCaches();
    this.reindexPairs();
  }

  syncFromRecords(records: TurnRecord[]): void {
    if (records.length === 0) {
      for (const turn of this.turns) {
        if (turn.turnIndex >= this.liveStartIndex) {
          turn.liveTurnId = null;
        }
      }
      this.liveTurnRevisionCache.clear();
      this.invalidateDerivedCaches();
      return;
    }

    if (this.turns.length === 0) {
      this.domStartIndex = 0;
      this.liveStartIndex = 0;
    }

    this.liveStartIndex = Math.max(0, Math.min(this.liveStartIndex, this.turns.length));

    for (const turn of this.turns) {
      if (turn.turnIndex >= this.liveStartIndex) {
        turn.liveTurnId = null;
      }
    }

    const nextLiveTurnIds = new Set<string>();
    let turnIndex = this.liveStartIndex;
    for (const record of records) {
      while (turnIndex < this.turns.length && isSupplementalHistoryEntry(this.turns[turnIndex]!)) {
        turnIndex += 1;
      }

      if (turnIndex >= this.turns.length) {
        break;
      }

      const absoluteIndex = turnIndex;
      const existing = this.turns[absoluteIndex];
      const recordRevision = record.contentRevision?.trim() ?? '';
      const previousRevision = this.liveTurnRevisionCache.get(record.id) ?? '';
      const canReuseSnapshot =
        !record.isStreaming &&
        recordRevision.length > 0 &&
        previousRevision === recordRevision &&
        existing?.liveTurnId === record.id &&
        existing.renderKind === 'host-snapshot' &&
        existing.snapshotHtml != null;
      const parts = canReuseSnapshot ? existing.parts : extractNodeParts(record.node);
      const snapshotHtml = canReuseSnapshot ? existing.snapshotHtml : createHostSnapshotHtml(record.node);
      const next = createEntry({
        id: existing?.id ?? `history:${record.id}:${absoluteIndex}`,
        source: absoluteIndex < this.domStartIndex ? 'initial-trim' : 'parked-group',
        role: record.role,
        turnIndex: absoluteIndex,
        turnId: existing?.turnId ?? record.id,
        liveTurnId: record.id,
        messageId: resolvePreferredMessageId(
          extractMessageIdFromHtml(snapshotHtml),
          record.messageId,
          existing?.messageId,
          existing?.turnId,
          record.id,
        ),
        parts: parts.length > 0 ? parts : (existing?.parts ?? []),
        renderKind: snapshotHtml != null ? 'host-snapshot' : (existing?.renderKind ?? 'markdown-text'),
        contentType: existing?.contentType ?? null,
        snapshotHtml: snapshotHtml ?? existing?.snapshotHtml ?? null,
        structuredDetails: existing?.structuredDetails ?? null,
        hiddenFromConversation: existing?.hiddenFromConversation ?? false,
        createTime: existing?.createTime ?? null,
        citations: existing?.citations,
      });

      if (absoluteIndex < this.turns.length) {
        this.turns[absoluteIndex] = next;
      } else {
        this.turns.push(next);
      }
      nextLiveTurnIds.add(record.id);
      if (recordRevision.length > 0) {
        this.liveTurnRevisionCache.set(record.id, recordRevision);
      } else {
        this.liveTurnRevisionCache.delete(record.id);
      }
      turnIndex += 1;
    }

    for (const turnId of [...this.liveTurnRevisionCache.keys()]) {
      if (!nextLiveTurnIds.has(turnId)) {
        this.liveTurnRevisionCache.delete(turnId);
      }
    }

    for (let index = 0; index < this.turns.length; index += 1) {
      const turn = this.turns[index];
      if (turn != null) {
        turn.turnIndex = index;
      }
    }
    this.invalidateDerivedCaches();
    this.reindexPairs();
  }

  getEntries(): ManagedHistoryEntry[] {
    return [...this.turns];
  }

  getTotalTurns(): number {
    return this.turns.length;
  }

  getTotalPairs(): number {
    return this.buildPairs().length;
  }

  getArchivedTurnsTotal(hotPairCount: number): number {
    const archivedPairs = this.getArchivedPairs(hotPairCount);
    return archivedPairs.reduce((sum, pair) => sum + pair.entries.length, 0);
  }

  getArchivedPairCount(hotPairCount: number): number {
    return Math.max(0, this.getTotalPairs() - Math.max(0, hotPairCount));
  }

  getArchivedPageCount(pagePairCount: number, hotPairCount: number): number {
    const normalizedPagePairCount = Math.max(0, Math.trunc(pagePairCount));
    if (normalizedPagePairCount === 0) {
      return 0;
    }

    const archivedPairCount = this.getArchivedPairCount(hotPairCount);
    return Math.ceil(archivedPairCount / normalizedPagePairCount);
  }

  getArchivedPairsWindow(
    pageIndex: number,
    pagePairCount: number,
    hotPairCount: number,
  ): InteractionPair<ManagedHistoryEntry>[] {
    const normalizedPagePairCount = Math.max(0, Math.trunc(pagePairCount));
    if (normalizedPagePairCount === 0) {
      return [];
    }

    const pageCount = this.getArchivedPageCount(normalizedPagePairCount, hotPairCount);
    const normalizedPageIndex = Math.trunc(pageIndex);
    if (normalizedPageIndex < 0 || normalizedPageIndex >= pageCount) {
      return [];
    }

    const archivedPairs = this.getArchivedPairs(hotPairCount);
    const start = normalizedPageIndex * normalizedPagePairCount;
    return archivedPairs.slice(start, start + normalizedPagePairCount);
  }

  getArchivedPageMeta(
    pageIndex: number,
    pagePairCount: number,
    hotPairCount: number,
  ): ArchivePageMeta | null {
    const normalizedPagePairCount = Math.max(0, Math.trunc(pagePairCount));
    if (normalizedPagePairCount === 0) {
      return null;
    }

    const pageCount = this.getArchivedPageCount(normalizedPagePairCount, hotPairCount);
    const normalizedPageIndex = Math.trunc(pageIndex);
    if (pageCount === 0 || normalizedPageIndex < 0 || normalizedPageIndex >= pageCount) {
      return null;
    }

    const pagePairs = this.getArchivedPairsWindow(normalizedPageIndex, normalizedPagePairCount, hotPairCount);
    const firstPair = pagePairs[0];
    const lastPair = pagePairs.at(-1);
    if (firstPair == null || lastPair == null) {
      return null;
    }

    return {
      id: `archive-page-${normalizedPageIndex}`,
      pageIndex: normalizedPageIndex,
      pageCount,
      pagePairCount: normalizedPagePairCount,
      pairStartIndex: firstPair.pairIndex,
      pairEndIndex: lastPair.pairIndex,
      pairCount: pagePairs.length,
      source: deriveBatchSource(pagePairs.flatMap((pair) => pair.entries)),
    };
  }

  getArchivedPage(
    pageIndex: number,
    pagePairCount: number,
    hotPairCount: number,
  ): ArchivePage | null {
    const meta = this.getArchivedPageMeta(pageIndex, pagePairCount, hotPairCount);
    if (meta == null) {
      return null;
    }

    return {
      ...meta,
      entries: this.getArchivedPairsWindow(meta.pageIndex, meta.pagePairCount, hotPairCount).flatMap(
        (pair) => pair.entries,
      ),
    };
  }

  findPageIndexByTurnId(
    turnId: string,
    pagePairCount: number,
    hotPairCount: number,
  ): number | null {
    const normalizedTurnId = turnId.trim();
    if (normalizedTurnId.length === 0) {
      return null;
    }

    const pageCount = this.getArchivedPageCount(pagePairCount, hotPairCount);
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const pagePairs = this.getArchivedPairsWindow(pageIndex, pagePairCount, hotPairCount);
      if (
        pagePairs.some((pair) =>
          pair.entries.some(
            (entry) => entry.turnId === normalizedTurnId || entry.liveTurnId === normalizedTurnId,
          ),
        )
      ) {
        return pageIndex;
      }
    }

    return null;
  }

  findPageIndexByQueryMatch(query: string, pagePairCount: number, hotPairCount: number): number | null {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
      return null;
    }

    const pageCount = this.getArchivedPageCount(pagePairCount, hotPairCount);
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const pagePairs = this.getArchivedPairsWindow(pageIndex, pagePairCount, hotPairCount);
      if (pagePairs.some((pair) => pair.searchText.toLowerCase().includes(normalizedQuery))) {
        return pageIndex;
      }
    }

    return null;
  }

  getArchiveSlotCount(hotPairCount: number, batchPairCount: number): number {
    return this.buildArchiveBatches(hotPairCount, batchPairCount).length;
  }

  getArchiveGroups(
    hotPairCount: number,
    batchPairCount: number,
    query: string,
    expandedBatchIds: ReadonlySet<string>,
  ): ManagedHistoryGroup[] {
    return this.buildArchiveBatches(hotPairCount, batchPairCount).map((batch) =>
      toManagedGroup(batch, query, expandedBatchIds.has(batch.id)),
    );
  }

  getArchiveGroupsForPage(
    pageIndex: number,
    pagePairCount: number,
    hotPairCount: number,
    batchPairCount: number,
    query: string,
    expandedBatchIds: ReadonlySet<string>,
  ): ManagedHistoryGroup[] {
    const pagePairs = this.getArchivedPairsWindow(pageIndex, pagePairCount, hotPairCount);
    return buildInteractionBatches(pagePairs, batchPairCount, 'archive').map((batch) =>
      toManagedGroup(batch, query, expandedBatchIds.has(batch.id)),
    );
  }

  getHotWindowStartTurnIndex(hotPairCount: number): number {
    const hotPairs = this.buildPairs().slice(-Math.max(0, hotPairCount));
    return hotPairs[0]?.startTurnIndex ?? this.turns.length;
  }

  getDefaultLiveStartIndex(): number {
    return this.domStartIndex;
  }

  getLiveStartIndex(): number {
    return this.liveStartIndex;
  }

  setLiveStartIndex(index: number): void {
    this.liveStartIndex = Math.max(0, Math.min(index, this.turns.length));
  }

  resetLiveStartIndex(): void {
    this.liveStartIndex = this.domStartIndex;
  }

  getFirstVisibleLiveTurnIndex(parkedTurnIds: ReadonlySet<string>): number {
    for (const turn of this.turns) {
      if (turn.liveTurnId != null && !parkedTurnIds.has(turn.liveTurnId)) {
        return turn.turnIndex;
      }
    }

    return this.domStartIndex;
  }

  getCollapsedBatchCount(
    hotPairCount: number,
    batchPairCount: number,
    query: string,
    expandedBatchIds: ReadonlySet<string>,
  ): number {
    return this.getArchiveGroups(hotPairCount, batchPairCount, query, expandedBatchIds).filter(
      (group) => !group.expanded,
    ).length;
  }

  getExpandedBatchCount(
    hotPairCount: number,
    batchPairCount: number,
    query: string,
    expandedBatchIds: ReadonlySet<string>,
  ): number {
    return this.getArchiveGroups(hotPairCount, batchPairCount, query, expandedBatchIds).filter(
      (group) => group.expanded,
    ).length;
  }

  search(query: string, hotPairCount: number, batchPairCount: number): ManagedHistoryMatch[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
      return [];
    }

    return this.buildArchiveBatches(hotPairCount, batchPairCount)
      .map((batch) => toSearchMatch(batch, normalizedQuery))
      .filter((match): match is ManagedHistoryMatch => match != null);
  }

  searchArchivedPages(
    query: string,
    pagePairCount: number,
    hotPairCount: number,
  ): ArchivePageMatch[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
      return [];
    }

    const pageCount = this.getArchivedPageCount(pagePairCount, hotPairCount);
    const matches: ArchivePageMatch[] = [];

    for (let pageIndex = pageCount - 1; pageIndex >= 0; pageIndex -= 1) {
      const page = this.getArchivedPage(pageIndex, pagePairCount, hotPairCount);
      if (page == null) {
        continue;
      }

      const pagePairs = this.getArchivedPairsWindow(pageIndex, pagePairCount, hotPairCount);
      let matchCount = 0;
      let firstMatchPairIndex = -1;
      let excerpt = '';

      for (const pair of pagePairs) {
        if (!pair.searchText.toLowerCase().includes(normalizedQuery)) {
          continue;
        }

        matchCount += 1;
        if (firstMatchPairIndex < 0) {
          firstMatchPairIndex = pair.pairIndex;
          excerpt = createExcerpt(pair.searchText, normalizedQuery);
        }
      }

      if (matchCount === 0 || firstMatchPairIndex < 0) {
        continue;
      }

      matches.push({
        ...page,
        matchCount,
        excerpt,
        firstMatchPairIndex,
      });
    }

    return matches;
  }

  getPairIndexForTurnIndex(turnIndex: number): number | null {
    for (const pair of this.buildPairs()) {
      if (pair.startTurnIndex <= turnIndex && turnIndex <= pair.endTurnIndex) {
        return pair.pairIndex;
      }
    }

    return null;
  }

  static createEntry(input: {
    id: string;
    turnIndex: number;
    role: TurnRole;
    parts: string[];
    renderKind?: ManagedHistoryRenderKind;
    contentType?: string | null;
    snapshotHtml?: string | null;
    structuredDetails?: string | null;
    hiddenFromConversation?: boolean;
    citations?: ManagedHistoryEntry['citations'];
    turnId?: string | null;
    liveTurnId?: string | null;
    source?: ManagedHistoryEntry['source'];
  }): ManagedHistoryEntry {
    return createEntry({
      ...input,
      renderKind: input.renderKind ?? 'markdown-text',
      contentType: input.contentType ?? null,
      snapshotHtml: input.snapshotHtml ?? null,
      structuredDetails: input.structuredDetails ?? null,
    });
  }

  getArchiveGroupsContainingLiveTurns(
    hotPairCount: number,
    batchPairCount: number,
    query: string,
    expandedBatchIds: ReadonlySet<string>,
  ): ManagedHistoryGroup[] {
    return this.getArchiveGroups(hotPairCount, batchPairCount, query, expandedBatchIds).filter((group) =>
      group.entries.some((entry) => entry.liveTurnId != null),
    );
  }

  private buildPairs(): InteractionPair<ManagedHistoryEntry>[] {
    if (this.pairsCache?.revision === this.revision) {
      return this.pairsCache.pairs;
    }

    const pairs = buildInteractionPairs(
      this.turns.map((turn) => ({
        ...turn,
        text: turn.text,
      })),
    );
    this.pairsCache = {
      revision: this.revision,
      pairs,
    };
    return pairs;
  }

  private reindexPairs(): void {
    const pairs = this.buildPairs();
    const pairIndexByTurnId = new Map<string, number>();
    for (const pair of pairs) {
      for (const entry of pair.entries) {
        pairIndexByTurnId.set(entry.id, pair.pairIndex);
      }
    }

    for (const turn of this.turns) {
      const pairIndex = pairIndexByTurnId.get(turn.id);
      if (pairIndex != null) {
        turn.pairIndex = pairIndex;
      }
    }
  }

  private getArchivedPairs(hotPairCount: number): InteractionPair<ManagedHistoryEntry>[] {
    const pairs = this.buildPairs();
    return pairs.slice(0, Math.max(0, pairs.length - Math.max(0, hotPairCount)));
  }

  private buildArchiveBatches(
    hotPairCount: number,
    batchPairCount: number,
  ): InteractionBatch<ManagedHistoryEntry>[] {
    const cacheKey = `${hotPairCount}:${batchPairCount}`;
    const cached = this.archiveBatchCache.get(cacheKey);
    if (cached != null && cached.revision === this.revision) {
      return cached.batches;
    }

    const batches = buildInteractionBatches(this.getArchivedPairs(hotPairCount), batchPairCount, 'archive');
    this.archiveBatchCache.set(cacheKey, {
      revision: this.revision,
      batches,
    });
    return batches;
  }

  private invalidateDerivedCaches(): void {
    this.revision += 1;
    this.pairsCache = null;
    this.archiveBatchCache.clear();
  }
}
