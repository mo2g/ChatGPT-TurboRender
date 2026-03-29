import type { Translator } from '../shared/i18n';
import type { ManagedHistoryEntry } from '../shared/types';

function appendText(doc: Document, parent: Node, value: string): void {
  if (value.length > 0) {
    parent.appendChild(doc.createTextNode(value));
  }
}

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

function appendStrong(doc: Document, parent: HTMLElement, text: string, cursor: number): number | null {
  if (!text.startsWith('**', cursor)) {
    return null;
  }

  const closing = text.indexOf('**', cursor + 2);
  if (closing === -1) {
    appendText(doc, parent, '**');
    return cursor + 2;
  }

  const strong = doc.createElement('strong');
  appendInlineMarkdown(doc, strong, text.slice(cursor + 2, closing));
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

function appendInlineMarkdown(doc: Document, parent: HTMLElement, text: string): void {
  let cursor = 0;
  while (cursor < text.length) {
    const codeCursor = appendInlineCode(doc, parent, text, cursor);
    if (codeCursor != null) {
      cursor = codeCursor;
      continue;
    }

    const strongCursor = appendStrong(doc, parent, text, cursor);
    if (strongCursor != null) {
      cursor = strongCursor;
      continue;
    }

    const linkCursor = appendLink(doc, parent, text, cursor);
    if (linkCursor != null) {
      cursor = linkCursor;
      continue;
    }

    const nextSpecialChars = ['`', '*', '[']
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

function isCodeFenceLine(line: string): boolean {
  return line.trimStart().startsWith('```');
}

function renderParagraph(doc: Document, parent: HTMLElement, text: string): void {
  const paragraph = doc.createElement('p');
  appendInlineMarkdown(doc, paragraph, text);
  parent.append(paragraph);
}

function renderBlockquote(doc: Document, parent: HTMLElement, lines: string[]): void {
  const quote = doc.createElement('blockquote');
  for (const line of lines) {
    renderParagraph(doc, quote, line);
  }
  parent.append(quote);
}

function renderList(doc: Document, parent: HTMLElement, lines: string[], ordered: boolean): void {
  const list = doc.createElement(ordered ? 'ol' : 'ul');
  for (const line of lines) {
    const item = doc.createElement('li');
    appendInlineMarkdown(doc, item, line);
    list.append(item);
  }
  parent.append(list);
}

function renderCodeBlock(doc: Document, parent: HTMLElement, language: string, lines: string[]): void {
  const pre = doc.createElement('pre');
  const code = doc.createElement('code');
  if (language.length > 0) {
    code.dataset.language = language;
  }
  code.textContent = lines.join('\n');
  pre.append(code);
  parent.append(pre);
}

function renderMarkdownText(doc: Document, parent: HTMLElement, text: string): void {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let cursor = 0;

  while (cursor < lines.length) {
    const line = lines[cursor]?.trimEnd() ?? '';
    if (line.trim().length === 0) {
      cursor += 1;
      continue;
    }

    if (isCodeFenceLine(line)) {
      const language = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      const rawBlockLines = [line];
      cursor += 1;
      while (cursor < lines.length && !isCodeFenceLine(lines[cursor]!.trimEnd())) {
        codeLines.push(lines[cursor]!);
        rawBlockLines.push(lines[cursor]!);
        cursor += 1;
      }
      if (cursor < lines.length && isCodeFenceLine(lines[cursor]!.trimEnd())) {
        rawBlockLines.push(lines[cursor]!.trimEnd());
        cursor += 1;
        renderCodeBlock(doc, parent, language, codeLines);
      } else {
        renderParagraph(doc, parent, rawBlockLines.join('\n'));
      }
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (cursor < lines.length && /^>\s?/.test(lines[cursor]!.trimEnd())) {
        quoteLines.push(lines[cursor]!.trimEnd().replace(/^>\s?/, ''));
        cursor += 1;
      }
      renderBlockquote(doc, parent, quoteLines);
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const listLines: string[] = [];
      while (cursor < lines.length && /^[-*+]\s+/.test(lines[cursor]!.trimEnd())) {
        listLines.push(lines[cursor]!.trimEnd().replace(/^[-*+]\s+/, ''));
        cursor += 1;
      }
      renderList(doc, parent, listLines, false);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const listLines: string[] = [];
      while (cursor < lines.length && /^\d+\.\s+/.test(lines[cursor]!.trimEnd())) {
        listLines.push(lines[cursor]!.trimEnd().replace(/^\d+\.\s+/, ''));
        cursor += 1;
      }
      renderList(doc, parent, listLines, true);
      continue;
    }

    const paragraphLines = [line];
    cursor += 1;
    while (cursor < lines.length) {
      const nextLine = lines[cursor]!.trimEnd();
      if (
        nextLine.trim().length === 0 ||
        isCodeFenceLine(nextLine) ||
        /^>\s?/.test(nextLine) ||
        /^[-*+]\s+/.test(nextLine) ||
        /^\d+\.\s+/.test(nextLine)
      ) {
        break;
      }
      paragraphLines.push(nextLine);
      cursor += 1;
    }
    renderParagraph(doc, parent, paragraphLines.join('\n'));
  }
}

function truncatePreview(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
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

    const preview = truncatePreview(entry.parts.join(' '));
    const details = doc.createElement('details');
    details.open = structuredExpanded;

    const summary = doc.createElement('summary');
    summary.textContent =
      preview.length > 0
        ? preview
        : t('structuredMessageSummary', {
            role: roleLabel,
            type: entry.contentType ?? 'unknown',
          });
    details.append(summary);

    const pre = doc.createElement('pre');
    pre.textContent = entry.structuredDetails ?? entry.parts.join('\n\n');
    details.append(pre);
    body.append(details);
    return body;
  }

  body.dataset.renderKind = 'markdown-text';
  for (const part of entry.parts) {
    renderMarkdownText(doc, body, part);
  }
  return body;
}
