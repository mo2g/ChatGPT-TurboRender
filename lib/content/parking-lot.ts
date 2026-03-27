import { PLACEHOLDER_GROUP_ATTRIBUTE, UI_CLASS_NAMES } from '../shared/constants';
import { createTranslator, type Translator } from '../shared/i18n';
import type { ParkingMode, ParkedGroup, ParkedGroupSummary } from '../shared/types';

export interface ParkRequest {
  id: string;
  mode: ParkingMode;
  parent: HTMLElement;
  startIndex: number;
  endIndex: number;
  turnIds: string[];
  nodes: HTMLElement[];
}

export class ParkingLot {
  private groups = new Map<string, ParkedGroup>();
  private t: Translator = createTranslator('en');

  setTranslator(translator: Translator): void {
    this.t = translator;
    for (const group of this.groups.values()) {
      this.updatePlaceholderCopy(group);
    }
  }

  park(request: ParkRequest): ParkedGroup | null {
    if (this.groups.has(request.id) || request.nodes.length === 0) {
      return null;
    }

    const firstNode = request.nodes[0]!;
    const placeholder = this.createPlaceholder(request);
    request.parent.insertBefore(placeholder, firstNode);

    if (request.mode === 'hard') {
      for (const node of request.nodes) {
        request.parent.removeChild(node);
      }
    } else {
      for (const node of request.nodes) {
        node.classList.add(UI_CLASS_NAMES.softFolded);
        node.setAttribute('aria-hidden', 'true');
      }
    }

    const group: ParkedGroup = {
      id: request.id,
      mode: request.mode,
      startIndex: request.startIndex,
      endIndex: request.endIndex,
      turnIds: [...request.turnIds],
      nodes: [...request.nodes],
      parent: request.parent,
      placeholder,
    };

    this.groups.set(group.id, group);
    return group;
  }

  restoreGroup(id: string, fallbackBefore?: Node | null): boolean {
    const group = this.groups.get(id);
    if (group == null) {
      return false;
    }

    const parent = group.placeholder.parentElement ?? group.parent;
    const reference = group.placeholder.isConnected ? group.placeholder : fallbackBefore ?? null;

    if (group.mode === 'hard') {
      const fragment = parent.ownerDocument.createDocumentFragment();
      for (const node of group.nodes) {
        fragment.appendChild(node);
      }
      parent.insertBefore(fragment, reference);
    } else {
      for (const node of group.nodes) {
        node.classList.remove(UI_CLASS_NAMES.softFolded);
        node.removeAttribute('aria-hidden');
      }
    }

    if (group.placeholder.isConnected) {
      group.placeholder.remove();
    }

    this.groups.delete(id);
    return true;
  }

  restoreAll(): number {
    const groups = [...this.groups.values()].sort((left, right) => left.startIndex - right.startIndex);
    let restored = 0;

    for (const group of groups) {
      if (this.restoreGroup(group.id)) {
        restored += 1;
      }
    }

    return restored;
  }

  getGroup(id: string): ParkedGroup | undefined {
    return this.groups.get(id);
  }

  has(id: string): boolean {
    return this.groups.has(id);
  }

  getSummaries(): ParkedGroupSummary[] {
    return [...this.groups.values()]
      .sort((left, right) => left.startIndex - right.startIndex)
      .map((group) => ({
        id: group.id,
        mode: group.mode,
        startIndex: group.startIndex,
        endIndex: group.endIndex,
        count: group.turnIds.length,
      }));
  }

  getTotalParkedTurns(): number {
    return [...this.groups.values()].reduce((sum, group) => sum + group.turnIds.length, 0);
  }

  findGroupIdByPlaceholder(node: Element | null): string | null {
    const placeholder = node?.closest<HTMLElement>(`[${PLACEHOLDER_GROUP_ATTRIBUTE}]`) ?? null;
    if (placeholder == null) {
      return null;
    }
    return placeholder.getAttribute(PLACEHOLDER_GROUP_ATTRIBUTE);
  }

  getDisconnectedHardGroups(): ParkedGroup[] {
    return [...this.groups.values()].filter(
      (group) => group.mode === 'hard' && !group.placeholder.isConnected,
    );
  }

  private createPlaceholder(request: ParkRequest): HTMLElement {
    const placeholder = request.parent.ownerDocument.createElement('div');
    placeholder.className = UI_CLASS_NAMES.placeholder;
    placeholder.setAttribute(PLACEHOLDER_GROUP_ATTRIBUTE, request.id);
    placeholder.dataset.turboRenderStart = String(request.startIndex);
    placeholder.dataset.turboRenderEnd = String(request.endIndex);
    placeholder.innerHTML = `
      <div class="${UI_CLASS_NAMES.placeholderSummary}"></div>
      <div class="${UI_CLASS_NAMES.placeholderActions}">
        <button type="button" data-turbo-render-action="restore-group" data-group-id="${request.id}"></button>
      </div>
    `;
    this.updatePlaceholderCopy({
      id: request.id,
      mode: request.mode,
      startIndex: request.startIndex,
      endIndex: request.endIndex,
      turnIds: [...request.turnIds],
      nodes: [...request.nodes],
      parent: request.parent,
      placeholder,
    });
    return placeholder;
  }

  private updatePlaceholderCopy(group: Pick<ParkedGroup, 'placeholder' | 'turnIds' | 'startIndex' | 'endIndex'>): void {
    const summary = group.placeholder.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.placeholderSummary}`);
    const button = group.placeholder.querySelector<HTMLButtonElement>('[data-turbo-render-action="restore-group"]');

    if (summary != null) {
      summary.textContent = this.t('placeholderFoldedTurns', {
        count: group.turnIds.length,
        start: group.startIndex + 1,
        end: group.endIndex + 1,
      });
    }

    if (button != null) {
      button.textContent = this.t('actionRestore');
    }
  }
}
