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
      startIndex: request.startIndex,
      endIndex: request.endIndex,
      turnIds: [...request.turnIds],
      nodes: [...request.nodes],
      parent: request.parent,
      anchor,
      pairStartIndex: request.pairStartIndex,
      pairEndIndex: request.pairEndIndex,
      pairCount: request.pairCount,
    };

    this.groups.set(group.id, group);
    for (const turnId of group.turnIds) {
      this.parkedTurnIds.add(turnId);
    }
    return group;
  }

  restoreGroup(id: string, fallbackBefore?: Node | null): boolean {
    const group = this.groups.get(id);
    if (group == null) {
      return false;
    }

    const parent = (group.anchor.parentNode as HTMLElement | null) ?? group.parent;
    const reference = group.anchor.isConnected ? group.anchor : fallbackBefore ?? null;

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
        startIndex: group.startIndex,
        endIndex: group.endIndex,
        count: group.turnIds.length,
        pairStartIndex: group.pairStartIndex,
        pairEndIndex: group.pairEndIndex,
        pairCount: group.pairCount,
      }));
  }

  getTotalParkedTurns(): number {
    return [...this.groups.values()].reduce((sum, group) => sum + group.turnIds.length, 0);
  }

  getDisconnectedHardGroups(): ParkedGroup[] {
    return [...this.groups.values()].filter((group) => group.mode === 'hard' && !group.anchor.isConnected);
  }
}
