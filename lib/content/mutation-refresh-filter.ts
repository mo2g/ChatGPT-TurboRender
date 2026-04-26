import { isTurboRenderUiNode } from './chatgpt-adapter';
import { findClosestTurnNode } from './turbo-render-controller-utils';

export function shouldRefreshForMutations(
  mutations: MutationRecord[],
  context: {
    now: number;
    ignoreMutationsUntil: number;
    ignoreScrollUntil: number;
    hasPendingScrollRefresh: boolean;
    largeConversation: boolean;
  },
): boolean {
  if (
    context.now < context.ignoreMutationsUntil ||
    context.now < context.ignoreScrollUntil ||
    context.hasPendingScrollRefresh
  ) {
    return false;
  }

  const hasStructuralTurnChange = (nodes: Node[]): boolean =>
    nodes.some((node) => {
      if (!(node instanceof Element) || isTurboRenderUiNode(node)) {
        return false;
      }
      return (
        findClosestTurnNode(node) != null ||
        node.querySelector('[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn') != null
      );
    });

  return mutations.some((mutation) => {
    if (mutation.target instanceof Element && isTurboRenderUiNode(mutation.target)) {
      return false;
    }

    if (mutation.type === 'attributes') {
      if (!(mutation.target instanceof Element)) {
        return false;
      }
      const turnRoot = findClosestTurnNode(mutation.target);
      if (turnRoot == null) {
        return false;
      }

      const attributeName = mutation.attributeName ?? '';
      if (attributeName === 'aria-busy') {
        return mutation.target === turnRoot || mutation.target.closest('[aria-busy]') === turnRoot;
      }
      if (attributeName === 'data-message-id' || attributeName === 'data-message-author-role') {
        return mutation.target === turnRoot;
      }
      if (attributeName === 'data-testid') {
        return (
          mutation.target === turnRoot ||
          mutation.target.matches('[data-testid^="conversation-turn-"], [data-testid="stop-button"]')
        );
      }
      return false;
    }

    if (mutation.type !== 'childList') {
      return false;
    }

    const targetTurn = findClosestTurnNode(mutation.target);
    if (targetTurn != null) {
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      const targetElement = mutation.target instanceof Element ? mutation.target : null;
      if (
        context.largeConversation &&
        targetElement != null &&
        targetElement !== targetTurn &&
        !targetElement.matches('[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn') &&
        !hasStructuralTurnChange(changedNodes)
      ) {
        return false;
      }
      if (
        changedNodes.some((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            return (node.textContent?.trim().length ?? 0) > 0;
          }
          if (!(node instanceof Element)) {
            return false;
          }
          if (isTurboRenderUiNode(node)) {
            return false;
          }
          return true;
        })
      ) {
        return true;
      }

      return (
        targetElement != null &&
        (targetElement === targetTurn ||
          targetElement.matches('[data-testid^="conversation-turn-"], [data-message-author-role]'))
      );
    }

    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    if (context.largeConversation) {
      return hasStructuralTurnChange(changedNodes);
    }

    return hasStructuralTurnChange(changedNodes);
  });
}
