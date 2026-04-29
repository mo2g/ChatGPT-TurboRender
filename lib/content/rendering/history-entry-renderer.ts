import type { Translator } from '../../shared/i18n';
import type { ManagedHistoryCitation, ManagedHistoryEntry } from '../../shared/types';

function appendText(doc: Document, parent: Node, value: string): void {
  if (value.length > 0) {
    parent.appendChild(doc.createTextNode(value));
  }
}

const CITATION_MARKER_START = '\uE200cite\uE202';
const CITATION_MARKER_END = '\uE201';
const CITATION_MARKER_SEPARATOR = '\uE202';

function appendInlineCode(doc: Document, parent: HTMLElement, text: string, cursor: number): number | null {
  if (text[cursor] !== '`') {
    return null;
  }

  let tickCount = 1;
  while (text[cursor + tickCount] === '`') {
    tickCount += 1;
  }

  const delimiter = '`'.repeat(tickCount);
  const closing = text.indexOf(delimiter, cursor + tickCount);
  if (closing === -1) {
    appendText(doc, parent, delimiter);
    return cursor + tickCount;
  }

  const content = text.slice(cursor + tickCount, closing);
  const code = doc.createElement('code');
  code.textContent = content;
  parent.append(code);
  return closing + tickCount;
}

function appendStrong(
  doc: Document,
  parent: HTMLElement,
  text: string,
  cursor: number,
  citations: ManagedHistoryCitation[],
): number | null {
  if (!text.startsWith('**', cursor)) {
    return null;
  }

  const closing = text.indexOf('**', cursor + 2);
  if (closing === -1) {
    appendText(doc, parent, '**');
    return cursor + 2;
  }

  const strong = doc.createElement('strong');
  appendInlineMarkdown(doc, strong, text.slice(cursor + 2, closing), citations);
  parent.append(strong);
  return closing + 2;
}

function appendLink(doc: Document, parent: HTMLElement, text: string, cursor: number): number | null {
  if (text[cursor] !== '[') {
    return null;
  }

  const labelEnd = text.indexOf(']', cursor + 1);
  if (labelEnd === -1 || text[labelEnd + 1] !== '(') {
    appendText(doc, parent, '[');
    return cursor + 1;
  }

  const hrefEnd = text.indexOf(')', labelEnd + 2);
  if (hrefEnd === -1) {
    appendText(doc, parent, '[');
    return cursor + 1;
  }

  const label = text.slice(cursor + 1, labelEnd);
  const href = text.slice(labelEnd + 2, hrefEnd).trim();
  if (!/^https?:\/\//.test(href)) {
    appendText(doc, parent, text.slice(cursor, hrefEnd + 1));
    return hrefEnd + 1;
  }

  try {
    new URL(href);
    const link = doc.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = label.length > 0 ? label : href;
    parent.append(link);
  } catch {
    appendText(doc, parent, text.slice(cursor, hrefEnd + 1));
  }

  return hrefEnd + 1;
}

function findCitationForMarker(
  citations: ManagedHistoryCitation[],
  rawCitation: string,
): ManagedHistoryCitation | null {
  const normalized = rawCitation.trim();
  if (normalized.length === 0) {
    return null;
  }

  return citations.find((citation) => {
    const marker = citation.marker.trim();
    if (marker.length === 0) {
      return false;
    }
    return marker === normalized || marker.includes(normalized) || normalized.includes(marker);
  }) ?? null;
}

function extractHttpUrl(value: string): string | null {
  return value.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? null;
}

