import { UI_CLASS_NAMES } from '../shared/constants';

const STYLE_ID = 'turbo-render-style';
const STYLES = `
.${UI_CLASS_NAMES.inlineHistoryRoot} {
  display: grid;
  gap: 10px;
  margin: 0 0 12px;
  padding: 0 8px 0 0;
}

.${UI_CLASS_NAMES.inlineHistoryRoot} > * {
  width: min(100%, 48rem);
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
  grid-template-columns: minmax(0, 1fr);
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

.${UI_CLASS_NAMES.historyEntryActions} button[data-turbo-render-action] {
  width: 32px !important;
  height: 32px !important;
  min-width: 32px !important;
  min-height: 32px !important;
  max-width: 32px !important;
  max-height: 32px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 0 !important;
  line-height: 0 !important;
  flex: 0 0 32px !important;
  box-sizing: border-box !important;
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

export function ensureTurboRenderStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID) != null) {
    return;
  }

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.append(style);
}
