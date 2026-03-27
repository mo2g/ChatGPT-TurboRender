import { PLACEHOLDER_TEXT, UI_CLASS_NAMES } from '../shared/constants';
import type { CachedConversationTurn, ColdRestoreMode, InitialTrimSession } from '../shared/types';

const COLD_HISTORY_PLACEHOLDER_ATTRIBUTE = 'data-turbo-render-initial-cold';
const COLD_HISTORY_TURNS_ATTRIBUTE = 'data-turbo-render-initial-cold-turns';

function getRoleLabel(role: CachedConversationTurn['role']): string {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
    case 'tool':
      return 'Tool';
    default:
      return 'Message';
  }
}

function renderColdTurn(doc: Document, turn: CachedConversationTurn): HTMLElement {
  const article = doc.createElement('article');
  article.className = UI_CLASS_NAMES.coldHistoryTurn;
  article.setAttribute('data-message-author-role', turn.role);

  const header = doc.createElement('header');
  header.textContent = getRoleLabel(turn.role);
  article.append(header);

  const body = doc.createElement('div');
  body.className = 'turbo-render-cold-history__body';
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
  private placeholder: HTMLElement | null = null;
  private renderedTurns: HTMLElement | null = null;
  private restored = false;
  private restoreMode: ColdRestoreMode = 'placeholder';

  sync(
    turnContainer: HTMLElement | null,
    session: InitialTrimSession | null,
    restoreMode: ColdRestoreMode,
  ): void {
    const nextColdTurns = session?.applied ? session.coldTurns : [];
    const sessionChanged = session?.chatId !== this.session?.chatId;

    this.turnContainer = turnContainer;
    this.session = session;
    this.restoreMode = restoreMode;

    if (sessionChanged) {
      this.restored = false;
    }

    if (turnContainer == null || nextColdTurns.length === 0) {
      this.destroy();
      return;
    }

    this.ensurePlaceholder(turnContainer);
    this.updatePlaceholder(nextColdTurns.length);

    if (this.restored) {
      this.ensureRenderedTurns(turnContainer, nextColdTurns);
    } else {
      this.renderedTurns?.remove();
      this.renderedTurns = null;
    }
  }

  handleAction(target: Element | null): boolean {
    const action = target
      ?.closest<HTMLElement>('[data-turbo-render-action="restore-initial-cold"]')
      ?.getAttribute('data-turbo-render-action');

    if (action !== 'restore-initial-cold') {
      return false;
    }

    this.restore();
    return true;
  }

  restore(): boolean {
    if (this.turnContainer == null || this.session?.applied !== true || this.session.coldTurns.length === 0) {
      return false;
    }

    this.restored = true;
    this.ensurePlaceholder(this.turnContainer);
    this.updatePlaceholder(this.session.coldTurns.length);
    this.ensureRenderedTurns(this.turnContainer, this.session.coldTurns);
    return true;
  }

  getTotalColdTurns(): number {
    return this.session?.applied ? this.session.coldTurns.length : 0;
  }

  getCollapsedGroupCount(): number {
    return this.getTotalColdTurns() > 0 && !this.restored ? 1 : 0;
  }

  destroy(): void {
    this.placeholder?.remove();
    this.renderedTurns?.remove();
    this.placeholder = null;
    this.renderedTurns = null;
    this.restored = false;
  }

  private ensurePlaceholder(turnContainer: HTMLElement): void {
    if (this.placeholder != null && this.placeholder.isConnected) {
      return;
    }

    const placeholder = turnContainer.ownerDocument.createElement('div');
    placeholder.className = `${UI_CLASS_NAMES.placeholder} ${UI_CLASS_NAMES.coldHistory}`;
    placeholder.setAttribute(COLD_HISTORY_PLACEHOLDER_ATTRIBUTE, 'true');

    const summary = turnContainer.ownerDocument.createElement('div');
    summary.className = UI_CLASS_NAMES.placeholderSummary;
    placeholder.append(summary);

    const actions = turnContainer.ownerDocument.createElement('div');
    actions.className = UI_CLASS_NAMES.placeholderActions;
    const restoreButton = turnContainer.ownerDocument.createElement('button');
    restoreButton.type = 'button';
    restoreButton.setAttribute('data-turbo-render-action', 'restore-initial-cold');
    actions.append(restoreButton);
    placeholder.append(actions);

    turnContainer.insertBefore(placeholder, turnContainer.firstChild);
    this.placeholder = placeholder;
  }

  private ensureRenderedTurns(turnContainer: HTMLElement, turns: CachedConversationTurn[]): void {
    if (this.renderedTurns == null || !this.renderedTurns.isConnected) {
      const container = turnContainer.ownerDocument.createElement('section');
      container.className = UI_CLASS_NAMES.coldHistoryTurns;
      container.setAttribute(COLD_HISTORY_TURNS_ATTRIBUTE, 'true');
      this.renderedTurns = container;
      if (this.placeholder?.nextSibling != null) {
        turnContainer.insertBefore(container, this.placeholder.nextSibling);
      } else {
        turnContainer.append(container);
      }
    }

    if (this.renderedTurns.childElementCount === turns.length) {
      return;
    }

    this.renderedTurns.innerHTML = '';
    for (const turn of turns) {
      this.renderedTurns.append(renderColdTurn(turnContainer.ownerDocument, turn));
    }
  }

  private updatePlaceholder(turnCount: number): void {
    if (this.placeholder == null) {
      return;
    }

    const summary = this.placeholder.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.placeholderSummary}`);
    const button = this.placeholder.querySelector<HTMLButtonElement>(
      '[data-turbo-render-action="restore-initial-cold"]',
    );

    if (summary != null) {
      summary.textContent = this.restored
        ? `Restored ${turnCount} trimmed turns in read-only mode.`
        : `Initial trim moved ${turnCount} older turns out of the official render path.`;
    }

    if (button != null) {
      button.disabled = this.restored;
      button.textContent =
        this.restoreMode === 'readOnly'
          ? `${PLACEHOLDER_TEXT.restoreHistory} (read-only)`
          : PLACEHOLDER_TEXT.restoreHistory;
    }
  }
}
