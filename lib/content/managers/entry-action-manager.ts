import type { StatusBar } from './status-bar';
import type { ManagedHistoryStore } from '../core/managed-history';
import type { ArchivePager } from './archive-pager';
import type { ReadAloudManager } from './read-aloud-manager';
import type {
  EntryActionSelection,
  EntryActionMenuSelection,
  EntryActionLane,
  HostActionTemplateSnapshot,
  ArchiveEntryAction,
  EntryMoreMenuAction,
} from '../core/message-actions';
import type { TurnRecord, ManagedHistoryEntry, ManagedHistoryGroup } from '../../shared/types';
import {
  findHostMoreMenuAction as findHostMoreMenuActionInMenu,
  readHostEntryActionSelection as readHostEntryActionSelectionFromRoots,
} from '../host-integration/host-more-menu-actions';
import {
  findHostMessageIdForEntryInScope,
  findRenderedArchiveMessageIdFromActionAnchor,
} from '../host-integration/host-message-id-resolver';
import { doesHostActionButtonMatchEntry as doesHostActionButtonMatchArchiveEntry } from '../host-integration/host-action-matching';
import { buildEntryActionAvailabilityMap, buildEntryActionTemplateMap } from './entry-action-state';
import { resolveArchiveCopyText } from '../core/message-actions';

export interface EntryActionManagerOptions {
  win: Window;
  doc: Document;
  statusBar: StatusBar | null;
  managedHistory: ManagedHistoryStore;
  archivePager: ArchivePager;
  readAloudManager: ReadAloudManager;
  onMenuChange: (menu: EntryActionMenuSelection | null) => void;
  onCopiedFeedback: (entryKey: string | null, schedule: boolean) => void;
  onClearReadAloudPlayback: (options: { updateStatusBar: boolean }) => void;
  onUpdateStatusBar: () => void;
  onIncrementDebugCounter: (action: 'share' | 'branch' | 'read-aloud' | 'stop-read-aloud') => void;
  getArchiveState: () => {
    currentPageGroups: ManagedHistoryGroup[];
    currentArchivePageIndex: number | null;
  };
  getInitialTrimSession: () => { archivedTurnCount: number } | null;
  getRecordForEntry: (entry: ManagedHistoryEntry) => TurnRecord | null;
  normalizeEntryText: (text: string) => string;
}

export class EntryActionManager {
  private readonly win: Window;
  private readonly doc: Document;
  private readonly statusBar: StatusBar | null;
  private readonly managedHistory: ManagedHistoryStore;
  private readonly archivePager: ArchivePager;
  private readonly readAloudManager: ReadAloudManager;
  private readonly callbacks: Pick<
    EntryActionManagerOptions,
    'onMenuChange' | 'onCopiedFeedback' | 'onClearReadAloudPlayback' | 
    'onUpdateStatusBar' | 'onIncrementDebugCounter' | 'getArchiveState' | 
    'getInitialTrimSession' | 'getRecordForEntry' | 'normalizeEntryText'
  >;

  readonly selectionByEntryId = new Map<string, EntryActionSelection>();
  readonly templateByLane = new Map<EntryActionLane, HostActionTemplateSnapshot>();
  readonly hostMessageIdCache = new Map<string, string>();
  private currentMenu: EntryActionMenuSelection | null = null;
  private suppressMenuToggle = false;
  private suppressMenuDismissal = false;
  private readAloudMenuSelection: EntryActionMenuSelection | null = null;
  private copiedEntryKey: string | null = null;
  private copiedResetHandle: number | null = null;

  constructor(options: EntryActionManagerOptions) {
    this.win = options.win;
    this.doc = options.doc;
    this.statusBar = options.statusBar;
    this.managedHistory = options.managedHistory;
    this.archivePager = options.archivePager;
    this.readAloudManager = options.readAloudManager;
    this.callbacks = {
      onMenuChange: options.onMenuChange,
      onCopiedFeedback: options.onCopiedFeedback,
      onClearReadAloudPlayback: options.onClearReadAloudPlayback,
      onUpdateStatusBar: options.onUpdateStatusBar,
      onIncrementDebugCounter: options.onIncrementDebugCounter,
      getArchiveState: options.getArchiveState,
      getInitialTrimSession: options.getInitialTrimSession,
      getRecordForEntry: options.getRecordForEntry,
      normalizeEntryText: options.normalizeEntryText,
    };
  }

    reset(): void {
    this.selectionByEntryId.clear();
    this.templateByLane.clear();
    this.hostMessageIdCache.clear();
    this.currentMenu = null;
    this.readAloudMenuSelection = null;
    this.clearCopiedEntryFeedback(false);
  }

    // Menu Management
  toggleMenu(groupId: string, entryId: string, lane: EntryActionLane): void {
    const nextMenu =
      this.currentMenu?.groupId === groupId &&
      this.currentMenu?.entryId === entryId &&
      this.currentMenu?.lane === lane
        ? null
        : { groupId, entryId, lane };

    if (this.suppressMenuToggle && nextMenu == null) return;

    this.currentMenu = nextMenu;
    this.callbacks.onMenuChange(nextMenu);
    this.callbacks.onUpdateStatusBar();
  }

