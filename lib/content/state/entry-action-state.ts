import type { ManagedHistoryEntry, ManagedHistoryGroup } from '../../shared/types';

import {
  getArchiveEntrySelectionKey,
  type ArchiveEntryAction,
  type EntryActionAvailability,
  type EntryActionAvailabilityMap,
  type EntryActionLane,
  type EntryActionSelection,
  type EntryActionTemplateMap,
  type HostActionTemplateSnapshot,
} from '../core/message-actions';
import { isSupplementalHistoryEntry } from '../core/managed-history';

export function shouldResolveEntryMetadataForGroup(group: ManagedHistoryGroup): boolean {
  return group.expanded;
}

export function buildEntryActionTemplateMap(
  templatesByLane: ReadonlyMap<EntryActionLane, HostActionTemplateSnapshot>,
): EntryActionTemplateMap {
  return Object.fromEntries(templatesByLane);
}

export function buildEntryActionAvailabilityMap(
  groups: ManagedHistoryGroup[],
  options: {
    resolveHostArchiveActionBinding(
      groupId: string,
      entry: ManagedHistoryEntry,
      action: ArchiveEntryAction,
    ): unknown;
    canUseBackendFeedbackForEntry(groupId: string, entry: ManagedHistoryEntry): boolean;
  },
): {
  availability: EntryActionAvailabilityMap;
  activeEntryIds: Set<string>;
} {
  const availability: EntryActionAvailabilityMap = {};
  const activeEntryIds = new Set<string>();
  
  // 本地缓存，避免对同一个 entry-action 组合重复调用 resolveHostArchiveActionBinding
  const bindingCache = new Map<string, unknown>();
  
  const getCachedBinding = (groupId: string, entry: ManagedHistoryEntry, action: ArchiveEntryAction): unknown => {
    const cacheKey = `${groupId}:${entry.id}:${action}`;
    const cached = bindingCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = options.resolveHostArchiveActionBinding(groupId, entry, action);
    bindingCache.set(cacheKey, result);
    return result;
  };

  for (const group of groups) {
    for (const entry of group.entries) {
      const entryKey = getArchiveEntrySelectionKey(entry);
      activeEntryIds.add(entryKey);
      if (isSupplementalHistoryEntry(entry)) {
        availability[entryKey] = {
          copy: 'unavailable',
          like: 'unavailable',
          dislike: 'unavailable',
          share: 'unavailable',
          more: 'unavailable',
        };
        continue;
      }

      const assistantActionBinding = (action: ArchiveEntryAction): EntryActionAvailability['copy'] =>
        entry.role === 'assistant' && getCachedBinding(group.id, entry, action) != null
          ? 'host-bound'
          : 'unavailable';
      const feedbackActionMode = (action: EntryActionSelection): EntryActionAvailability['copy'] =>
        entry.role === 'assistant' && getCachedBinding(group.id, entry, action) != null
          ? 'host-bound'
          : options.canUseBackendFeedbackForEntry(group.id, entry)
            ? 'local-fallback'
            : 'unavailable';
      const copyMode: EntryActionAvailability['copy'] =
        getCachedBinding(group.id, entry, 'copy') != null ? 'host-bound' : 'local-fallback';

      availability[entryKey] = {
        copy: copyMode,
        like: feedbackActionMode('like'),
        dislike: feedbackActionMode('dislike'),
        share: assistantActionBinding('share'),
        more: entry.role === 'assistant' ? 'local-fallback' : 'unavailable',
      };
    }
  }

  return { availability, activeEntryIds };
}
