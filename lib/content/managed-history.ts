import {
  buildInteractionBatches,
  buildInteractionPairs,
  stripLeadingRolePrefix,
  type InteractionBatch,
  type InteractionPair,
} from '../shared/interaction-pairs';
import type {
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

  const html = clone.innerHTML.trim();
  return html.length > 0 ? html : null;
}

function countBatchMatches(batch: InteractionBatch<ManagedHistoryEntry>, query: string): number {
  if (query.length === 0) {
    return 0;
  }

  const normalizedQuery = query.toLowerCase();
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
    userPreview: batch.userPreview,
    assistantPreview: batch.assistantPreview,
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
  turnId?: string | null;
  liveTurnId?: string | null;
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
    groupId: null,
    parts,
    text: buildText(parts, input.structuredDetails ?? null, input.contentType ?? null, input.hiddenFromConversation ?? false),
    renderKind: input.renderKind,
    contentType: input.contentType ?? null,
    snapshotHtml: input.snapshotHtml ?? null,
    structuredDetails: input.structuredDetails ?? null,
    hiddenFromConversation: input.hiddenFromConversation ?? false,
  };
}

export class ManagedHistoryStore {
  private turns: ManagedHistoryEntry[] = [];
  private domStartIndex = 0;
  private liveStartIndex = 0;

  clear(): void {
    this.turns = [];
    this.domStartIndex = 0;
    this.liveStartIndex = 0;
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
        parts: [...turn.parts],
        renderKind: turn.renderKind,
        contentType: turn.contentType,
        snapshotHtml: turn.snapshotHtml,
        structuredDetails: turn.structuredDetails,
        hiddenFromConversation: turn.hiddenFromConversation,
      }),
    );
    this.reindexPairs();
  }

  syncFromRecords(records: TurnRecord[]): void {
    if (records.length === 0) {
      for (const turn of this.turns) {
        if (turn.turnIndex >= this.liveStartIndex) {
          turn.liveTurnId = null;
        }
      }
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

    records.forEach((record, offset) => {
      const absoluteIndex = this.liveStartIndex + offset;
      const parts = extractNodeParts(record.node);
      const snapshotHtml = createHostSnapshotHtml(record.node);
      const existing = this.turns[absoluteIndex];
      const next = createEntry({
        id: existing?.id ?? `history:${record.id}:${absoluteIndex}`,
        source: absoluteIndex < this.domStartIndex ? 'initial-trim' : 'parked-group',
        role: record.role,
        turnIndex: absoluteIndex,
        turnId: existing?.turnId ?? record.id,
        liveTurnId: record.id,
        parts: parts.length > 0 ? parts : (existing?.parts ?? []),
        renderKind: snapshotHtml != null ? 'host-snapshot' : (existing?.renderKind ?? 'markdown-text'),
        contentType: existing?.contentType ?? null,
        snapshotHtml: snapshotHtml ?? existing?.snapshotHtml ?? null,
        structuredDetails: existing?.structuredDetails ?? null,
        hiddenFromConversation: existing?.hiddenFromConversation ?? false,
      });

      if (absoluteIndex < this.turns.length) {
        this.turns[absoluteIndex] = next;
      } else {
        this.turns.push(next);
      }
    });

    for (let index = this.liveStartIndex + records.length; index < this.turns.length; index += 1) {
      this.turns[index] = {
        ...this.turns[index]!,
        liveTurnId: null,
      };
    }

    this.turns = this.turns.map((turn, index) => ({
      ...turn,
      turnIndex: index,
    }));
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
    const ordered = [...this.turns].sort((left, right) => left.turnIndex - right.turnIndex);
    return buildInteractionPairs(
      ordered.map((turn) => ({
        ...turn,
        text: turn.text,
      })),
    );
  }

  private reindexPairs(): void {
    const pairs = this.buildPairs();
    for (const pair of pairs) {
      for (const entry of pair.entries) {
        const target = this.turns.find((turn) => turn.id === entry.id);
        if (target != null) {
          target.pairIndex = pair.pairIndex;
        }
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
    return buildInteractionBatches(this.getArchivedPairs(hotPairCount), batchPairCount, 'archive');
  }
}
