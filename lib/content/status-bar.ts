import { TURBO_RENDER_UI_ROOT_ATTRIBUTE, UI_CLASS_NAMES } from '../shared/constants';
import { getChatIdFromPathname, getRouteIdFromRuntimeId } from '../shared/chat-id';
import { buildInteractionPairs } from '../shared/interaction-pairs';
import { createTranslator, type Translator } from '../shared/i18n';
import type {
  ArchivePageMeta,
  HistoryAnchorMode,
  ManagedHistoryEntry,
  ManagedHistoryGroup,
  TabRuntimeStatus,
} from '../shared/types';

import type {
  ArchiveEntryAction,
  EntryActionAvailability,
  EntryActionAvailabilityMap,
  EntryActionMenuSelection,
  EntryActionRequest,
  EntryActionSelection,
  EntryActionTemplateMap,
  EntryActionSelectionMap,
  EntryMoreMenuAction,
  HostActionTemplateSnapshot,
} from './message-actions';
import {
  ENTRY_ACTION_LANE,
  findHostActionButton,
  getArchiveEntrySelectionKey,
  instantiateHostActionTemplate,
  isEntryActionEnabled,
} from './message-actions';
import { renderManagedHistoryEntryBody } from './history-entry-renderer';
import { isSupplementalHistoryEntry, resolvePreferredMessageId } from './managed-history';
import type { ArchivePageMatch } from '../shared/types';

export interface StatusBarState {
  conversationId: string | null;
  archivePageCount: number;
  currentArchivePageIndex: number | null;
  currentArchivePageMeta: ArchivePageMeta | null;
  isRecentView: boolean;
  archiveGroups: ManagedHistoryGroup[];
  archiveSearchOpen: boolean;
  archiveSearchQuery: string;
  archiveSearchResults: ArchivePageMatch[];
  activeArchiveSearchPageIndex: number | null;
  activeArchiveSearchPairIndex: number | null;
  collapsedBatchCount: number;
  expandedBatchCount: number;
  entryActionAvailability: EntryActionAvailabilityMap;
  entryActionSelection: EntryActionSelectionMap;
  entryActionTemplates: EntryActionTemplateMap;
  entryHostMessageIds: Record<string, string>;
  entryActionMenu: EntryActionMenuSelection | null;
  entryActionSpeakingEntryKey: string | null;
  entryActionCopiedEntryKey: string | null;
  showShareActions: boolean;
  preferHostMorePopover: boolean;
}

export interface StatusBarActions {
  onOpenNewestArchivePage(): void;
  onGoOlderArchivePage(): void;
  onGoNewerArchivePage(): void;
  onGoToRecentArchiveView(): void;
  onToggleArchiveSearch(): void;
  onArchiveSearchQueryChange(query: string): void;
  onClearArchiveSearch(): void;
  onOpenArchiveSearchResult(result: ArchivePageMatch): void;
  onToggleArchiveGroup(groupId: string, anchor: HTMLElement | null): void;
  onEntryAction(request: EntryActionRequest): void;
  onMoreMenuAction(request: {
    groupId: string;
    entryId: string;
    action: EntryMoreMenuAction;
  }): void;
}

interface BatchCardView {
  root: HTMLElement;
  main: HTMLElement;
  header: HTMLElement;
  meta: HTMLElement;
  summary: HTMLElement;
  rail: HTMLElement;
  button: HTMLButtonElement;
  preview: HTMLElement;
  entries: HTMLElement;
  previewKey: string;
  entriesKey: string;
  entriesRendered: boolean;
  expanded: boolean;
}

