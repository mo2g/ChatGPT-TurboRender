import { describe, expect, it } from 'vitest';

import { ParkingLot } from "../../lib/content/managers/parking-lot";

function createParkedNode(messageId: string, text: string): HTMLElement {
  const node = document.createElement('article');
  node.dataset.messageId = messageId;
  node.textContent = text;
  return node;
}

function parkGroup(
  lot: ParkingLot,
  input: {
    id: string;
    parent: HTMLElement;
    startIndex: number;
    endIndex: number;
    turnIds: string[];
    nodes: HTMLElement[];
    pairStartIndex: number;
    pairEndIndex: number;
    pairCount: number;
    archivePageIndex: number;
  },
): void {
  const parked = lot.park({
    ...input,
    mode: 'hard',
  });

  expect(parked).not.toBeNull();
}

describe('ParkingLot', () => {
  it('stores page metadata on parked groups and filters summaries by page', () => {
    const lot = new ParkingLot();

    const parentA = document.createElement('div');
    const groupANode = createParkedNode('message-a', 'group-a');
    parentA.append(groupANode);
    parkGroup(lot, {
      id: 'group-a',
      parent: parentA,
      startIndex: 0,
      endIndex: 0,
      turnIds: ['turn-a'],
      nodes: [groupANode],
      pairStartIndex: 0,
      pairEndIndex: 0,
      pairCount: 1,
      archivePageIndex: 2,
    });

    const parentB = document.createElement('div');
    const groupBNode = createParkedNode('message-b', 'group-b');
    parentB.append(groupBNode);
    parkGroup(lot, {
      id: 'group-b',
      parent: parentB,
      startIndex: 2,
      endIndex: 2,
      turnIds: ['turn-b'],
      nodes: [groupBNode],
      pairStartIndex: 2,
      pairEndIndex: 2,
      pairCount: 1,
      archivePageIndex: 2,
    });

    const parentC = document.createElement('div');
    const groupCNode = createParkedNode('message-c', 'group-c');
    parentC.append(groupCNode);
    parkGroup(lot, {
      id: 'group-c',
      parent: parentC,
      startIndex: 4,
      endIndex: 4,
      turnIds: ['turn-c'],
      nodes: [groupCNode],
      pairStartIndex: 4,
      pairEndIndex: 4,
      pairCount: 1,
      archivePageIndex: 4,
    });

    expect(lot.getGroup('group-a')).toMatchObject({ archivePageIndex: 2 });
    expect(lot.getSummaries()).toMatchObject([
      { id: 'group-a', archivePageIndex: 2, parkingState: 'resident' },
      { id: 'group-b', archivePageIndex: 2, parkingState: 'resident' },
      { id: 'group-c', archivePageIndex: 4, parkingState: 'resident' },
    ]);
    expect(lot.getSummariesForPage(2).map((summary) => summary.id)).toEqual(['group-a', 'group-b']);
    expect(lot.getSummariesForPage(4).map((summary) => summary.id)).toEqual(['group-c']);
    expect(lot.getSummariesForPage(1)).toEqual([]);
    expect(lot.getParkedGroupCountForPage(2)).toBe(2);
    expect(lot.getParkedGroupCountForPage(4)).toBe(1);
  });

  it('restores hard parked groups even when page metadata is present', () => {
    const lot = new ParkingLot();
    const parent = document.createElement('div');
    const node = createParkedNode('message-restored', 'restored group');
    parent.append(node);

    parkGroup(lot, {
      id: 'group-restored',
      parent,
      startIndex: 0,
      endIndex: 0,
      turnIds: ['turn-restored'],
      nodes: [node],
      pairStartIndex: 10,
      pairEndIndex: 10,
      pairCount: 1,
      archivePageIndex: 3,
    });

    expect(lot.getGroup('group-restored')).toMatchObject({ archivePageIndex: 3 });
    expect(lot.restoreAll()).toBe(1);
    expect(parent.contains(node)).toBe(true);
    expect(parent.querySelector('[data-message-id="message-restored"]')).toBe(node);
    expect(lot.getGroup('group-restored')).toBeUndefined();
    expect(lot.getParkedTurnIds().has('turn-restored')).toBe(false);
    expect(lot.getSummariesForPage(3)).toEqual([]);
  });

  it('serializes hard groups outside the resident window and rehydrates them on demand', () => {
    const lot = new ParkingLot();
    const parent = document.createElement('div');
    const node = createParkedNode('message-cache', 'cached group');
    parent.append(node);

    parkGroup(lot, {
      id: 'group-cache',
      parent,
      startIndex: 0,
      endIndex: 0,
      turnIds: ['turn-cache'],
      nodes: [node],
      pairStartIndex: 20,
      pairEndIndex: 20,
      pairCount: 1,
      archivePageIndex: 3,
    });

    expect(lot.getResidentGroupCount()).toBe(1);
    expect(lot.getSerializedGroupCount()).toBe(0);

    expect(lot.serializeGroup('group-cache')).toBe(true);
    const serializedGroup = lot.getGroup('group-cache');
    expect(serializedGroup).toMatchObject({
      parkingState: 'serialized',
      nodes: [],
    });
    expect(serializedGroup?.serializedNodesHtml).toEqual([node.outerHTML]);
    expect(lot.getResidentGroupCount()).toBe(0);
    expect(lot.getSerializedGroupCount()).toBe(1);

    expect(lot.rehydrateGroup('group-cache')).toBe(true);
    const rehydratedGroup = lot.getGroup('group-cache');
    expect(rehydratedGroup).toMatchObject({
      parkingState: 'resident',
    });
    expect(rehydratedGroup?.nodes).toHaveLength(1);
    expect(rehydratedGroup?.nodes[0]?.textContent).toBe('cached group');

    expect(lot.restoreAll()).toBe(1);
    const restoredNode = parent.querySelector('[data-message-id="message-cache"]');
    expect(restoredNode).not.toBeNull();
    expect(restoredNode).not.toBe(node);
    expect(lot.getGroup('group-cache')).toBeUndefined();
    expect(lot.getParkedTurnIds().has('turn-cache')).toBe(false);
  });

  it('keeps soft groups resident without serialization', () => {
    const lot = new ParkingLot();
    const parent = document.createElement('div');
    const node = createParkedNode('message-soft', 'soft group');
    parent.append(node);

    const parked = lot.park({
      id: 'group-soft',
      mode: 'soft',
      parent,
      startIndex: 0,
      endIndex: 0,
      turnIds: ['turn-soft'],
      nodes: [node],
      pairStartIndex: 0,
      pairEndIndex: 0,
      pairCount: 1,
      archivePageIndex: 0,
    });

    expect(parked).not.toBeNull();
    expect(lot.serializeGroup('group-soft')).toBe(false);
    expect(lot.rehydrateGroup('group-soft')).toBe(false);
    expect(lot.getGroup('group-soft')).toMatchObject({
      parkingState: 'resident',
      serializedNodesHtml: null,
    });
    expect(lot.getResidentGroupCount()).toBe(1);
    expect(lot.getSerializedGroupCount()).toBe(0);
  });
});