  closeMenu(): void {
    if (this.currentMenu == null) return;
    this.currentMenu = null;
    this.callbacks.onMenuChange(null);
    this.callbacks.onUpdateStatusBar();
  }

  shouldCloseMenu(target: Node | null): boolean {
    if (this.currentMenu == null || !(target instanceof Element)) {
      return this.currentMenu != null;
    }

    const menuRoot = target.closest<HTMLElement>('[data-turbo-render-entry-menu="true"]');
    if (menuRoot != null) return false;

    const moreButton = target.closest<HTMLElement>(
      `button[data-turbo-render-action="more"][data-group-id="${this.currentMenu.groupId}"][data-entry-key="${this.currentMenu.entryId}"]`,
    );
    return moreButton == null;
  }

  async runWithSuppressedDismissal<T>(callback: () => Promise<T> | T): Promise<T> {
    const previous = this.suppressMenuDismissal;
    this.suppressMenuDismissal = true;
    try {
      return await callback();
    } finally {
      this.suppressMenuDismissal = previous;
    }
  }

    getCurrentMenu(): EntryActionMenuSelection | null {
    return this.currentMenu;
  }

  setCurrentMenu(menu: EntryActionMenuSelection | null): void {
    this.currentMenu = menu;
    this.callbacks.onMenuChange(menu);
  }

  isMenuOpenFor(groupId: string, entryId: string, lane: EntryActionLane): boolean {
    return this.currentMenu?.groupId === groupId &&
           this.currentMenu?.entryId === entryId &&
           this.currentMenu?.lane === lane;
  }

  isSuppressingDismissal(): boolean {
    return this.suppressMenuDismissal;
  }

  setSuppressMenuDismissal(value: boolean): void {
    this.suppressMenuDismissal = value;
  }

  // ReadAloud Menu

    // Copied Feedback

    clearCopiedEntryFeedback(schedule: boolean): void {
    if (this.copiedResetHandle != null) {
      this.win.clearTimeout(this.copiedResetHandle);
      this.copiedResetHandle = null;
    }
    this.copiedEntryKey = null;
    if (schedule) {
      this.callbacks.onCopiedFeedback(null);
    }
  }

    // Entry Action Resolution - delegated to controller for complex logic

  // Host search roots collection for external use
  collectHostSearchRootsForEntry(groupId: string, entry: ManagedHistoryEntry, groups: ManagedHistoryGroup[]): HTMLElement[] {
    const group = groups.find((g) => g.id === groupId);

    const messageIds = [
      this.findRenderedMessageId(groupId, entry),
      entry.messageId,
      entry.liveTurnId,
      entry.turnId,
    ].filter((id): id is string => id != null && id.length > 0);

    const roots: HTMLElement[] = [];
    for (const messageId of [...new Set(messageIds)]) {
      const node = this.doc.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
      if (node != null) roots.push(node);
    }

    if (group != null && this.statusBar != null) {
      const batchAnchor = this.statusBar.getBatchCardHeaderAnchor(group.id);
      if (batchAnchor != null) roots.push(batchAnchor);
    }

    return roots.length > 0 ? roots : [this.doc.body ?? this.doc.documentElement].filter(Boolean) as HTMLElement[];
  }

  // Message ID Resolution
  findRenderedMessageId(groupId: string | null, entry: ManagedHistoryEntry): string | null {
    if (groupId == null || this.statusBar == null) return null;
    const actionAnchor = this.statusBar.getEntryActionAnchor(groupId, entry.id);
    return findRenderedArchiveMessageIdFromActionAnchor(entry, actionAnchor);
  }

    // Host Action Binding

    // Host Menu Actions

  // Copy Text Resolution

    // Selection Management
  setSelection(entryKey: string, selection: EntryActionSelection | null): void {
    if (selection == null) {
      this.selectionByEntryId.delete(entryKey);
    } else {
      this.selectionByEntryId.set(entryKey, selection);
    }
  }

    deleteSelection(entryKey: string): boolean {
    return this.selectionByEntryId.delete(entryKey);
  }

    getSelectionEntries(): IterableIterator<[string, EntryActionSelection]> {
    return this.selectionByEntryId.entries();
  }

  pruneSelections(activeEntryIds: Set<string>): void {
    for (const entryId of [...this.selectionByEntryId.keys()]) {
      if (!activeEntryIds.has(entryId)) {
        this.selectionByEntryId.delete(entryId);
      }
    }
  }

  // Template Management
  captureTemplate(lane: EntryActionLane, template: HostActionTemplateSnapshot): void {
    this.templateByLane.set(lane, template);
  }

    hasTemplate(lane: EntryActionLane): boolean {
    return this.templateByLane.has(lane);
  }

  getTemplates(): Map<EntryActionLane, HostActionTemplateSnapshot> {
    return this.templateByLane;
  }

  // Host Message ID Cache

}