const STYLE_ID = 'turbo-render-style';
const INLINE_ROOT_ATTRIBUTE = 'data-turbo-render-inline-history-root';
const SVG_NS = 'http://www.w3.org/2000/svg';
const ENTRY_ACTION_TEST_IDS: Record<ArchiveEntryAction, string> = {
  copy: 'copy-turn-action-button',
  like: 'good-response-turn-action-button',
  dislike: 'bad-response-turn-action-button',
  share: 'share-turn-action-button',
  more: 'more-turn-action-button',
};
const STYLES = `
.${UI_CLASS_NAMES.inlineHistoryRoot} {
  display: grid;
  gap: 10px;
  margin: 0 0 12px;
  padding: 0 8px 0 0;
}

.${UI_CLASS_NAMES.inlineHistoryRoot} > * {
  width: min(100%, 920px);
  margin-inline: auto;
}

.${UI_CLASS_NAMES.inlineHistoryToolbar} {
  display: grid;
  gap: 6px;
  padding: 10px 0 8px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  background: transparent;
  color: #0f172a;
  box-shadow: none;
  font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.inlineHistoryBoundary} {
  align-items: start;
}

.${UI_CLASS_NAMES.inlineHistorySearch} {
  display: grid;
  gap: 8px;
}

.${UI_CLASS_NAMES.inlineHistorySummary},
.${UI_CLASS_NAMES.inlineBatchMeta},
.${UI_CLASS_NAMES.inlineBatchPreview},
.${UI_CLASS_NAMES.inlineBatchMatches},
.${UI_CLASS_NAMES.historyEntryMeta} {
  margin: 0;
  color: #64748b;
}

.${UI_CLASS_NAMES.inlineHistoryBoundaryActions} {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.${UI_CLASS_NAMES.inlineHistoryBoundaryButton} {
  appearance: none;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 999px;
  background: #ffffff;
  color: #0f172a;
  cursor: pointer;
  padding: 7px 11px;
  font: inherit;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}

.${UI_CLASS_NAMES.inlineHistoryBoundaryButton}:disabled {
  cursor: default;
  opacity: 0.5;
}

.${UI_CLASS_NAMES.inlineHistorySearch} input {
  width: 100%;
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  color: #0f172a;
  font: inherit;
}

.${UI_CLASS_NAMES.inlineHistorySearchPanel} {
  display: grid;
  gap: 8px;
  padding: 4px 0 2px;
}

.${UI_CLASS_NAMES.inlineHistorySearchPanel}[hidden] {
  display: none !important;
}

.${UI_CLASS_NAMES.inlineHistorySearchHeader} {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
}

.${UI_CLASS_NAMES.inlineHistorySearchResults} {
  display: grid;
  gap: 8px;
}

.${UI_CLASS_NAMES.inlineHistorySearchResult} {
  appearance: none;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.94);
  color: #0f172a;
  cursor: pointer;
  padding: 10px 12px;
  text-align: left;
  display: grid;
  gap: 4px;
  font: inherit;
}

.${UI_CLASS_NAMES.inlineHistorySearchResultActive} {
  border-color: rgba(37, 99, 235, 0.36);
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.18) inset;
  background: rgba(239, 246, 255, 0.98);
}

.${UI_CLASS_NAMES.inlineHistorySearchResultMeta} {
  color: #334155;
  font-weight: 600;
}

.${UI_CLASS_NAMES.inlineHistorySearchResultExcerpt} {
  color: #64748b;
}

.${UI_CLASS_NAMES.inlineBatchCard} {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  column-gap: 12px;
  gap: 14px;
  padding: 14px 16px 12px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
  font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow-anchor: none;
}

.${UI_CLASS_NAMES.inlineBatchCard}[data-state="expanded"] {
  background: transparent;
  box-shadow: none;
  position: relative;
  padding: 14px 16px 0;
  column-gap: 12px;
}

.${UI_CLASS_NAMES.inlineBatchMain} {
  display: grid;
  gap: 8px;
  min-width: 0;
  width: 100%;
  grid-column: 1;
  overflow-anchor: none;
}

.${UI_CLASS_NAMES.inlineBatchHeader} {
  display: grid;
  align-items: start;
  gap: 6px;
  min-width: 0;
  position: relative;
  z-index: 1;
  padding: 2px 0 0;
  overflow-anchor: none;
}

.${UI_CLASS_NAMES.inlineBatchMeta} {
  display: grid;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
}

.${UI_CLASS_NAMES.inlineBatchMeta} strong {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}

.${UI_CLASS_NAMES.inlineBatchPreview} {
  display: grid;
  gap: 2px;
  color: #475569;
}

.${UI_CLASS_NAMES.inlineBatchPreview}[hidden],
.${UI_CLASS_NAMES.inlineBatchEntries}[hidden] {
  display: none !important;
}

.${UI_CLASS_NAMES.inlineBatchMatches} {
  color: #2563eb;
  font-weight: 600;
}

.${UI_CLASS_NAMES.inlineBatchRail} {
  display: block;
  align-self: stretch;
  min-width: max-content;
  grid-column: 2;
  grid-row: 1 / -1;
  padding-top: 2px;
  text-align: right;
  overflow-anchor: none;
}

.${UI_CLASS_NAMES.inlineBatchAction} {
  appearance: none;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 999px;
  background: #ffffff;
  color: #0f172a;
  cursor: pointer;
  padding: 7px 11px;
  font: inherit;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
  position: sticky;
  top: calc(var(--turbo-render-page-header-offset, 0px) + 12px);
  align-self: start;
  margin-inline-start: auto;
}

.${UI_CLASS_NAMES.inlineBatchEntries} {
  display: grid;
  gap: 12px;
  min-width: 0;
  width: 100%;
  padding-top: 0;
  padding-inline: 0;
  overflow-anchor: none;
}

.${UI_CLASS_NAMES.inlineBatchEntry} {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr);
  justify-items: stretch;
  width: 100%;
  padding-top: 12px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}

.${UI_CLASS_NAMES.inlineBatchEntry}:first-child {
  padding-top: 0;
  border-top: 0;
}

.${UI_CLASS_NAMES.historyEntryFrame} {
  display: grid;
  gap: 6px;
  min-width: 0;
  width: min(100%, 48rem);
  max-width: 100%;
  justify-self: center;
  align-items: start;
}

.${UI_CLASS_NAMES.historyEntryFrame}[data-lane="assistant"] {
  justify-items: start;
}

.${UI_CLASS_NAMES.historyEntryFrame}[data-lane="user"] {
  justify-items: end;
}

.${UI_CLASS_NAMES.historyEntryBody} {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-lane="user"] {
  justify-self: end;
  align-self: start;
  width: fit-content;
  max-width: min(68ch, 100%);
  padding: 12px 16px;
  border-radius: 18px;
  background: rgba(243, 244, 246, 0.96);
  border: 0;
  box-shadow: none;
  color: #0f172a;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-lane="assistant"] {
  justify-self: start;
  align-self: start;
  width: 100%;
  max-width: none;
  color: #0f172a;
}

.${UI_CLASS_NAMES.historyEntryActions} {
  --turbo-render-action-edge-inset: 0px;
  position: relative;
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: fit-content;
  max-width: 100%;
  white-space: nowrap;
  overflow-anchor: none;
}

.${UI_CLASS_NAMES.historyEntryActions}[data-lane="user"] {
  justify-self: end;
  align-self: start;
  margin-inline-start: 0;
  margin-inline-end: var(--turbo-render-action-edge-inset, 0px);
}

.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"] {
  justify-self: start;
  align-self: start;
  margin-inline-start: var(--turbo-render-action-edge-inset, 0px);
  margin-inline-end: 0;
}

.${UI_CLASS_NAMES.historyEntryActions}[data-action-mount="host-slot"] {
  margin-inline-start: 0 !important;
  margin-inline-end: 0 !important;
}

.${UI_CLASS_NAMES.historyEntryActions} [data-turbo-render-template-wrapper="true"],
.${UI_CLASS_NAMES.historyEntryActions} button[data-turbo-render-action],
.${UI_CLASS_NAMES.historyEntryActions} [role="button"][data-turbo-render-action] {
  opacity: 1 !important;
  visibility: visible !important;
  pointer-events: auto !important;
}

.${UI_CLASS_NAMES.historyEntryActions} [data-turbo-render-template-wrapper="true"] {
  flex-wrap: nowrap !important;
  row-gap: 0 !important;
  width: max-content !important;
  max-width: none !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
  -webkit-mask-size: auto !important;
  mask-size: auto !important;
  -webkit-mask-position: 0 0 !important;
  mask-position: 0 0 !important;
}

.${UI_CLASS_NAMES.historyEntryActions}[data-menu-open="true"] {
  z-index: 2;
}

.${UI_CLASS_NAMES.historyEntryAction} {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-token-text-secondary, #6b7280);
  cursor: pointer;
  line-height: 0;
  box-shadow: none;
  transition: background-color 120ms ease, color 120ms ease;
}

.${UI_CLASS_NAMES.historyEntryActionMenuAnchor} {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
}

.${UI_CLASS_NAMES.historyEntryActionMenuAnchor} > button {
  flex: 0 0 auto;
}

.${UI_CLASS_NAMES.historyEntryAction}:hover {
  background: var(--token-bg-secondary, rgba(15, 23, 42, 0.06));
  color: var(--text-token-text-primary, #111827);
}

.${UI_CLASS_NAMES.historyEntryAction}:focus-visible {
  outline: 2px solid rgba(59, 130, 246, 0.45);
  outline-offset: 2px;
}

.${UI_CLASS_NAMES.historyEntryAction}[aria-pressed="true"] {
  color: #111827;
}

button[data-turbo-render-action][aria-pressed="true"] {
  color: #111827 !important;
}

button[data-turbo-render-action="copy"][data-copy-state="copied"] {
  color: #16a34a !important;
}

.${UI_CLASS_NAMES.historyEntryAction} svg {
  width: 16px;
  height: 16px;
  display: block;
  pointer-events: none;
}

.${UI_CLASS_NAMES.historyEntryAction}:disabled {
  cursor: default;
  opacity: 0.45;
  background: transparent;
}

.${UI_CLASS_NAMES.historyEntryActionMenu} {
  position: absolute;
  bottom: auto;
  left: 0;
  right: auto;
  top: calc(100% + 8px);
  z-index: 50;
  display: grid;
  gap: 0;
  min-width: 188px;
  max-width: min(320px, calc(100vw - 16px));
  padding: 6px;
  border: 0;
  border-radius: 16px;
  background: var(--token-main-surface-primary, rgba(255, 255, 255, 0.98));
  color: var(--text-token-text-primary, #0f172a);
  box-shadow: var(--shadow-long, 0 12px 30px rgba(15, 23, 42, 0.16));
  overflow-anchor: none;
}

.${UI_CLASS_NAMES.historyEntryActionMenu}[data-popover-position="fixed"] {
  position: fixed;
}

.${UI_CLASS_NAMES.historyEntryActionMenu}[data-lane="user"] {
  display: none;
}

.${UI_CLASS_NAMES.historyEntryActionMenuHeader} {
  padding: 6px 8px 8px;
  color: var(--text-token-text-secondary, #64748b);
  font-size: 12px;
  line-height: 1.35;
  white-space: nowrap;
}

.${UI_CLASS_NAMES.historyEntryActionMenuItem} {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  min-width: 0;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-token-text-primary, #0f172a);
  cursor: pointer;
  font: 14px/20px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-align: left;
}

.${UI_CLASS_NAMES.historyEntryActionMenuItem}:hover {
  background: var(--token-bg-secondary, rgba(15, 23, 42, 0.06));
}

.${UI_CLASS_NAMES.historyEntryActionMenuItem}:focus-visible {
  outline: 2px solid rgba(59, 130, 246, 0.45);
  outline-offset: 2px;
}

.${UI_CLASS_NAMES.historyEntryActions} > button {
  flex: 0 0 auto;
}

.${UI_CLASS_NAMES.historyEntryActions} :is(svg, path, circle, rect) {
  pointer-events: none;
}

.${UI_CLASS_NAMES.historyEntryActions} button[data-turbo-render-action] svg {
  width: 16px !important;
  height: 16px !important;
  flex: 0 0 16px;
  display: block;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="host-snapshot"] {
  display: block;
  gap: 0;
  justify-self: stretch;
  align-self: stretch;
  width: 100%;
  max-width: none;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="host-snapshot"][data-lane="user"] {
  justify-self: end;
  align-self: start;
  width: fit-content;
  max-width: min(68ch, 100%);
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="host-snapshot"] > :first-child {
  margin-inline: 0 !important;
  padding-inline: 0 !important;
  max-width: none !important;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="host-snapshot"] > :first-child > :first-child {
  margin-inline: 0 !important;
  max-width: none !important;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="host-snapshot"][data-lane="user"] > :first-child,
.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="host-snapshot"][data-lane="user"] > :first-child > :first-child {
  width: fit-content !important;
  max-width: 100% !important;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  width: 100%;
  max-width: none;
  align-self: start;
  justify-self: stretch;
  color: #0f172a;
  font-size: 16px;
  line-height: 24px;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .markdown {
  width: 100%;
  max-width: none;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .markdown pre {
  margin: 10px 0;
  padding: 14px 16px;
  max-width: 100%;
  overflow: auto;
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 13px;
  line-height: 1.55;
  font-family: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
  white-space: pre;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .markdown pre code {
  display: block;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: inherit;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .markdown code:not(pre code) {
  padding: 0.12em 0.32em;
  border-radius: 0.35em;
  background: rgba(15, 23, 42, 0.08);
  color: #0f172a;
  font-family: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.88em;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .turbo-render-code-block {
  display: grid;
  gap: 0;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .turbo-render-code-language {
  width: fit-content;
  margin: 8px 0 -2px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  color: #475569;
  font: 12px/18px ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .turbo-render-markdown-table-scroll {
  max-width: 100%;
  overflow-x: auto;
  margin: 10px 0;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .markdown table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95em;
  line-height: 1.45;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .markdown th,
.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .markdown td {
  border: 1px solid rgba(148, 163, 184, 0.38);
  padding: 8px 10px;
  vertical-align: top;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .markdown th {
  background: rgba(241, 245, 249, 0.78);
  color: #0f172a;
  font-weight: 600;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .markdown [data-turbo-render-citation="true"] {
  display: inline-flex;
  align-items: center;
  margin-inline: 2px;
  padding: 0 4px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
  font-size: 0.68em;
  font-weight: 600;
  line-height: 1.45;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] .markdown [data-turbo-render-citation="true"] a {
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"][data-lane="user"] {
  justify-self: stretch;
  align-self: stretch;
  width: 100%;
  max-width: none;
  padding: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
  white-space: normal;
  overflow-wrap: normal;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"][data-lane="user"] .user-message-bubble-color {
  max-width: min(70%, 68ch);
  background: rgba(243, 244, 246, 0.96);
  color: #0f172a;
}

@media (max-width: 720px) {
  .${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"][data-lane="user"] .user-message-bubble-color {
    max-width: 100%;
  }
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="structured-message"] pre {
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  overflow: auto;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.5;
  font-family: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="structured-message"] {
  display: grid;
  gap: 4px;
  min-width: 0;
  width: 100%;
  color: #475569;
  font-size: 12px;
  line-height: 1.55;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="structured-message"] details {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="structured-message"] summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
  cursor: pointer;
  list-style: none;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  color: #334155;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="structured-message"] summary::-webkit-details-marker {
  display: none;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="structured-message"] summary::marker {
  content: '';
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="structured-message"] details[open] summary {
  margin-bottom: 2px;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="host-snapshot"] :is(button, input, textarea, select):not([data-turbo-render-action]):not([data-turbo-render-menu-action]) {
  pointer-events: none !important;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-supplemental-role] {
  padding-top: 8px;
  border-top: 1px dashed rgba(15, 23, 42, 0.08);
}

.${UI_CLASS_NAMES.historyEntryBody}[data-supplemental-role] pre {
  background: rgba(15, 23, 42, 0.04);
  color: #0f172a;
  border: 1px solid rgba(15, 23, 42, 0.08);
  padding: 10px 12px;
}

.${UI_CLASS_NAMES.inlineBatchHighlight},
.${UI_CLASS_NAMES.transcriptHighlight} {
  outline: 2px solid rgba(59, 130, 246, 0.42);
  outline-offset: 3px;
  background: rgba(219, 234, 254, 0.44) !important;
}

.${UI_CLASS_NAMES.inlineBatchSearchHighlight} {
  outline: 2px solid rgba(14, 165, 233, 0.72);
  outline-offset: 4px;
  background: rgba(186, 230, 253, 0.56) !important;
}

.${UI_CLASS_NAMES.softFolded} {
  display: none !important;
  pointer-events: none !important;
}

@media (max-width: 720px) {
  .${UI_CLASS_NAMES.inlineBatchCard} {
    gap: 12px;
  }

  .${UI_CLASS_NAMES.inlineBatchHeader} {
    gap: 10px;
  }

  .${UI_CLASS_NAMES.historyEntryBody}[data-lane="assistant"] {
    width: 100%;
  }
}
`;

