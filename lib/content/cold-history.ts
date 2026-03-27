import { UI_CLASS_NAMES } from '../shared/constants';
import { createTranslator, type Translator } from '../shared/i18n';
import type { CachedConversationTurn, InitialTrimSession } from '../shared/types';

const COLD_HISTORY_RENDERED_ATTRIBUTE = 'data-turbo-render-initial-cold-turns';
const HISTORY_SHELF_ATTRIBUTE = 'data-turbo-render-history-shelf';

function getRoleLabel(t: Translator, role: CachedConversationTurn['role']): string {
  switch (role) {
    case 'user':
      return t('roleUser');
    case 'assistant':
      return t('roleAssistant');
    case 'system':
      return t('roleSystem');
    case 'tool':
      return t('roleTool');
    default:
      return t('roleUnknown');
  }
}

function renderColdTurn(doc: Document, t: Translator, turn: CachedConversationTurn): HTMLElement {
  const article = doc.createElement('article');
  article.className = UI_CLASS_NAMES.coldHistoryTurn;
  article.setAttribute('data-message-author-role', turn.role);

  const header = doc.createElement('header');
  header.textContent = getRoleLabel(t, turn.role);
  article.append(header);

  const body = doc.createElement('div');
  body.className = UI_CLASS_NAMES.coldHistoryBody;
  for (const part of turn.parts) {
    const paragraph = doc.createElement('p');
    paragraph.textContent = part;
    body.append(paragraph);
  }
  article.append(body);
  return article;
}

export class ColdHistoryManager {
  private turnContainer: HTMLElement | null = null;
  private session: InitialTrimSession | null = null;
  private renderedTurns: HTMLElement | null = null;
  private restored = false;
  private t: Translator = createTranslator('en');

  setTranslator(translator: Translator): void {
    this.t = translator;
    this.renderVisibleSection();
  }

  sync(turnContainer: HTMLElement | null, session: InitialTrimSession | null): void {
    const sessionChanged = session?.chatId !== this.session?.chatId;
    this.turnContainer = turnContainer;
    this.session = session;

    if (sessionChanged) {
      this.restored = false;
    }

    if (turnContainer == null || session?.applied !== true || session.coldTurns.length === 0) {
      this.destroy();
      return;
    }

    this.renderVisibleSection();
  }

  restore(): boolean {
    if (this.turnContainer == null || this.session?.applied !== true || this.session.coldTurns.length === 0) {
      return false;
    }

    this.restored = true;
    this.renderVisibleSection();
    return true;
  }

  collapse(): void {
    this.restored = false;
    this.renderVisibleSection();
  }

  isRestored(): boolean {
    return this.restored;
  }

  getTotalColdTurns(): number {
    return this.session?.applied ? this.session.coldTurns.length : 0;
  }

  getCollapsedGroupCount(): number {
    return this.getTotalColdTurns() > 0 && !this.restored ? 1 : 0;
  }

  destroy(): void {
    this.renderedTurns?.remove();
    this.renderedTurns = null;
    this.restored = false;
  }

  private renderVisibleSection(): void {
    if (
      this.turnContainer == null ||
      this.session?.applied !== true ||
      this.session.coldTurns.length === 0 ||
      !this.restored
    ) {
      this.renderedTurns?.remove();
      this.renderedTurns = null;
      return;
    }

    if (this.renderedTurns == null || !this.renderedTurns.isConnected) {
      const container = this.turnContainer.ownerDocument.createElement('section');
      container.className = UI_CLASS_NAMES.coldHistoryTurns;
      container.setAttribute(COLD_HISTORY_RENDERED_ATTRIBUTE, 'true');
      this.renderedTurns = container;
      const shelf = this.turnContainer.querySelector<HTMLElement>(`[${HISTORY_SHELF_ATTRIBUTE}="true"]`);
      if (shelf?.nextSibling != null) {
        this.turnContainer.insertBefore(container, shelf.nextSibling);
      } else {
        this.turnContainer.insertBefore(container, this.turnContainer.firstChild);
      }
    }

    this.renderedTurns.innerHTML = '';

    const header = this.turnContainer.ownerDocument.createElement('div');
    header.className = UI_CLASS_NAMES.coldHistoryHeader;

    const title = this.turnContainer.ownerDocument.createElement('strong');
    title.textContent = this.t('coldHistoryTitle');
    header.append(title);

    const copy = this.turnContainer.ownerDocument.createElement('p');
    copy.textContent = this.t('coldHistorySummary', { count: this.session.coldTurns.length });
    header.append(copy);

    this.renderedTurns.append(header);
    for (const turn of this.session.coldTurns) {
      this.renderedTurns.append(renderColdTurn(this.turnContainer.ownerDocument, this.t, turn));
    }
  }
}
