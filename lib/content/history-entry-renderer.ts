import type { Translator } from '../shared/i18n';
import type { ManagedHistoryEntry } from '../shared/types';

function appendText(doc: Document, parent: Node, value: string): void {
  if (value.length > 0) {
    parent.appendChild(doc.createTextNode(value));
  }
}

function appendInlineMarkdown(doc: Document, parent: HTMLElement, text: string): void {
  let cursor = 0;

  while (cursor < text.length) {
    const inlineCodeMatch = text.slice(cursor).match(/`([^`]+)`/);
    const linkMatch = text.slice(cursor).match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    const codeIndex = inlineCodeMatch?.index ?? Number.POSITIVE_INFINITY;
    const linkIndex = linkMatch?.index ?? Number.POSITIVE_INFINITY;

    if (!Number.isFinite(codeIndex) && !Number.isFinite(linkIndex)) {
      appendText(doc, parent, text.slice(cursor));
      return;
    }

    if (codeIndex <= linkIndex) {
      const match = inlineCodeMatch;
      if (match == null || match.index == null) {
        break;
      }

      appendText(doc, parent, text.slice(cursor, cursor + match.index));
      const code = doc.createElement('code');
      code.textContent = match[1] ?? '';
      parent.append(code);
      cursor += match.index + match[0].length;
      continue;
    }

    const match = linkMatch;
    if (match == null || match.index == null) {
      break;
    }

    appendText(doc, parent, text.slice(cursor, cursor + match.index));
    const href = match[2] ?? '';
    try {
      new URL(href);
      const link = doc.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = match[1] ?? href;
      parent.append(link);
    } catch {
      appendText(doc, parent, match[0]);
    }
    cursor += match.index + match[0].length;
  }
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

    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      cursor += 1;
      while (cursor < lines.length && !lines[cursor]!.startsWith('```')) {
        codeLines.push(lines[cursor]!);
        cursor += 1;
      }
      if (cursor < lines.length && lines[cursor]!.startsWith('```')) {
        cursor += 1;
      }
      renderCodeBlock(doc, parent, language, codeLines);
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
        nextLine.startsWith('```') ||
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
