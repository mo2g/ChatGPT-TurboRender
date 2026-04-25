import { UI_CLASS_NAMES } from '../shared/constants';
import type { ParkingMode, ParkedGroup, ParkedGroupSummary } from '../shared/types';

export interface ParkRequest {
  id: string;
  mode: ParkingMode;
  parent: HTMLElement;
  startIndex: number;
  endIndex: number;
  turnIds: string[];
  nodes: HTMLElement[];
  pairStartIndex: number;
  pairEndIndex: number;
  pairCount: number;
  archivePageIndex: number | null;
}

function resolveParkedNodeMessageId(node: HTMLElement): string | null {
  const direct = node.getAttribute('data-message-id')?.trim();
  if (direct != null && direct.length > 0) {
    return direct;
  }

  for (const descendant of node.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const messageId = descendant.getAttribute('data-message-id')?.trim();
    if (messageId != null && messageId.length > 0) {
      return messageId;
    }
  }

  let current = node.parentElement;
  while (current != null) {
    const ancestorId = current.getAttribute('data-message-id')?.trim();
    if (ancestorId != null && ancestorId.length > 0) {
      return ancestorId;
    }
    current = current.parentElement;
  }

  return null;
}

function createNodeFromHtml(ownerDocument: Document, html: string): HTMLElement | null {
  const template = ownerDocument.createElement('template');
  template.innerHTML = html;
  const element = template.content.firstElementChild;
  return element instanceof HTMLElement ? element : null;
}

export class ParkingLot {
  private groups = new Map<string, ParkedGroup>();
  private parkedTurnIds = new Set<string>();

  setTranslator(_: unknown = undefined): void {}

  park(request: ParkRequest): ParkedGroup | null {
    if (this.groups.has(request.id) || request.nodes.length === 0) {
      return null;
    }

    const firstNode = request.nodes[0]!;
    const anchor = request.parent.ownerDocument.createComment(`turbo-render:${request.id}`);
    request.parent.insertBefore(anchor, firstNode);

    if (request.mode === 'hard') {
      for (const node of request.nodes) {
        if (node.parentElement === request.parent) {
          request.parent.removeChild(node);
        }
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
      parkingState: 'resident',
      startIndex: request.startIndex,
      endIndex: request.endIndex,
      turnIds: [...request.turnIds],
      messageIds: request.nodes.map((node) => resolveParkedNodeMessageId(node)),
      nodes: [...request.nodes],
      serializedNodesHtml: null,
      parent: request.parent,
      anchor,
      pairStartIndex: request.pairStartIndex,
      pairEndIndex: request.pairEndIndex,
      pairCount: request.pairCount,
      archivePageIndex: request.archivePageIndex,
    };

    this.groups.set(group.id, group);
    for (const turnId of group.turnIds) {
      this.parkedTurnIds.add(turnId);
    }
    return group;
  }

  serializeGroup(id: string): boolean {
    const group = this.groups.get(id);
    if (group == null || group.mode !== 'hard') {
      return false;
    }

    if (group.nodes.length === 0) {
      group.parkingState = 'serialized';
      return true;
    }

    group.serializedNodesHtml = group.nodes.map((node) => node.outerHTML);
    group.nodes = [];
    group.parkingState = 'serialized';
    return true;
  }

  rehydrateGroup(id: string): boolean {
    const group = this.groups.get(id);
    if (group == null || group.mode !== 'hard') {
      return false;
    }

    if (group.nodes.length > 0) {
      group.parkingState = 'resident';
      return true;
    }

    if (group.serializedNodesHtml == null) {
      return false;
    }

    const ownerDocument = group.parent.ownerDocument;
    const nodes = group.serializedNodesHtml.map((html) => createNodeFromHtml(ownerDocument, html));
    if (nodes.some((node) => node == null)) {
      return false;
    }

    group.nodes = nodes.filter((node): node is HTMLElement => node != null);
    group.parkingState = 'resident';
    return true;
  }

  getResidentGroupCount(): number {
    return [...this.groups.values()].filter((group) => group.parkingState === 'resident').length;
  }

  getSerializedGroupCount(): number {
    return [...this.groups.values()].filter((group) => group.parkingState === 'serialized').length;
  }

  restoreGroup(id: string, fallbackBefore?: Node | null): boolean {
    const group = this.groups.get(id);
    if (group == null) {
      return false;
    }

    const parent = (group.anchor.parentNode as HTMLElement | null) ?? group.parent;
    const reference = group.anchor.isConnected ? group.anchor : fallbackBefore ?? null;

    if (group.mode === 'hard') {
      if (!this.rehydrateGroup(id)) {
        return false;
      }
      const residentGroup = this.groups.get(id);
      if (residentGroup == null) {
        return false;
      }
      const fragment = parent.ownerDocument.createDocumentFragment();
      for (const node of residentGroup.nodes) {
        fragment.appendChild(node);
      }
      parent.insertBefore(fragment, reference);
    } else {
      for (const node of group.nodes) {
        node.classList.remove(UI_CLASS_NAMES.softFolded);
        node.removeAttribute('aria-hidden');
      }
    }

    if (group.anchor.isConnected) {
      group.anchor.remove();
    }

    this.groups.delete(id);
    for (const turnId of group.turnIds) {
      this.parkedTurnIds.delete(turnId);
    }
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

  isTurnParked(turnId: string): boolean {
    return this.parkedTurnIds.has(turnId);
  }

  getParkedTurnIds(): Set<string> {
    return new Set(this.parkedTurnIds);
  }

  getSummaries(): ParkedGroupSummary[] {
    return [...this.groups.values()]
      .sort((left, right) => left.startIndex - right.startIndex)
      .map((group) => ({
        id: group.id,
        mode: group.mode,
        parkingState: group.parkingState,
        startIndex: group.startIndex,
        endIndex: group.endIndex,
        count: group.turnIds.length,
        pairStartIndex: group.pairStartIndex,
        pairEndIndex: group.pairEndIndex,
        pairCount: group.pairCount,
        archivePageIndex: group.archivePageIndex,
        matchCount: 0,
      }));
  }

  getSummariesForPage(pageIndex: number): ParkedGroupSummary[] {
    return this.getSummaries().filter((summary) => summary.archivePageIndex === pageIndex);
  }

  getParkedGroupCountForPage(pageIndex: number): number {
    return this.getSummariesForPage(pageIndex).length;
  }

  getTotalParkedTurns(): number {
    return [...this.groups.values()].reduce((sum, group) => sum + group.turnIds.length, 0);
  }

  getDisconnectedHardGroups(): ParkedGroup[] {
    return [...this.groups.values()].filter((group) => group.mode === 'hard' && !group.anchor.isConnected);
  }
}