function createSvgIcon(doc: Document, action: ArchiveEntryAction): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const commonStroke = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'stroke-width': '1.6',
  } as const;

  switch (action) {
    case 'copy': {
      const back = doc.createElementNS(SVG_NS, 'rect');
      back.setAttribute('x', '7');
      back.setAttribute('y', '5');
      back.setAttribute('width', '8');
      back.setAttribute('height', '8');
      back.setAttribute('rx', '1.6');
      Object.entries(commonStroke).forEach(([name, value]) => back.setAttribute(name, value));

      const front = doc.createElementNS(SVG_NS, 'rect');
      front.setAttribute('x', '4');
      front.setAttribute('y', '8');
      front.setAttribute('width', '8');
      front.setAttribute('height', '8');
      front.setAttribute('rx', '1.6');
      Object.entries(commonStroke).forEach(([name, value]) => front.setAttribute(name, value));

      svg.append(back, front);
      return svg;
    }
    case 'like':
    case 'dislike': {
      const thumb = doc.createElementNS(SVG_NS, 'path');
      thumb.setAttribute(
        'd',
        'M5.5 9.8h2.2V17H5.5V9.8Zm3.1-1.3 1.4-4.7h2.2l-.6 4.7H16l-1 6H8.2c-.6 0-1.1-.5-1.1-1.1V8.5Z',
      );
      Object.entries(commonStroke).forEach(([name, value]) => thumb.setAttribute(name, value));
      if (action === 'dislike') {
        thumb.setAttribute('transform', 'translate(20 20) scale(-1 -1)');
      }
      svg.append(thumb);
      return svg;
    }
    case 'share': {
      const arrow = doc.createElementNS(SVG_NS, 'path');
      arrow.setAttribute('d', 'M10 4.5v8.2M6.6 7.9 10 4.5l3.4 3.4M4.5 11.8V15a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3.2');
      Object.entries(commonStroke).forEach(([name, value]) => arrow.setAttribute(name, value));
      svg.append(arrow);
      return svg;
    }
    case 'more': {
      for (const cx of [6, 10, 14]) {
        const dot = doc.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(cx));
        dot.setAttribute('cy', '10');
        dot.setAttribute('r', '1.1');
        dot.setAttribute('fill', 'currentColor');
        svg.append(dot);
      }
      return svg;
    }
  }
}

function createCheckIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.width = '16px';
  svg.style.height = '16px';
  svg.style.display = 'block';

  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M4.5 10.5 8.2 14 15.5 6');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-width', '1.8');
  svg.append(path);

  return svg;
}

function ensureTurboRenderStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID) != null) {
    return;
  }

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.append(style);
}

function getSlotSummaryText(t: Translator, group: ManagedHistoryGroup): string {
  return t('historyBatchSummary', {
    start: group.slotPairStartIndex + 1,
    end: group.slotPairEndIndex + 1,
  });
}

function getFilledSummaryText(t: Translator, group: ManagedHistoryGroup): string {
  if (group.filledPairCount >= group.capacity) {
    return getSlotSummaryText(t, group);
  }
  return `${getSlotSummaryText(t, group)} · ${group.filledPairCount}/${group.capacity}`;
}

export class StatusBar {
  private root: HTMLElement | null = null;
  private groupsRoot: HTMLElement | null = null;
  private currentStatus: TabRuntimeStatus | null = null;
  private currentState: StatusBarState | null = null;
  private currentConversationId: string | null = null;
  private readonly groupViews = new Map<string, BatchCardView>();
  private forceRender = true;
  private t: Translator = createTranslator('en');
  private cachedTopPageChromeOffset = 0;
  private pageChromeOffsetDirty = true;
  private pageChromeLayoutSignature = '';
  private resizeListenerBound = false;

  constructor(
    private readonly doc: Document,
    private readonly actions: StatusBarActions,
  ) {}

  setTranslator(translator: Translator): void {
    this.t = translator;
    this.forceRender = true;
    this.render();
  }

  getAnchorMode(): HistoryAnchorMode {
    return 'hidden';
  }

  update(status: TabRuntimeStatus, target: HTMLElement | null, state: StatusBarState): HistoryAnchorMode {
    this.currentStatus = status;
    this.currentState = state;
    const nextConversationId = state.conversationId?.trim() ?? null;
    if (nextConversationId !== this.currentConversationId) {
      this.currentConversationId = nextConversationId;
    }
    this.mount(target);
    this.render();
    return 'hidden';
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
    this.groupsRoot = null;
    this.groupViews.clear();
    if (this.resizeListenerBound) {
      this.doc.defaultView?.removeEventListener('resize', this.handleWindowResize);
      this.resizeListenerBound = false;
    }
    this.pageChromeOffsetDirty = true;
    this.pageChromeLayoutSignature = '';
  }

  focusArchive(): void {}

  focusEntry(): boolean {
    return false;
  }

