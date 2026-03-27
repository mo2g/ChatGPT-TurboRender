import type {
  InitialTrimSession,
  ManagedHistoryEntry,
  ManagedHistoryMatch,
  TurnRole,
} from '../shared/types';

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function buildText(parts: string[]): string {
  return normalizeText(parts.join('\n'));
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

export function buildManagedHistoryText(parts: string[]): string {
  return buildText(parts);
}

export class ManagedHistoryStore {
  private initialTrimEntries: ManagedHistoryEntry[] = [];
  private parkedGroups = new Map<string, ManagedHistoryEntry[]>();

  clear(): void {
    this.initialTrimEntries = [];
    this.parkedGroups.clear();
  }

  setInitialTrimSession(session: InitialTrimSession | null): void {
    if (session?.applied !== true || session.coldTurns.length === 0) {
      this.initialTrimEntries = [];
      return;
    }

    this.initialTrimEntries = session.coldTurns.map((turn, index) => {
      const parts = turn.parts.map((part) => part.trim()).filter((part) => part.length > 0);
      return {
        id: `initial:${turn.id}`,
        source: 'initial-trim',
        role: turn.role,
        turnIndex: index,
        turnId: null,
        groupId: null,
        parts,
        text: buildText(parts),
      };
    });
  }

  upsertParkedGroup(groupId: string, entries: ManagedHistoryEntry[]): void {
    this.parkedGroups.set(groupId, entries);
  }

  removeParkedGroup(groupId: string): void {
    this.parkedGroups.delete(groupId);
  }

  getEntries(): ManagedHistoryEntry[] {
    return [
      ...this.initialTrimEntries,
      ...[...this.parkedGroups.values()].flat(),
    ].sort((left, right) => right.turnIndex - left.turnIndex);
  }

  findEntry(entryId: string): ManagedHistoryEntry | undefined {
    return this.getEntries().find((entry) => entry.id === entryId);
  }

  search(query: string): ManagedHistoryMatch[] {
    const normalizedQuery = query.trim().toLowerCase();
    const entries = this.getEntries();

    return entries
      .filter((entry) => normalizedQuery.length === 0 || entry.text.toLowerCase().includes(normalizedQuery))
      .map((entry) => ({
        entryId: entry.id,
        source: entry.source,
        role: entry.role,
        turnIndex: entry.turnIndex,
        turnId: entry.turnId,
        groupId: entry.groupId,
        excerpt: createExcerpt(entry.text, normalizedQuery),
      }));
  }

  static createParkedEntry(input: {
    groupId: string;
    turnId: string;
    turnIndex: number;
    role: TurnRole;
    parts: string[];
  }): ManagedHistoryEntry {
    const parts = input.parts.map((part) => part.trim()).filter((part) => part.length > 0);
    return {
      id: `parked:${input.turnId}`,
      source: 'parked-group',
      role: input.role,
      turnIndex: input.turnIndex,
      turnId: input.turnId,
      groupId: input.groupId,
      parts,
      text: buildText(parts),
    };
  }
}