function appendCitationMarker(
  doc: Document,
  parent: HTMLElement,
  text: string,
  cursor: number,
  citations: ManagedHistoryCitation[],
): number | null {
  if (!text.startsWith(CITATION_MARKER_START, cursor)) {
    return null;
  }

  const end = text.indexOf(CITATION_MARKER_END, cursor + CITATION_MARKER_START.length);
  if (end === -1) {
    appendText(doc, parent, text[cursor] ?? '');
    return cursor + 1;
  }

  const rawCitation = text
    .slice(cursor + CITATION_MARKER_START.length, end)
    .split(CITATION_MARKER_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ');
  const matchedCitation = findCitationForMarker(citations, rawCitation);
  const citationUrl = matchedCitation?.url ?? extractHttpUrl(rawCitation);
  const citation = doc.createElement('sup');
  citation.dataset.turboRenderCitation = 'true';
  const label = doc.createElement(citationUrl != null ? 'a' : 'span');
  label.textContent = 'source';
  if (citationUrl != null) {
    const link = label as HTMLAnchorElement;
    link.href = citationUrl;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
  }
  citation.append(label);
  if (rawCitation.length > 0) {
    citation.title = matchedCitation?.title ?? rawCitation;
    citation.setAttribute('aria-label', `Source ${rawCitation}`);
  } else {
    citation.setAttribute('aria-label', 'Source');
  }
  if (citationUrl != null) {
    citation.dataset.citationUrl = citationUrl;
  }
  parent.append(citation);
  return end + CITATION_MARKER_END.length;
}

function appendInlineMarkdown(
  doc: Document,
  parent: HTMLElement,
  text: string,
  citations: ManagedHistoryCitation[] = [],
): void {
  let cursor = 0;
  while (cursor < text.length) {
    const citationCursor = appendCitationMarker(doc, parent, text, cursor, citations);
    if (citationCursor != null) {
      cursor = citationCursor;
      continue;
    }

    const codeCursor = appendInlineCode(doc, parent, text, cursor);
    if (codeCursor != null) {
      cursor = codeCursor;
      continue;
    }

    const strongCursor = appendStrong(doc, parent, text, cursor, citations);
    if (strongCursor != null) {
      cursor = strongCursor;
      continue;
    }

    const linkCursor = appendLink(doc, parent, text, cursor);
    if (linkCursor != null) {
      cursor = linkCursor;
      continue;
    }

    const nextSpecialChars = [CITATION_MARKER_START[0]!, '`', '*', '[']
      .map((char) => text.indexOf(char, cursor + 1))
      .filter((index) => index !== -1);
    const nextSpecial = nextSpecialChars.length > 0 ? Math.min(...nextSpecialChars) : -1;
    if (nextSpecial === -1) {
      appendText(doc, parent, text.slice(cursor));
      break;
    }

    appendText(doc, parent, text.slice(cursor, nextSpecial));
    cursor = nextSpecial;
  }
}

interface CodeFenceInfo {
  marker: '`' | '~';
  length: number;
  language: string;
}

function parseCodeFenceLine(line: string): CodeFenceInfo | null {
  const match = line.trimStart().match(/^(`{3,}|~{3,})(.*)$/);
  if (match == null) {
    return null;
  }

  const fence = match[1] ?? '';
  return {
    marker: fence[0] === '~' ? '~' : '`',
    length: fence.length,
    language: (match[2] ?? '').trim(),
  };
}

function isClosingCodeFenceLine(line: string, opener: CodeFenceInfo): boolean {
  const trimmed = line.trim();
  const pattern = opener.marker === '`' ? /^(`{3,})\s*$/ : /^(~{3,})\s*$/;
  const match = trimmed.match(pattern);
  return (match?.[1]?.length ?? 0) >= opener.length;
}

function isCodeFenceLine(line: string): boolean {
  return parseCodeFenceLine(line) != null;
}

function renderParagraph(
  doc: Document,
  parent: HTMLElement,
  text: string,
  citations: ManagedHistoryCitation[],
): void {
  const paragraph = doc.createElement('p');
  appendInlineMarkdown(doc, paragraph, text, citations);
  parent.append(paragraph);
}

function renderBlockquote(
  doc: Document,
  parent: HTMLElement,
  lines: string[],
  citations: ManagedHistoryCitation[],
): void {
  const quote = doc.createElement('blockquote');
  for (const line of lines) {
    renderParagraph(doc, quote, line, citations);
  }
  parent.append(quote);
}

function renderList(
  doc: Document,
  parent: HTMLElement,
  lines: string[],
  ordered: boolean,
  citations: ManagedHistoryCitation[],
): void {
  const list = doc.createElement(ordered ? 'ol' : 'ul');
  for (const line of lines) {
    const item = doc.createElement('li');
    appendInlineMarkdown(doc, item, line, citations);
    list.append(item);
  }
  parent.append(list);
}

function renderCodeBlock(doc: Document, parent: HTMLElement, language: string, lines: string[]): void {
  const wrapper = doc.createElement('div');
  wrapper.className = 'turbo-render-code-block';

  if (language.length > 0) {
    const label = doc.createElement('div');
    label.className = 'turbo-render-code-language';
    label.textContent = language;
    wrapper.append(label);
  }

  const pre = doc.createElement('pre');
  const code = doc.createElement('code');
  if (language.length > 0) {
    code.dataset.language = language;
    const safeLanguageClass = language.replace(/[^\w-]/g, '');
    if (safeLanguageClass.length > 0) {
      code.className = `language-${safeLanguageClass}`;
    }
  }
  code.textContent = lines.join('\n');
  pre.append(code);
  wrapper.append(pre);
  parent.append(wrapper);
}

type MarkdownTableAlignment = 'left' | 'center' | 'right' | null;

interface MarkdownTableBlock {
  rows: string[][];
  alignments: MarkdownTableAlignment[];
  consumedLineCount: number;
}

function splitCollapsedTableSegments(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return trimmed.length > 0 ? [trimmed] : [];
  }

  const segments: string[] = [];
  let start = 0;
  for (let index = 0; index < trimmed.length - 1; index += 1) {
    if (trimmed[index] !== '|') {
      continue;
    }

    let next = index + 1;
    while (next < trimmed.length && /\s/.test(trimmed[next]!)) {
      next += 1;
    }
    if (next > index + 1 && trimmed[next] === '|') {
      const segment = trimmed.slice(start, index + 1).trim();
      if (segment.length > 0) {
        segments.push(segment);
      }
      start = next;
      index = next - 1;
    }
  }

  const tail = trimmed.slice(start).trim();
  if (tail.length > 0) {
    segments.push(tail);
  }

  return segments.length > 0 ? segments : [trimmed];
}

function splitMarkdownTableRow(line: string): string[] {
  let normalized = line.trim();
  if (normalized.startsWith('|')) {
    normalized = normalized.slice(1);
  }
  if (normalized.endsWith('|')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.split('|').map((cell) => cell.trim());
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && splitMarkdownTableRow(trimmed).length >= 2;
}

function isMarkdownTableDelimiterRow(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function parseMarkdownTableAlignment(cell: string): MarkdownTableAlignment {
  const normalized = cell.replace(/\s+/g, '');
  const left = normalized.startsWith(':');
  const right = normalized.endsWith(':');
  if (left && right) {
    return 'center';
  }
  if (right) {
    return 'right';
  }
  if (left) {
    return 'left';
  }
  return null;
}

function collectMarkdownTableBlock(lines: string[], cursor: number): MarkdownTableBlock | null {
  const firstLine = lines[cursor]?.trimEnd() ?? '';
  const firstSegments = splitCollapsedTableSegments(firstLine);
  if (firstSegments.length === 0 || !isMarkdownTableRow(firstSegments[0]!)) {
    return null;
  }

  let candidateSegments = firstSegments;
  let consumedLineCount = 1;
  if (candidateSegments.length < 2 && cursor + 1 < lines.length) {
    const secondLine = lines[cursor + 1]?.trimEnd() ?? '';
    candidateSegments = [...candidateSegments, ...splitCollapsedTableSegments(secondLine)];
    consumedLineCount = 2;
  }

  if (
    candidateSegments.length < 2 ||
    !isMarkdownTableRow(candidateSegments[0]!) ||
    !isMarkdownTableDelimiterRow(candidateSegments[1]!)
  ) {
    return null;
  }

  const rows = candidateSegments
    .filter((segment, index) => index < 2 || isMarkdownTableRow(segment))
    .map((segment) => splitMarkdownTableRow(segment));
  let nextCursor = cursor + consumedLineCount;
  while (nextCursor < lines.length) {
    const nextLine = lines[nextCursor]?.trimEnd() ?? '';
    if (nextLine.trim().length === 0) {
      break;
    }

    const nextSegments = splitCollapsedTableSegments(nextLine);
    if (nextSegments.length === 0 || !nextSegments.every((segment) => isMarkdownTableRow(segment))) {
      break;
    }

    rows.push(...nextSegments.map((segment) => splitMarkdownTableRow(segment)));
    nextCursor += 1;
  }

  return {
    rows,
    alignments: rows[1]!.map(parseMarkdownTableAlignment),
    consumedLineCount: nextCursor - cursor,
  };
}

function renderMarkdownTable(
  doc: Document,
  parent: HTMLElement,
  block: MarkdownTableBlock,
  citations: ManagedHistoryCitation[],
): void {
  const header = block.rows[0] ?? [];
  const bodyRows = block.rows.slice(2);
  const columnCount = Math.max(
    header.length,
    block.alignments.length,
    ...bodyRows.map((row) => row.length),
  );
  if (columnCount === 0) {
    return;
  }

  const wrapper = doc.createElement('div');
  wrapper.className = 'turbo-render-markdown-table-scroll';

  const table = doc.createElement('table');
  const thead = doc.createElement('thead');
  const headerRow = doc.createElement('tr');
  for (let index = 0; index < columnCount; index += 1) {
    const cell = doc.createElement('th');
    const alignment = block.alignments[index] ?? null;
    if (alignment != null) {
      cell.style.textAlign = alignment;
    }
    appendInlineMarkdown(doc, cell, header[index] ?? '', citations);
    headerRow.append(cell);
  }
  thead.append(headerRow);
  table.append(thead);

  const tbody = doc.createElement('tbody');
  for (const row of bodyRows) {
    const tr = doc.createElement('tr');
    for (let index = 0; index < columnCount; index += 1) {
      const cell = doc.createElement('td');
      const alignment = block.alignments[index] ?? null;
      if (alignment != null) {
        cell.style.textAlign = alignment;
      }
      appendInlineMarkdown(doc, cell, row[index] ?? '', citations);
      tr.append(cell);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrapper.append(table);
  parent.append(wrapper);
}

function isMarkdownHeadingLine(line: string): boolean {
  return /^(#{1,6})\s+/.test(line.trimStart());
}

function renderHeading(
  doc: Document,
  parent: HTMLElement,
  level: number,
  text: string,
  citations: ManagedHistoryCitation[],
): void {
  const safeLevel = Math.min(Math.max(level, 1), 6);
  const heading = doc.createElement(`h${safeLevel}`);
  appendInlineMarkdown(doc, heading, text.trim(), citations);
  parent.append(heading);
}

function isMarkdownThematicBreakLine(line: string): boolean {
  const normalized = line.trim();
  return /^(?:-{3,}|_{3,}|\*{3,})$/.test(normalized);
}

function renderMarkdownText(
  doc: Document,
  parent: HTMLElement,
  text: string,
  citations: ManagedHistoryCitation[] = [],
): void {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let cursor = 0;

  while (cursor < lines.length) {
    const line = lines[cursor]?.trimEnd() ?? '';
    if (line.trim().length === 0) {
      cursor += 1;
      continue;
    }

    const codeFence = parseCodeFenceLine(line);
    if (codeFence != null) {
      const language = codeFence.language;
      const codeLines: string[] = [];
      const rawBlockLines = [line];
      cursor += 1;
      while (cursor < lines.length && !isClosingCodeFenceLine(lines[cursor]!.trimEnd(), codeFence)) {
        codeLines.push(lines[cursor]!);
        rawBlockLines.push(lines[cursor]!);
        cursor += 1;
      }
      if (cursor < lines.length && isClosingCodeFenceLine(lines[cursor]!.trimEnd(), codeFence)) {
        rawBlockLines.push(lines[cursor]!.trimEnd());
        cursor += 1;
        renderCodeBlock(doc, parent, language, codeLines);
      } else {
        renderParagraph(doc, parent, rawBlockLines.join('\n'), citations);
      }
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch != null) {
      renderHeading(doc, parent, headingMatch[1]!.length, headingMatch[2] ?? '', citations);
      cursor += 1;
      continue;
    }

    if (isMarkdownThematicBreakLine(line)) {
      parent.append(doc.createElement('hr'));
      cursor += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (cursor < lines.length && /^>\s?/.test(lines[cursor]!.trimEnd())) {
        quoteLines.push(lines[cursor]!.trimEnd().replace(/^>\s?/, ''));
        cursor += 1;
      }
      renderBlockquote(doc, parent, quoteLines, citations);
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const listLines: string[] = [];
      while (cursor < lines.length && /^[-*+]\s+/.test(lines[cursor]!.trimEnd())) {
        listLines.push(lines[cursor]!.trimEnd().replace(/^[-*+]\s+/, ''));
        cursor += 1;
      }
      renderList(doc, parent, listLines, false, citations);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const listLines: string[] = [];
      while (cursor < lines.length && /^\d+\.\s+/.test(lines[cursor]!.trimEnd())) {
        listLines.push(lines[cursor]!.trimEnd().replace(/^\d+\.\s+/, ''));
        cursor += 1;
      }
      renderList(doc, parent, listLines, true, citations);
      continue;
    }

    const tableBlock = collectMarkdownTableBlock(lines, cursor);
    if (tableBlock != null) {
      renderMarkdownTable(doc, parent, tableBlock, citations);
      cursor += tableBlock.consumedLineCount;
      continue;
    }

    const paragraphLines = [line];
    cursor += 1;
    while (cursor < lines.length) {
      const nextLine = lines[cursor]!.trimEnd();
      if (
        nextLine.trim().length === 0 ||
        isCodeFenceLine(nextLine) ||
        isMarkdownHeadingLine(nextLine) ||
        isMarkdownThematicBreakLine(nextLine) ||
        /^>\s?/.test(nextLine) ||
        /^[-*+]\s+/.test(nextLine) ||
        /^\d+\.\s+/.test(nextLine) ||
        collectMarkdownTableBlock(lines, cursor) != null
      ) {
        break;
      }
      paragraphLines.push(nextLine);
      cursor += 1;
    }
    renderParagraph(doc, parent, paragraphLines.join('\n'), citations);
  }
}

function renderUserMessageBubble(doc: Document, parent: HTMLElement, text: string): void {
  const shell = doc.createElement('div');
  shell.className = 'flex w-full flex-col gap-1 empty:hidden items-end rtl:items-start';

  const bubble = doc.createElement('div');
  bubble.className =
    'user-message-bubble-color corner-superellipse/0.98 relative min-w-0 rounded-[22px] px-4 py-2.5 leading-6 max-w-(--user-chat-width,70%)';

  const content = doc.createElement('div');
  content.className = '[overflow-wrap:anywhere] whitespace-pre-wrap';
  content.textContent = text;

  bubble.append(content);
  shell.append(bubble);
  parent.append(shell);
}

function isThinkingStructuredMessage(entry: ManagedHistoryEntry): boolean {
  if (entry.renderKind !== 'structured-message' || entry.role !== 'assistant') {
    return false;
  }

  const candidate = [entry.contentType ?? '', entry.structuredDetails ?? '', entry.parts.join('\n')]
    .join('\n')
    .toLowerCase();
  return /(thoughts?|thinking|reason(?:ing)?(?:_recap)?|recap|analysis)/.test(candidate);
}

function getStructuredMessageSummaryLabel(
  entry: ManagedHistoryEntry,
  t: Translator,
  roleLabel: string,
): string {
  const type = entry.contentType?.trim() ?? '';
  if (isThinkingStructuredMessage(entry)) {
    return t('structuredMessageThinking');
  }

  return t('structuredMessageSummary', {
    role: roleLabel,
    type: type.length > 0 ? type : t('roleUnknown'),
  });
}

export function renderManagedHistoryEntryBody(
  doc: Document,
  entry: ManagedHistoryEntry,
  t: Translator,
  roleLabel: string,
  structuredExpanded: boolean,
): HTMLElement {
  const body = doc.createElement('div');

  if (entry.renderKind === 'host-snapshot' && entry.snapshotHtml != null) {
    body.dataset.renderKind = 'host-snapshot';
    body.innerHTML = entry.snapshotHtml;
    return body;
  }

  if (entry.renderKind === 'structured-message') {
    body.dataset.renderKind = 'structured-message';

    const details = doc.createElement('details');
    details.open = structuredExpanded;

    const summary = doc.createElement('summary');
    summary.textContent = getStructuredMessageSummaryLabel(entry, t, roleLabel);
    details.append(summary);

    const structuredText = (entry.structuredDetails ?? entry.parts.join('\n\n')).trim();
    if (structuredText.length > 0) {
      const pre = doc.createElement('pre');
      pre.textContent = structuredText;
      details.append(pre);
    }
    body.append(details);
    return body;
  }

  body.dataset.renderKind = 'markdown-text';
  if (entry.role === 'user') {
    body.dir = 'auto';
    body.classList.add(
      'min-h-8',
      'text-message',
      'relative',
      'flex',
      'w-full',
      'flex-col',
      'items-end',
      'gap-2',
      'text-start',
      'break-words',
      'whitespace-normal',
      'outline-none',
      'keyboard-focused:focus-ring',
      '[.text-message+&]:mt-1',
    );
    renderUserMessageBubble(doc, body, entry.parts.join('\n\n'));
    return body;
  }

  if (entry.role === 'assistant') {
    body.dir = 'auto';
    body.classList.add(
      'min-h-8',
      'text-message',
      'relative',
      'flex',
      'w-full',
      'flex-col',
      'items-end',
      'gap-2',
      'text-start',
      'break-words',
      'whitespace-normal',
      'outline-none',
      'keyboard-focused:focus-ring',
    );

    const shell = doc.createElement('div');
    shell.className = 'flex w-full flex-col gap-1 empty:hidden';

    const markdown = doc.createElement('div');
    markdown.className = 'markdown prose dark:prose-invert w-full wrap-break-word light markdown-new-styling';

    const citations = entry.citations ?? [];
    for (const part of entry.parts) {
      renderMarkdownText(doc, markdown, part, citations);
    }

    shell.append(markdown);
    body.append(shell);
    return body;
  }

  const citations = entry.citations ?? [];
  for (const part of entry.parts) {
    renderMarkdownText(doc, body, part, citations);
  }
  return body;
}