  getBatchCardAnchor(groupId: string): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(
      `[data-turbo-render-batch-anchor="true"][data-group-id="${groupId}"]`,
    ) ?? null;
  }

  getBatchCardHeaderAnchor(groupId: string): HTMLElement | null {
    return (
      this.root?.querySelector<HTMLElement>(
        `[data-turbo-render-batch-anchor="true"][data-group-id="${groupId}"] .${UI_CLASS_NAMES.inlineBatchAction}`,
      ) ??
      this.root?.querySelector<HTMLElement>(
        `[data-turbo-render-batch-anchor="true"][data-group-id="${groupId}"] .${UI_CLASS_NAMES.inlineBatchHeader}`,
      ) ??
      null
    );
  }

  getBatchCardActionButton(groupId: string): HTMLButtonElement | null {
    return this.root?.querySelector<HTMLButtonElement>(
      `[data-turbo-render-batch-anchor="true"][data-group-id="${groupId}"] .${UI_CLASS_NAMES.inlineBatchAction}`,
    ) ?? null;
  }

  getBatchCardPairAnchor(groupId: string, pairIndex: number): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(
      `[data-turbo-render-batch-anchor="true"][data-group-id="${groupId}"] [data-pair-index="${pairIndex}"]`,
    ) ?? null;
  }

  getEntryActionAnchor(groupId: string, entryId: string): HTMLElement | null {
    if (this.root == null) {
      return null;
    }
    const selector = `.${UI_CLASS_NAMES.historyEntryActions}[data-group-id="${groupId}"][data-entry-id="${entryId}"]`;
    const anchors = [...this.root.querySelectorAll<HTMLElement>(selector)];
    return anchors.find((candidate) => candidate.getClientRects().length > 0) ?? anchors[0] ?? null;
  }

  getEntryActionButton(groupId: string, entryId: string, action: ArchiveEntryAction): HTMLElement | null {
    if (this.root == null) {
      return null;
    }
    const selector = `.${UI_CLASS_NAMES.historyEntryActions}[data-group-id="${groupId}"][data-entry-id="${entryId}"] button[data-turbo-render-action="${action}"]`;
    const buttons = [...this.root.querySelectorAll<HTMLElement>(selector)];
    return buttons.find((candidate) => candidate.getClientRects().length > 0) ?? buttons[0] ?? null;
  }

  getEntryBody(groupId: string, entryId: string): HTMLElement | null {
    if (this.root == null) {
      return null;
    }
    const selector = `.${UI_CLASS_NAMES.historyEntryBody}[data-group-id="${groupId}"][data-entry-id="${entryId}"]`;
    const bodies = [...this.root.querySelectorAll<HTMLElement>(selector)];
    return bodies.find((candidate) => candidate.getClientRects().length > 0) ?? bodies[0] ?? null;
  }

  getTopPageChromeOffset(): number {
    this.syncPageChromeOffset();
    return this.cachedTopPageChromeOffset;
  }

  private getBoundaryButton(action: string): HTMLButtonElement | null {
    return this.root?.querySelector<HTMLButtonElement>(`button[data-turbo-render-action="${action}"]`) ?? null;
  }

  private getSearchPanel(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(`[data-turbo-render-search-panel="true"]`) ?? null;
  }

  private getSearchInput(): HTMLInputElement | null {
    return this.root?.querySelector<HTMLInputElement>(`input[data-turbo-render-action="archive-search-input"]`) ?? null;
  }

  private getSearchSummary(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(`[data-turbo-render-search-summary="true"]`) ?? null;
  }

  private getSearchResultsRoot(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(`[data-turbo-render-search-results="true"]`) ?? null;
  }

  private mount(target: HTMLElement | null): void {
    ensureTurboRenderStyles(this.doc);
    if (target == null) {
      return;
    }

    if (this.root == null) {
      this.root = this.doc.createElement('section');
      this.root.className = UI_CLASS_NAMES.inlineHistoryRoot;
      this.root.setAttribute(INLINE_ROOT_ATTRIBUTE, 'true');
      this.root.setAttribute(TURBO_RENDER_UI_ROOT_ATTRIBUTE, 'true');
      this.root.innerHTML = `
        <div class="${UI_CLASS_NAMES.inlineHistoryToolbar} ${UI_CLASS_NAMES.inlineHistoryBoundary}">
          <p class="${UI_CLASS_NAMES.inlineHistorySummary} ${UI_CLASS_NAMES.inlineHistoryBoundarySummary}"></p>
          <div class="${UI_CLASS_NAMES.inlineHistoryBoundaryActions}">
            <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton}" data-turbo-render-action="open-archive-newest"></button>
            <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton}" data-turbo-render-action="go-archive-older"></button>
            <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton}" data-turbo-render-action="go-archive-newer"></button>
            <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton}" data-turbo-render-action="go-archive-recent"></button>
            <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton}" data-turbo-render-action="toggle-archive-search"></button>
          </div>
          <div class="${UI_CLASS_NAMES.inlineHistorySearch}">
            <div class="${UI_CLASS_NAMES.inlineHistorySearchPanel}" data-turbo-render-search-panel="true" hidden>
              <div class="${UI_CLASS_NAMES.inlineHistorySearchHeader}">
                <input type="search" class="${UI_CLASS_NAMES.inlineHistorySearchInput}" data-turbo-render-action="archive-search-input" />
                <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton} ${UI_CLASS_NAMES.inlineHistorySearchClear}" data-turbo-render-action="clear-archive-search"></button>
              </div>
              <p class="${UI_CLASS_NAMES.inlineHistorySummary}" data-turbo-render-search-summary="true"></p>
              <div class="${UI_CLASS_NAMES.inlineHistorySearchResults}" data-turbo-render-search-results="true"></div>
            </div>
          </div>
        </div>
        <div class="${UI_CLASS_NAMES.archiveGroups}"></div>
      `;
      this.groupsRoot = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.archiveGroups}`);
      this.getBoundaryButton('open-archive-newest')?.addEventListener('click', () => {
        this.actions.onOpenNewestArchivePage();
      });
      this.getBoundaryButton('go-archive-older')?.addEventListener('click', () => {
        this.actions.onGoOlderArchivePage();
      });
      this.getBoundaryButton('go-archive-newer')?.addEventListener('click', () => {
        this.actions.onGoNewerArchivePage();
      });
      this.getBoundaryButton('go-archive-recent')?.addEventListener('click', () => {
        this.actions.onGoToRecentArchiveView();
      });
      this.getBoundaryButton('toggle-archive-search')?.addEventListener('click', () => {
        this.actions.onToggleArchiveSearch();
      });
      this.getSearchInput()?.addEventListener('input', (event) => {
        const targetInput = event.currentTarget;
        if (!(targetInput instanceof HTMLInputElement)) {
          return;
        }
        this.actions.onArchiveSearchQueryChange(targetInput.value);
      });
      this.getBoundaryButton('clear-archive-search')?.addEventListener('click', () => {
        this.actions.onClearArchiveSearch();
      });
    }

    if (!this.resizeListenerBound) {
      this.doc.defaultView?.addEventListener('resize', this.handleWindowResize, { passive: true });
      this.resizeListenerBound = true;
    }

    if (this.root.parentElement !== target.parentElement || this.root.nextElementSibling !== target) {
      target.parentElement?.insertBefore(this.root, target);
      this.markPageChromeOffsetDirty();
    }
  }

  private render(): void {
    if (this.root == null || this.groupsRoot == null || this.currentState == null) {
      return;
    }

    this.syncPageChromeOffset();
    const hasArchivePages = this.currentState.archivePageCount > 0;
    const visible = hasArchivePages || this.currentState.archiveGroups.length > 0;
    this.root.hidden = !visible;
    if (!visible) {
      return;
    }

    const boundary = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineHistoryBoundary}`);
    if (boundary != null) {
      boundary.hidden = !hasArchivePages;
    }

    const summary = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineHistoryBoundarySummary}`);
    const nextSummary = !hasArchivePages
      ? this.t('historyPageEmpty')
      : this.currentState.isRecentView
        ? this.t('historyPageSummaryRecent', {
            total: this.currentState.archivePageCount,
          })
        : this.currentState.currentArchivePageMeta != null
          ? this.t('historyPageSummary', {
              page: this.currentState.currentArchivePageMeta.pageIndex + 1,
              total: this.currentState.currentArchivePageMeta.pageCount,
              start: this.currentState.currentArchivePageMeta.pairStartIndex + 1,
              end: this.currentState.currentArchivePageMeta.pairEndIndex + 1,
            })
          : this.t('historyPageEmpty');
    if (summary != null) {
      if (summary.textContent !== nextSummary) {
        summary.textContent = nextSummary;
      }
    }

    const openNewestButton = this.getBoundaryButton('open-archive-newest');
    if (openNewestButton != null) {
      openNewestButton.textContent = this.t('historyPageOpenNewest');
      openNewestButton.disabled = !hasArchivePages;
    }

    const olderButton = this.getBoundaryButton('go-archive-older');
    if (olderButton != null) {
      olderButton.textContent = this.t('historyPageOlder');
      olderButton.disabled = !hasArchivePages || this.currentState.currentArchivePageIndex == null || this.currentState.currentArchivePageIndex <= 0;
    }

    const newerButton = this.getBoundaryButton('go-archive-newer');
    if (newerButton != null) {
      newerButton.textContent = this.t('historyPageNewer');
      newerButton.disabled =
        !hasArchivePages ||
        this.currentState.currentArchivePageIndex == null ||
        this.currentState.currentArchivePageIndex >= this.currentState.archivePageCount - 1;
    }

    const recentButton = this.getBoundaryButton('go-archive-recent');
    if (recentButton != null) {
      recentButton.textContent = this.t('historyPageRecent');
      recentButton.disabled = !hasArchivePages || this.currentState.isRecentView;
    }

    const searchToggleButton = this.getBoundaryButton('toggle-archive-search');
    if (searchToggleButton != null) {
      searchToggleButton.textContent = this.currentState.archiveSearchOpen
        ? this.t('historyPageSearchClose')
        : this.t('historyPageSearchOpen');
      searchToggleButton.disabled = !hasArchivePages;
      searchToggleButton.setAttribute('aria-expanded', String(this.currentState.archiveSearchOpen));
    }

    this.renderArchiveSearch(hasArchivePages);

    this.syncGroupCards(this.currentState.archiveGroups);
    this.positionOpenEntryActionMenus();
    this.forceRender = false;
  }

  private renderArchiveSearch(hasArchivePages: boolean): void {
    if (this.currentState == null) {
      return;
    }

    const panel = this.getSearchPanel();
    const input = this.getSearchInput();
    const summary = this.getSearchSummary();
    const resultsRoot = this.getSearchResultsRoot();
    const clearButton = this.getBoundaryButton('clear-archive-search');
    const query = this.currentState.archiveSearchQuery;
    const trimmedQuery = query.trim();
    const results = this.currentState.archiveSearchResults;
    const isPanelVisible = hasArchivePages && this.currentState.archiveSearchOpen;

    if (panel != null) {
      panel.hidden = !isPanelVisible;
    }

    if (input != null) {
      input.placeholder = this.t('historyPageSearchPlaceholder');
      input.disabled = !hasArchivePages;
      if (input.value !== query) {
        input.value = query;
      }
    }

    if (clearButton != null) {
      clearButton.textContent = this.t('historyPageSearchClear');
      clearButton.disabled = trimmedQuery.length === 0;
    }

    if (summary != null) {
      summary.textContent =
        trimmedQuery.length === 0
          ? this.t('historyPageSearchHint')
          : results.length === 0
            ? this.t('historyPageSearchNoResults')
            : this.t('historyPageSearchResults', { count: results.length });
    }

    if (resultsRoot == null) {
      return;
    }

    resultsRoot.replaceChildren();
    if (trimmedQuery.length === 0 || results.length === 0) {
      return;
    }

    for (const result of results) {
      const button = this.doc.createElement('button');
      button.type = 'button';
      button.className = UI_CLASS_NAMES.inlineHistorySearchResult;
      button.dataset.turboRenderAction = 'open-archive-search-result';
      button.dataset.pageIndex = String(result.pageIndex);
      button.dataset.pairIndex = String(result.firstMatchPairIndex);
      button.setAttribute('aria-label', this.t('historyPageSearchResultOpen'));
      button.classList.toggle(
        UI_CLASS_NAMES.inlineHistorySearchResultActive,
        this.currentState.activeArchiveSearchPageIndex === result.pageIndex &&
          this.currentState.activeArchiveSearchPairIndex === result.firstMatchPairIndex,
      );
      button.addEventListener('click', () => {
        this.actions.onOpenArchiveSearchResult(result);
      });

      const meta = this.doc.createElement('span');
      meta.className = UI_CLASS_NAMES.inlineHistorySearchResultMeta;
      meta.textContent = this.t('historyPageSearchResultSummary', {
        page: result.pageIndex + 1,
        total: result.pageCount,
        start: result.pairStartIndex + 1,
        end: result.pairEndIndex + 1,
        count: result.matchCount,
      });

      const excerpt = this.doc.createElement('span');
      excerpt.className = UI_CLASS_NAMES.inlineHistorySearchResultExcerpt;
      excerpt.textContent = result.excerpt;

      button.append(meta, excerpt);
      resultsRoot.append(button);
    }
  }

  private readonly handleWindowResize = (): void => {
    this.markPageChromeOffsetDirty();
    this.syncPageChromeOffset();
  };

  private markPageChromeOffsetDirty(): void {
    this.pageChromeOffsetDirty = true;
  }

  private computePageChromeLayoutSignature(): string {
    const rect = this.root?.getBoundingClientRect();
    if (rect == null) {
      return '';
    }
    return [
      Math.round(rect.left),
      Math.round(rect.right),
      Math.round(rect.width),
    ].join(':');
  }

  private syncPageChromeOffset(): void {
    if (this.root == null) {
      return;
    }

    const layoutSignature = this.computePageChromeLayoutSignature();
    if (layoutSignature !== this.pageChromeLayoutSignature) {
      this.pageChromeLayoutSignature = layoutSignature;
      this.pageChromeOffsetDirty = true;
    }

    if (this.pageChromeOffsetDirty) {
      this.cachedTopPageChromeOffset = this.getPageHeaderOffset();
      this.pageChromeOffsetDirty = false;
    }

    this.root.style.setProperty('--turbo-render-page-header-offset', `${this.cachedTopPageChromeOffset}px`);
  }

  private getPageHeaderOffset(): number {
    const legacyOffset = this.getLegacyPageHeaderOffset();
    const sampledOffset = this.getSampledTopChromeOffset();
    const rawOffset = Math.max(legacyOffset, sampledOffset);
    const viewportHeight = this.doc.defaultView?.innerHeight ?? 0;
    if (viewportHeight <= 0) {
      return Math.max(0, Math.round(rawOffset));
    }

    const maxOffset = Math.max(0, Math.round(viewportHeight - 24));
    return Math.min(maxOffset, Math.max(0, Math.round(rawOffset)));
  }

  private getLegacyPageHeaderOffset(): number {
    const selectors = ['header.page-header', '[data-testid="page-header"]', '.page-header'];
    for (const selector of selectors) {
      const element = this.doc.querySelector<HTMLElement>(selector);
      if (element == null) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.height > 0 || rect.bottom > 0) {
        return Math.max(0, Math.round(rect.bottom));
      }
    }

    return 0;
  }

  private getSampledTopChromeOffset(): number {
    const win = this.doc.defaultView;
    if (win == null || typeof this.doc.elementsFromPoint !== 'function') {
      return 0;
    }

    const viewportWidth = win.innerWidth;
    const viewportHeight = win.innerHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      return 0;
    }

    const contentRect = this.getPrimaryContentRect(viewportWidth);
    const minX = Math.max(1, Math.round(contentRect.left + 8));
    const maxX = Math.min(viewportWidth - 1, Math.round(contentRect.right - 8));
    if (maxX < minX) {
      return 0;
    }

    const centerX = Math.round((minX + maxX) / 2);
    const sampleXs = [...new Set([minX, centerX, maxX])];
    const maxSampleY = Math.max(1, Math.min(viewportHeight - 1, 220));
    let offset = 0;

    for (let y = 1; y <= maxSampleY; y += 8) {
      for (const x of sampleXs) {
        const stack = this.doc.elementsFromPoint(x, y);
        for (const candidate of stack) {
          if (!(candidate instanceof HTMLElement)) {
            continue;
          }
          if (candidate.closest(`[${TURBO_RENDER_UI_ROOT_ATTRIBUTE}]`) != null) {
            continue;
          }

          const style = win.getComputedStyle(candidate);
          const isSemanticTopChrome =
            candidate.matches('header, [role="banner"], [data-testid*="header"], [data-testid*="Header"]') ||
            candidate.closest('header, [role="banner"]') != null;
          if (style.position !== 'fixed' && style.position !== 'sticky' && !isSemanticTopChrome) {
            continue;
          }
          if (style.display === 'none' || style.visibility === 'hidden') {
            continue;
          }

          const rect = candidate.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            continue;
          }
          const horizontalOverlap = Math.min(rect.right, contentRect.right) - Math.max(rect.left, contentRect.left);
          if (horizontalOverlap <= 0) {
            continue;
          }
          if (rect.top > y + 1 || rect.bottom < y - 1) {
            continue;
          }

          offset = Math.max(offset, Math.round(rect.bottom));
          break;
        }
      }
    }

    return Math.max(0, offset);
  }

  private getPrimaryContentRect(viewportWidth: number): { left: number; right: number } {
    const rootRect = this.root?.getBoundingClientRect() ?? null;
    if (rootRect == null || rootRect.width <= 0) {
      return {
        left: 0,
        right: viewportWidth,
      };
    }

    return {
      left: Math.max(0, rootRect.left),
      right: Math.min(viewportWidth, rootRect.right),
    };
  }

  private syncGroupCards(groups: ManagedHistoryGroup[]): void {
    if (this.groupsRoot == null) {
      return;
    }

    const nextIds = new Set(groups.map((group) => group.id));
    let layoutChanged = false;
    for (const [groupId, view] of [...this.groupViews.entries()]) {
      if (nextIds.has(groupId)) {
        continue;
      }

      view.root.remove();
      this.groupViews.delete(groupId);
      layoutChanged = true;
    }

    const query = this.currentState?.archiveSearchQuery.trim().toLowerCase() ?? '';
    const conversationId = this.getConversationId() ?? '';
    let anchor: ChildNode | null = this.groupsRoot.firstChild;
    for (const group of groups) {
      const previewKey = this.buildPreviewKey(group, conversationId);
      let view = this.groupViews.get(group.id);
      const shouldBuildEntriesKey = group.expanded || (view?.entriesRendered ?? false);
      const entriesKey = shouldBuildEntriesKey ? this.buildEntriesKey(group, query, conversationId) : '';
      if (view == null) {
        view = this.createBatchCardView(group, query, previewKey, entriesKey);
        this.groupViews.set(group.id, view);
        layoutChanged = true;
      } else if (
        this.forceRender ||
        view.expanded !== group.expanded ||
        view.previewKey !== previewKey ||
        (view.entriesRendered && view.entriesKey !== entriesKey)
      ) {
        this.updateBatchCardView(view, group, query, previewKey, entriesKey);
      }

      const parent = view.root.parentNode;
      if (parent !== this.groupsRoot || (anchor !== null && view.root !== anchor)) {
        this.groupsRoot.insertBefore(view.root, anchor);
      }
      anchor = view.root.nextSibling;
    }

    if (layoutChanged) {
      this.markPageChromeOffsetDirty();
    }
  }

  private positionOpenEntryActionMenus(): void {
    if (this.root == null || this.currentState?.entryActionMenu == null) {
      return;
    }

    const openMenus = this.root.querySelectorAll<HTMLElement>(
      `.${UI_CLASS_NAMES.historyEntryActionMenu}[data-turbo-render-entry-menu="true"]`,
    );
    if (openMenus.length === 0) {
      return;
    }

    const menuGap = 8;
    const viewportPadding = 8;
    const viewportWidth = this.doc.defaultView?.innerWidth ?? 0;
    const viewportHeight = this.doc.defaultView?.innerHeight ?? 0;

    for (const menu of openMenus) {
      const menuGroupId = menu.dataset.groupId ?? '';
      const menuEntryId = menu.dataset.entryId ?? '';
      const menuLane = menu.dataset.lane === 'user' ? 'user' : 'assistant';
      const selector = `button[data-turbo-render-action="more"][data-group-id="${menuGroupId}"][data-entry-id="${menuEntryId}"]`;
      const anchor = menu.closest<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenuAnchor}`) ?? menu.parentElement;
      const button =
        anchor?.querySelector<HTMLElement>(selector) ??
        this.root.querySelector<HTMLElement>(
          `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="${menuLane}"][data-group-id="${menuGroupId}"][data-entry-id="${menuEntryId}"] button[data-turbo-render-action="more"]`,
        ) ??
        this.root.querySelector<HTMLElement>(
          `button[data-turbo-render-action="more"][data-group-id="${menuGroupId}"][data-entry-id="${menuEntryId}"]`,
        );

      if (button == null) {
        continue;
      }

      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.width <= 0 || menuRect.height <= 0) {
        continue;
      }

      menu.style.position = 'fixed';
      const preferredLeft =
        menuLane === 'assistant'
          ? buttonRect.left
          : buttonRect.right - menuRect.width;
      const maxLeft = Math.max(viewportPadding, viewportWidth - menuRect.width - viewportPadding);
      const left = Math.min(Math.max(viewportPadding, preferredLeft), maxLeft);

      const preferredTop = buttonRect.top - menuRect.height - menuGap;
      const fallbackTop = buttonRect.bottom + menuGap;
      const maxTop = Math.max(viewportPadding, viewportHeight - menuRect.height - viewportPadding);
      const top =
        preferredTop >= viewportPadding
          ? preferredTop
          : Math.min(Math.max(viewportPadding, fallbackTop), maxTop);

      menu.style.left = '0px';
      menu.style.top = '0px';
      menu.style.right = 'auto';
      menu.style.bottom = 'auto';
      menu.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      menu.style.zIndex = '50';
      menu.dataset.side = preferredTop >= viewportPadding ? 'top' : 'bottom';
      menu.dataset.popoverPosition = 'fixed';
    }
  }

  private buildPreviewKey(group: ManagedHistoryGroup, conversationId: string): string {
    return [
      conversationId,
      group.matchCount,
      group.userPreview,
      group.assistantPreview,
      group.slotPairStartIndex,
      group.slotPairEndIndex,
      group.filledPairCount,
      group.capacity,
    ].join('||');
  }

  private buildEntriesKey(group: ManagedHistoryGroup, query: string, conversationId: string): string {
    const routeKind = this.currentStatus?.routeKind ?? 'unknown';
    const entriesKey = group.entries
      .map((entry) => {
        const lane = entry.role === 'user' ? 'user' : entry.role === 'assistant' ? 'assistant' : null;
        const supplemental = isSupplementalHistoryEntry(entry);
        const entryKey = getArchiveEntrySelectionKey(entry);
        const menuState = this.currentState?.entryActionMenu;
        const menuOpen = supplemental || menuState?.entryId !== entryKey || menuState?.groupId !== group.id ? '0' : '1';
        return [
          entry.id,
          entryKey,
          entry.role,
          entry.renderKind,
          entry.hiddenFromConversation ? '1' : '0',
          entry.liveTurnId ?? '',
          supplemental ? '' : this.currentState?.entryHostMessageIds[entryKey] ?? '',
          entry.text,
          entry.contentType ?? '',
          entry.snapshotHtml ?? '',
          entry.structuredDetails ?? '',
          supplemental ? '' : this.currentState?.entryActionSelection[entryKey] ?? '',
          menuOpen,
          supplemental || this.currentState?.entryActionSpeakingEntryKey !== entryKey ? '0' : '1',
          supplemental || this.currentState?.entryActionCopiedEntryKey !== entryKey ? '0' : '1',
          supplemental || lane == null ? '' : this.currentState?.entryActionTemplates[lane]?.html ?? '',
          supplemental || lane == null ? '' : String(this.currentState?.entryActionTemplates[lane]?.edgeInsetPx ?? ''),
        ].join(':');
      })
      .join('|');
    const actionsKey = group.entries
      .map((entry) => {
        const availability = this.getEntryActionAvailability(entry);
        return [
          entry.id,
          availability.copy,
          availability.like,
          availability.dislike,
          availability.share,
          availability.more,
        ].join(':');
      })
      .join('|');

    return [
      routeKind,
      conversationId,
      query,
      group.slotPairStartIndex,
      group.slotPairEndIndex,
      group.filledPairCount,
      group.capacity,
      group.userPreview,
      group.assistantPreview,
      this.currentState?.activeArchiveSearchPageIndex ?? '',
      this.currentState?.activeArchiveSearchPairIndex ?? '',
      entriesKey,
      actionsKey,
      this.currentState?.showShareActions ? '1' : '0',
    ].join('||');
  }

  private createBatchCardView(
    group: ManagedHistoryGroup,
    query: string,
    previewKey: string,
    entriesKey: string,
  ): BatchCardView {
    const root = this.doc.createElement('section');
    root.className = UI_CLASS_NAMES.inlineBatchCard;
    root.dataset.groupId = group.id;
    root.dataset.turboRenderBatchAnchor = 'true';
    root.dataset.state = group.expanded ? 'expanded' : 'collapsed';
    root.dataset.conversationId = this.getConversationId() ?? '';

    const header = this.doc.createElement('div');
    header.className = UI_CLASS_NAMES.inlineBatchHeader;

    const meta = this.doc.createElement('div');
    meta.className = UI_CLASS_NAMES.inlineBatchMeta;

    const summary = this.doc.createElement('strong');
    meta.append(summary);

    const preview = this.doc.createElement('div');
    preview.className = UI_CLASS_NAMES.inlineBatchPreview;

    const entries = this.doc.createElement('div');
    entries.className = UI_CLASS_NAMES.inlineBatchEntries;

    const rail = this.doc.createElement('div');
    rail.className = UI_CLASS_NAMES.inlineBatchRail;
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = UI_CLASS_NAMES.inlineBatchAction;
    button.dataset.action = 'toggle-archive-group';
    button.dataset.turboRenderAction = 'toggle-archive-group';
    button.dataset.groupId = group.id;
    button.textContent = group.expanded ? this.t('actionCollapseBatch') : this.t('actionExpandBatch');
    button.setAttribute('aria-expanded', String(group.expanded));
    this.bindHostEventShield(button);
    button.addEventListener('click', () => this.actions.onToggleArchiveGroup(group.id, button));
    rail.append(button);

    const main = this.doc.createElement('div');
    main.className = UI_CLASS_NAMES.inlineBatchMain;
    header.append(meta);
    main.append(header, preview, entries);
    root.append(main, rail);

    const view: BatchCardView = {
      root,
      main,
      header,
      meta,
      summary,
      rail,
      button,
      preview,
      entries,
      previewKey: '',
      entriesKey: '',
      entriesRendered: false,
      expanded: !group.expanded,
    };
    this.updateBatchCardView(view, group, query, previewKey, entriesKey, true);
    return view;
  }

  private updateBatchCardView(
    view: BatchCardView,
    group: ManagedHistoryGroup,
    query: string,
    previewKey: string,
    entriesKey: string,
    force = false,
  ): void {
    const nextExpanded = group.expanded;
    const expandedChanged = view.expanded !== nextExpanded;
    const previewChanged = view.previewKey !== previewKey;
    const entriesChanged = view.entriesRendered && view.entriesKey !== entriesKey;
    if (!force && !previewChanged && !entriesChanged && !expandedChanged) {
      return;
    }

    view.root.classList.toggle(UI_CLASS_NAMES.inlineBatchHighlight, group.matchCount > 0);
    view.root.dataset.groupId = group.id;
    view.root.dataset.conversationId = this.getConversationId() ?? '';
    view.root.dataset.state = nextExpanded ? 'expanded' : 'collapsed';
    view.summary.textContent = getFilledSummaryText(this.t, group);
    view.button.textContent = group.expanded ? this.t('actionCollapseBatch') : this.t('actionExpandBatch');
    view.button.setAttribute('aria-expanded', String(group.expanded));

    if (force || previewChanged) {
      this.renderCollapsedPreview(view.preview, group);
      view.previewKey = previewKey;
    }
    view.preview.hidden = nextExpanded;

    const shouldRenderEntries = nextExpanded
      ? force || entriesChanged || !view.entriesRendered
      : view.entriesRendered && (force || entriesChanged);
    if (shouldRenderEntries) {
      this.renderExpandedEntries(view.entries, group, query);
      view.entriesKey = entriesKey;
      view.entriesRendered = true;
    }
    view.entries.hidden = !nextExpanded;
    view.expanded = nextExpanded;

    if (force || expandedChanged || shouldRenderEntries) {
      this.markPageChromeOffsetDirty();
    }
  }

  private renderCollapsedPreview(preview: HTMLElement, group: ManagedHistoryGroup): void {
    preview.replaceChildren();

    if (group.userPreview.length > 0) {
      const user = this.doc.createElement('p');
      user.textContent = this.t('historyBatchPreviewUser', { text: group.userPreview });
      preview.append(user);
    }
    if (group.assistantPreview.length > 0) {
      const assistant = this.doc.createElement('p');
      assistant.textContent = this.t('historyBatchPreviewAssistant', { text: group.assistantPreview });
      preview.append(assistant);
    }
    if (group.matchCount > 0) {
      const matches = this.doc.createElement('p');
      matches.className = UI_CLASS_NAMES.inlineBatchMatches;
      matches.textContent = this.t('historyBatchMatches', { count: group.matchCount });
      preview.append(matches);
    }
  }

  private renderExpandedEntries(entries: HTMLElement, group: ManagedHistoryGroup, query: string): void {
    entries.replaceChildren();
    const currentPageIndex = this.currentState?.currentArchivePageIndex ?? null;
    const activeSearchPairIndex =
      currentPageIndex != null && this.currentState?.activeArchiveSearchPageIndex === currentPageIndex
        ? this.currentState.activeArchiveSearchPairIndex
        : null;
    let highlighted =
      activeSearchPairIndex != null &&
      activeSearchPairIndex >= group.pairStartIndex &&
      activeSearchPairIndex <= group.pairEndIndex;

    for (const pair of buildInteractionPairs(
      group.entries.map((entry) => ({
        ...entry,
        text: entry.text,
      })),
    )) {
      const visibleEntries = pair.entries.filter((entry) => !entry.hiddenFromConversation);
      if (visibleEntries.length === 0) {
        continue;
      }

      const article = this.doc.createElement('article');
      article.className = UI_CLASS_NAMES.inlineBatchEntry;
      this.applyEntryMetadata(article, group, null);
      const pairIndex = pair.entries[0]?.pairIndex ?? null;
      if (pairIndex != null) {
        article.dataset.pairIndex = String(pairIndex);
      }
      const isSearchTarget = activeSearchPairIndex != null && pairIndex === activeSearchPairIndex;
      if (isSearchTarget) {
        article.classList.add(UI_CLASS_NAMES.inlineBatchSearchHighlight);
      } else if (!highlighted && query.length > 0 && pair.searchText.toLowerCase().includes(query)) {
        article.classList.add(UI_CLASS_NAMES.inlineBatchHighlight);
        highlighted = true;
      }

      for (const entry of visibleEntries) {
        const lane = entry.role === 'user' ? 'user' : 'assistant';
        const frame = this.doc.createElement('div');
        frame.className = UI_CLASS_NAMES.historyEntryFrame;
        frame.dataset.lane = lane;
        this.applyEntryMetadata(frame, group, entry);
        const body = this.createEntryBody(group, entry);
        const renderedHostMessageId = this.resolveRenderedBodyMessageId(body, lane);
        if (renderedHostMessageId != null) {
          this.applyResolvedMessageId(frame, renderedHostMessageId);
          this.applyResolvedMessageId(body, renderedHostMessageId);
        }
        frame.append(body);
        const actionRow = this.createEntryActions(group, entry);
        if (actionRow != null) {
          if (renderedHostMessageId != null) {
            this.applyResolvedMessageId(actionRow, renderedHostMessageId);
            for (const candidate of actionRow.querySelectorAll<HTMLElement>('button, [role="menuitem"]')) {
              this.applyResolvedMessageId(candidate, renderedHostMessageId);
            }
          }
          const mountedIntoHostSlot = this.mountEntryActionsIntoHostSlot(body, actionRow, lane);
          if (!mountedIntoHostSlot) {
            frame.append(actionRow);
          }
        }
        article.append(frame);
      }
      entries.append(article);
    }

    this.convergeEntryActionAlignment(entries);
  }

  private createEntryBody(group: ManagedHistoryGroup, entry: ManagedHistoryEntry): HTMLElement {
    const lane = entry.role === 'user' ? 'user' : 'assistant';
    const body = renderManagedHistoryEntryBody(
      this.doc,
      entry,
      this.t,
      lane === 'user' ? this.t('roleUser') : this.t('roleAssistant'),
      false,
    );
    body.classList.add(UI_CLASS_NAMES.historyEntryBody);
    body.dataset.lane = lane;
    this.applyEntryMetadata(body, group, entry);
    if (isSupplementalHistoryEntry(entry)) {
      body.dataset.supplementalRole = entry.contentType?.trim() || entry.role;
    }
    return body;
  }

  private mountEntryActionsIntoHostSlot(
    body: HTMLElement,
    actions: HTMLElement,
    lane: 'user' | 'assistant',
  ): boolean {
    if (body.dataset.renderKind !== 'host-snapshot') {
      return false;
    }

    const preferredSlotHint = actions.dataset.templateSlotHint ?? null;
    const candidateSlots = [
      ...body.querySelectorAll<HTMLElement>(
        'div.justify-start, div.justify-end, div[class*="justify-start"], div[class*="justify-end"]',
      ),
    ];
    if (candidateSlots.length === 0) {
      return false;
    }

    const matchesLane = (candidate: HTMLElement): boolean => {
      const className = candidate.className;
      if (typeof className !== 'string') {
        return false;
      }
      const laneToken = lane === 'assistant' ? 'justify-start' : 'justify-end';
      return className.includes(laneToken);
    };

    const slotByLane = candidateSlots.find(matchesLane) ?? null;
    const slotByHint =
      preferredSlotHint == null
        ? null
        : candidateSlots.find((candidate) => {
            const className = candidate.className;
            if (typeof className !== 'string') {
              return false;
            }
            return preferredSlotHint === 'start'
              ? className.includes('justify-start')
              : className.includes('justify-end');
          }) ?? null;
    const slot = slotByLane ?? slotByHint ?? null;
    if (slot == null) {
      return false;
    }

    actions.dataset.actionMount = 'host-slot';
    actions.style.removeProperty('--turbo-render-action-edge-inset');
    slot.replaceChildren(actions);
    return true;
  }

  private getEntryActionAvailability(entry: ManagedHistoryEntry): EntryActionAvailability {
    if (isSupplementalHistoryEntry(entry)) {
      return {
        copy: 'unavailable',
        like: 'unavailable',
        dislike: 'unavailable',
        share: 'unavailable',
        more: 'unavailable',
      };
    }

    if (entry.role !== 'assistant') {
      return {
        copy: 'local-fallback',
        like: 'unavailable',
        dislike: 'unavailable',
        share: 'unavailable',
        more: 'unavailable',
      };
    }

    const availability = this.currentState?.entryActionAvailability[getArchiveEntrySelectionKey(entry)];
    return {
      copy: availability?.copy ?? 'local-fallback',
      like: availability?.like ?? 'unavailable',
      dislike: availability?.dislike ?? 'unavailable',
      share: availability?.share ?? 'unavailable',
      more: availability?.more ?? 'local-fallback',
    };
  }

  private createEntryActions(group: ManagedHistoryGroup, entry: ManagedHistoryEntry): HTMLElement | null {
    if (isSupplementalHistoryEntry(entry)) {
      return null;
    }

    if (this.currentStatus?.routeKind === 'share' && !this.currentState?.showShareActions) {
      return null;
    }

    if (entry.role !== 'user' && entry.role !== 'assistant') {
      return null;
    }

    const lane = entry.role === 'user' ? 'user' : 'assistant';
    const entryKey = getArchiveEntrySelectionKey(entry);
    const selectedAction = this.currentState?.entryActionSelection[entryKey] ?? null;
    const menuState = this.currentState?.entryActionMenu;
    const menuOpen = menuState?.entryId === entryKey && menuState?.groupId === group.id;
    const speaking = this.currentState?.entryActionSpeakingEntryKey === entryKey;
    const copied = this.currentState?.entryActionCopiedEntryKey === entryKey;

    const actions = this.doc.createElement('div');
    actions.className = UI_CLASS_NAMES.historyEntryActions;
    this.applyEntryMetadata(actions, group, entry);
    actions.dataset.lane = lane;
    actions.dataset.menuOpen = String(menuOpen);
    actions.dataset.speaking = String(speaking);
    actions.dataset.actionMount = 'fallback';

    const template = this.currentState?.entryActionTemplates[lane] ?? null;
    if (template != null) {
      const templateRoot = instantiateHostActionTemplate(this.doc, template);
      if (templateRoot != null) {
        this.prepareActionTemplateButtons(templateRoot, group, entry, lane, selectedAction, menuOpen, entryKey, copied);
        this.wrapTemplateMoreButtonWithMenu(templateRoot, group, entry, lane, menuOpen, entryKey, speaking);
        if (template.slotHint != null) {
          actions.dataset.templateSlotHint = template.slotHint;
        } else {
          delete actions.dataset.templateSlotHint;
        }
        actions.dataset.template = 'host';
        actions.append(this.createTemplateActionGroup(templateRoot, template));
        this.applyActionAlignment(actions, lane, template.edgeInsetPx ?? null);
        return actions;
      }
    }

    actions.dataset.template = 'fallback';
    for (const action of ENTRY_ACTION_LANE[lane]) {
      if (lane === 'assistant' && (action === 'like' || action === 'dislike') && selectedAction != null && selectedAction !== action) {
        continue;
      }

      if (action === 'more') {
        const anchor = this.createMoreActionAnchor(group, entry, lane, selectedAction, menuOpen, entryKey, speaking);
        actions.append(anchor);
        continue;
      }

      actions.append(this.createFallbackActionButton(group, entry, action, selectedAction, menuOpen, entryKey, copied));
    }

    this.applyActionAlignment(actions, lane, null);
    return actions;
  }

  private createTemplateActionGroup(
    root: DocumentFragment,
    template: HostActionTemplateSnapshot,
  ): Node {
    const wrapperClassName = template.wrapperClassName?.trim() ?? '';
    const wrapperRole = template.wrapperRole?.trim() ?? '';

    const wrapper = this.doc.createElement('div');
    if (wrapperClassName.length > 0) {
      wrapper.className = wrapperClassName;
    } else {
      wrapper.style.display = 'contents';
    }
    if (wrapperRole.length > 0) {
      wrapper.setAttribute('role', wrapperRole);
    }
    wrapper.dataset.turboRenderTemplateWrapper = 'true';
    wrapper.append(root);
    return wrapper;
  }

  private applyActionAlignment(
    actions: HTMLElement,
    lane: 'user' | 'assistant',
    edgeInsetPx: number | null,
  ): void {
    actions.dataset.alignLane = lane;
    const normalizedInset = this.normalizeActionEdgeInset(edgeInsetPx);
    if (normalizedInset == null) {
      delete actions.dataset.templateEdgeInset;
      actions.style.removeProperty('--turbo-render-action-edge-inset');
      return;
    }

    actions.dataset.templateEdgeInset = String(normalizedInset);
    actions.style.setProperty('--turbo-render-action-edge-inset', `${normalizedInset}px`);
  }

  private normalizeActionEdgeInset(inset: number | null): number | null {
    if (inset == null) {
      return null;
    }
    const roundedInset = Math.round(inset);
    if (!Number.isFinite(roundedInset) || roundedInset < 0 || roundedInset > 72) {
      return null;
    }
    return roundedInset;
  }

  private convergeEntryActionAlignment(entriesRoot: HTMLElement): void {
    const frames = entriesRoot.querySelectorAll<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryFrame}[data-lane]`);
    for (const frame of frames) {
      const lane = frame.dataset.lane === 'user' ? 'user' : 'assistant';
      const body = frame.querySelector<HTMLElement>(
        `.${UI_CLASS_NAMES.historyEntryBody}[data-lane="${lane}"]`,
      );
      const actions = frame.querySelector<HTMLElement>(
        `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="${lane}"]`,
      );
      if (body == null || actions == null) {
        continue;
      }
      if (actions.dataset.actionMount === 'host-slot') {
        actions.style.removeProperty('--turbo-render-action-edge-inset');
        continue;
      }

      const measuredInset = this.measureActionInsetFromBody(body, actions, lane);
      const fallbackInset = this.normalizeActionEdgeInset(
        Number.parseFloat(actions.dataset.templateEdgeInset ?? ''),
      );
      const resolvedInset = measuredInset ?? fallbackInset;
      if (resolvedInset == null) {
        actions.style.removeProperty('--turbo-render-action-edge-inset');
        continue;
      }
      actions.style.setProperty('--turbo-render-action-edge-inset', `${resolvedInset}px`);
    }
  }

  private measureActionInsetFromBody(
    body: HTMLElement,
    actions: HTMLElement,
    lane: 'user' | 'assistant',
  ): number | null {
    const bodyRect = body.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    if (
      bodyRect.width <= 0 ||
      bodyRect.height <= 0 ||
      actionsRect.width <= 0 ||
      actionsRect.height <= 0
    ) {
      return null;
    }

    const rawInset =
      lane === 'assistant'
        ? bodyRect.left - actionsRect.left
        : actionsRect.right - bodyRect.right;
    return this.normalizeActionEdgeInset(rawInset);
  }

  private createMoreActionAnchor(
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry,
    lane: 'user' | 'assistant',
    selectedAction: EntryActionSelection | null,
    menuOpen: boolean,
    entryKey: string,
    speaking: boolean,
  ): HTMLElement {
    const anchor = this.doc.createElement('div');
    anchor.className = UI_CLASS_NAMES.historyEntryActionMenuAnchor;
    anchor.dataset.groupId = group.id;
    anchor.dataset.entryId = entry.id;
    anchor.dataset.entryKey = entryKey;
    anchor.dataset.lane = lane;

    const button = this.createFallbackActionButton(group, entry, 'more', selectedAction, menuOpen, entryKey, false);
    anchor.append(button);

    const menu = this.createMoreActionMenu(group, entry, lane, menuOpen, entryKey, speaking);
    if (menu != null) {
      anchor.append(menu);
    }

    return anchor;
  }

  private prepareActionTemplateButtons(
    root: ParentNode,
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry,
    lane: 'user' | 'assistant',
    selectedAction: EntryActionSelection | null,
    menuOpen: boolean,
    entryKey: string,
    copied: boolean,
  ): void {
    const availability = this.getEntryActionAvailability(entry);
    for (const action of ENTRY_ACTION_LANE[lane]) {
      if (lane === 'assistant' && (action === 'like' || action === 'dislike') && selectedAction != null && selectedAction !== action) {
        const hidden = this.findTemplateActionButton(root, action);
        if (hidden != null) {
          hidden.remove();
        }
        continue;
      }

      const button = this.findTemplateActionButton(root, action);
      if (button == null) {
        continue;
      }

      const isCopiedAction = action === 'copy' && copied;
      const label = isCopiedAction ? this.t('messageActionCopied') : this.getEntryActionLabel(action, lane);
      const templatePressed = button.getAttribute('aria-pressed') === 'true';
      const isSelected = action === 'like' || action === 'dislike' ? selectedAction === action || templatePressed : false;
      const actionMode = availability[action];
      button.type = 'button';
      this.applyEntryMetadata(button, group, entry);
      button.setAttribute('data-action', action);
      button.setAttribute('data-testid', ENTRY_ACTION_TEST_IDS[action]);
      button.dataset.turboRenderAction = action;
      button.dataset.turboRenderActionMode = actionMode;
      button.dataset.turboRenderTestid = ENTRY_ACTION_TEST_IDS[action];
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      if (action === 'copy') {
        button.dataset.copyState = copied ? 'copied' : 'idle';
        if (copied) {
          this.replaceActionButtonIcon(button, createCheckIcon(this.doc));
        }
      }
      this.bindHostEventShield(button);
      if (action === 'like' || action === 'dislike') {
        button.setAttribute('aria-pressed', String(isSelected));
        this.setSelectedActionVisualState(button, isSelected);
      } else if (action === 'more') {
        const menuId = this.getEntryActionMenuId(group.id, entryKey);
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', String(menuOpen));
        if (menuOpen) {
          button.setAttribute('aria-controls', menuId);
        } else {
          button.removeAttribute('aria-controls');
        }
        button.setAttribute('data-menu-open', String(menuOpen));
      } else {
        button.removeAttribute('aria-pressed');
      }
      button.disabled = !isEntryActionEnabled(actionMode);
      button.addEventListener('pointerdown', this.stopHostEventPropagation);
      button.addEventListener('click', (event) => {
        this.stopHostEventPropagation(event);
        if (!button.disabled) {
          this.actions.onEntryAction({
            groupId: group.id,
            entryId: entry.id,
            action,
            selectedAction: action === 'like' || action === 'dislike' ? selectedAction : null,
          });
        }
      });
    }
  }

  private wrapTemplateMoreButtonWithMenu(
    root: ParentNode,
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry,
    lane: 'user' | 'assistant',
    menuOpen: boolean,
    entryKey: string,
    speaking: boolean,
  ): void {
    const moreButton = this.findTemplateActionButton(root, 'more');
    if (moreButton == null) {
      return;
    }

    const parent = moreButton.parentNode;
    if (parent == null) {
      return;
    }

    const anchor = this.doc.createElement('div');
    anchor.className = UI_CLASS_NAMES.historyEntryActionMenuAnchor;
    anchor.dataset.groupId = group.id;
    anchor.dataset.entryId = entry.id;
    anchor.dataset.entryKey = entryKey;
    anchor.dataset.lane = lane;

    parent.insertBefore(anchor, moreButton);
    anchor.append(moreButton);

    const menu = this.createMoreActionMenu(group, entry, lane, menuOpen, entryKey, speaking);
    if (menu != null) {
      anchor.append(menu);
    }
  }

  private createFallbackActionButton(
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry,
    action: ArchiveEntryAction,
    selectedAction: EntryActionSelection | null,
    menuOpen: boolean,
    entryKey: string,
    copied: boolean,
  ): HTMLButtonElement {
    const button = this.doc.createElement('button');
    const lane = entry.role === 'user' ? 'user' : 'assistant';
    const isCopiedAction = action === 'copy' && copied;
    const label = isCopiedAction ? this.t('messageActionCopied') : this.getEntryActionLabel(action, lane);
    const availability = this.getEntryActionAvailability(entry);
    const actionMode = availability[action];

    button.type = 'button';
    button.className = UI_CLASS_NAMES.historyEntryAction;
    this.applyEntryMetadata(button, group, entry);
    button.setAttribute('data-action', action);
    button.setAttribute('data-testid', ENTRY_ACTION_TEST_IDS[action]);
    button.dataset.turboRenderAction = action;
    button.dataset.turboRenderActionMode = actionMode;
    button.dataset.turboRenderTestid = ENTRY_ACTION_TEST_IDS[action];
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    if (action === 'copy') {
      button.dataset.copyState = copied ? 'copied' : 'idle';
    }
    if (action === 'like' || action === 'dislike') {
      const isSelected = selectedAction === action;
      button.setAttribute('aria-pressed', String(isSelected));
      this.setSelectedActionVisualState(button, isSelected);
    } else if (action === 'more') {
      const menuId = this.getEntryActionMenuId(group.id, entryKey);
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', String(menuOpen));
      if (menuOpen) {
        button.setAttribute('aria-controls', menuId);
      } else {
        button.removeAttribute('aria-controls');
      }
      button.setAttribute('data-menu-open', String(menuOpen));
    }
    button.append(isCopiedAction ? createCheckIcon(this.doc) : createSvgIcon(this.doc, action));
    button.disabled = !isEntryActionEnabled(actionMode);
    this.bindHostEventShield(button);
    button.addEventListener('click', (event) => {
      this.stopHostEventPropagation(event);
      if (!button.disabled) {
        this.actions.onEntryAction({
          groupId: group.id,
          entryId: entry.id,
          action,
          selectedAction: action === 'like' || action === 'dislike' ? selectedAction : null,
        });
      }
    });
    return button;
  }

  private findTemplateActionButton(root: ParentNode, action: ArchiveEntryAction): HTMLButtonElement | null {
    const button = findHostActionButton(root, action);
    return button instanceof HTMLButtonElement ? button : null;
  }

  private replaceActionButtonIcon(button: HTMLButtonElement, icon: SVGSVGElement): void {
    button.querySelectorAll('svg').forEach((svg) => svg.remove());
    button.append(icon);
  }

  private setSelectedActionVisualState(button: HTMLButtonElement, selected: boolean): void {
    button.classList.toggle('text-token-text-primary', selected);
    button.classList.toggle('text-token-text-secondary', !selected);

    if (selected) {
      button.style.setProperty('color', '#111827', 'important');
      button.style.setProperty('fill', '#111827', 'important');
      button.style.setProperty('stroke', '#111827', 'important');
    } else {
      button.style.removeProperty('color');
      button.style.removeProperty('fill');
      button.style.removeProperty('stroke');
    }

    for (const svg of button.querySelectorAll<SVGElement>('svg')) {
      if (selected) {
        svg.style.setProperty('color', '#111827', 'important');
        svg.style.setProperty('fill', '#111827', 'important');
        svg.style.setProperty('stroke', '#111827', 'important');
        svg.style.setProperty('filter', 'brightness(0)', 'important');
      } else {
        svg.style.removeProperty('color');
        svg.style.removeProperty('fill');
        svg.style.removeProperty('stroke');
        svg.style.removeProperty('filter');
      }
    }
  }

  private getEntryActionLabel(action: ArchiveEntryAction, lane?: 'user' | 'assistant'): string {
    return this.t(
      action === 'copy'
        ? lane === 'assistant'
          ? 'messageActionCopyResponse'
          : lane === 'user'
            ? 'messageActionCopyMessage'
            : 'messageActionCopy'
        : action === 'like'
          ? 'messageActionLike'
          : action === 'dislike'
            ? 'messageActionDislike'
            : action === 'share'
              ? 'messageActionShare'
              : 'messageActionMore',
    );
  }

  private createMoreActionMenu(
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry,
    lane: 'user' | 'assistant',
    menuOpen: boolean,
    entryKey: string,
    speaking: boolean,
  ): HTMLElement | null {
    if (!menuOpen || lane !== 'assistant') {
      return null;
    }

    const menu = this.doc.createElement('div');
    menu.className = `${UI_CLASS_NAMES.historyEntryActionMenu} z-50 max-w-xs rounded-2xl popover bg-token-main-surface-primary dark:bg-[#353535] shadow-long py-1.5`;
    this.applyEntryMetadata(menu, group, entry);
    menu.dataset.lane = lane;
    menu.dataset.turboRenderEntryMenu = 'true';
    menu.id = this.getEntryActionMenuId(group.id, entryKey);
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', this.getEntryActionLabel('more'));

    const timeLabel = this.formatEntryCreateTime(entry.createTime ?? null);
    if (timeLabel != null) {
      const header = this.doc.createElement('div');
      header.className = UI_CLASS_NAMES.historyEntryActionMenuHeader;
      header.dataset.turboRenderMenuHeader = 'true';
      header.textContent = timeLabel;
      menu.append(header);
    }

    const menuActions: EntryMoreMenuAction[] = speaking ? ['branch', 'stop-read-aloud'] : ['branch', 'read-aloud'];
    for (const action of menuActions) {
      const button = this.doc.createElement('button');
      button.type = 'button';
      button.className = `${UI_CLASS_NAMES.historyEntryActionMenuItem} group __menu-item`;
      button.setAttribute('role', 'menuitem');
      button.setAttribute('data-action', action);
      button.dataset.turboRenderMenuAction = action;
      button.dataset.turboRenderTestid = this.getMoreMenuActionTestId(action);
      button.setAttribute('data-testid', this.getMoreMenuActionTestId(action));
      const label = this.getMoreMenuActionLabel(action);
      button.setAttribute('aria-label', label);
      button.textContent = label;
      this.bindHostEventShield(button);
      button.addEventListener('click', (event) => {
        this.stopHostEventPropagation(event);
        this.actions.onMoreMenuAction({
          groupId: group.id,
          entryId: entry.id,
          action,
        });
      }, true);
      menu.append(button);
    }

    return menu;
  }

  private formatEntryCreateTime(createTime: number | null): string | null {
    if (createTime == null || !Number.isFinite(createTime) || createTime <= 946684800) {
      return null;
    }

    const milliseconds = createTime > 1_000_000_000_000 ? createTime : createTime * 1000;
    const date = new Date(milliseconds);
    if (!Number.isFinite(date.getTime())) {
      return null;
    }

    const locale = this.t('messageActionReadAloud') === '朗读' ? 'zh-CN' : 'en-US';
    const formatted = new Intl.DateTimeFormat(locale, {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);

    return locale === 'zh-CN' ? formatted.replace(/\s+/, '，') : formatted;
  }

  private getEntryActionMenuId(groupId: string, entryId: string): string {
    return `turbo-render-entry-more-menu-${groupId}-${entryId}`;
  }

  private getConversationId(): string | null {
    const stateConversationId = this.currentState?.conversationId?.trim() ?? '';
    if (stateConversationId.length > 0) {
      return stateConversationId;
    }

    const pathConversationId = getRouteIdFromRuntimeId(getChatIdFromPathname(this.doc.location?.pathname ?? '/'));
    if (pathConversationId != null && pathConversationId.length > 0) {
      return pathConversationId;
    }

    const runtimeId = this.currentStatus?.chatId ?? '';
    const routeId = getRouteIdFromRuntimeId(runtimeId);
    if (routeId != null && routeId.length > 0) {
      return routeId;
    }

    if (runtimeId.length > 0) {
      return runtimeId;
    }

    return null;
  }

  private shouldPreferHostMorePopover(): boolean {
    // Folded-entry More menus must be TurboRender-owned; otherwise tests can pass by using ChatGPT's live menu.
    return false;
  }

  private getEntryHostMessageId(entry: ManagedHistoryEntry): string | null {
    const entryKey = getArchiveEntrySelectionKey(entry);
    const hostMessageId = this.currentState?.entryHostMessageIds[entryKey]?.trim() ?? '';
    if (hostMessageId.length > 0) {
      return hostMessageId;
    }

    return resolvePreferredMessageId(entry.messageId, entry.liveTurnId, entry.turnId);
  }

  private resolveRenderedBodyMessageId(body: HTMLElement, lane: 'user' | 'assistant'): string | null {
    const roleCandidates = [
      ...body.querySelectorAll<HTMLElement>(
        `[data-message-author-role="${lane}"][data-host-message-id], [data-message-author-role="${lane}"][data-message-id]`,
      ),
    ];
    for (const candidate of roleCandidates) {
      const messageId =
        candidate.getAttribute('data-host-message-id')?.trim() ??
        candidate.getAttribute('data-message-id')?.trim() ??
        '';
      if (messageId.length > 0) {
        return messageId;
      }
    }

    const fallbackCandidates = [...body.querySelectorAll<HTMLElement>('[data-host-message-id], [data-message-id]')];
    for (const candidate of fallbackCandidates) {
      const messageId =
        candidate.getAttribute('data-host-message-id')?.trim() ??
        candidate.getAttribute('data-message-id')?.trim() ??
        '';
      if (messageId.length > 0) {
        return messageId;
      }
    }

    return null;
  }

  private applyResolvedMessageId(target: HTMLElement, messageId: string): void {
    target.dataset.messageId = messageId;
    target.dataset.hostMessageId = messageId;
  }

  private applyEntryMetadata(
    target: HTMLElement,
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry | null,
  ): void {
    const conversationId = this.getConversationId();
    target.dataset.groupId = group.id;
    target.dataset.conversationId = conversationId ?? '';

    if (entry == null) {
      return;
    }

    const entryKey = getArchiveEntrySelectionKey(entry);
    const messageId = this.getEntryHostMessageId(entry);
    target.dataset.entryId = entry.id;
    target.dataset.entryKey = entryKey;
    target.dataset.messageAuthorRole = entry.role;
    target.dataset.messageId = messageId ?? '';
    target.dataset.hostMessageId = messageId ?? '';
  }

  private getMoreMenuActionLabel(action: EntryMoreMenuAction): string {
    if (action === 'branch') {
      return this.t('messageActionBranchInNewChat');
    }
    if (action === 'stop-read-aloud') {
      return this.t('messageActionStopReadAloud');
    }
    return this.t('messageActionReadAloud');
  }

  private getMoreMenuActionTestId(action: EntryMoreMenuAction): string {
    if (action === 'branch') {
      return 'branch-in-new-chat-turn-action-button';
    }
    if (action === 'stop-read-aloud') {
      return 'stop-read-aloud-turn-action-button';
    }
    return 'read-aloud-turn-action-button';
  }

  private bindHostEventShield(target: HTMLElement): void {
    target.addEventListener('pointerdown', this.shieldHostEventPropagation, true);
    target.addEventListener('pointerup', this.shieldHostEventPropagation, true);
    target.addEventListener('mousedown', this.shieldHostEventPropagation, true);
    target.addEventListener('mouseup', this.shieldHostEventPropagation, true);
    target.addEventListener('auxclick', this.shieldHostEventPropagation, true);
    target.addEventListener('contextmenu', this.shieldHostEventPropagation, true);
  }

  private shieldHostEventPropagation(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private stopHostEventPropagation(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if ('stopImmediatePropagation' in event) {
      event.stopImmediatePropagation();
    }
  }
}
