export function isProtectedTurn(input: {
  node: HTMLElement | null;
  doc: Document;
  win: Window;
  lastInteractionNode: Node | null;
  lastInteractionAt: number;
}): boolean {
  const { node, doc, win, lastInteractionNode, lastInteractionAt } = input;
  if (node == null) {
    return false;
  }

  const activeElement = doc.activeElement;
  if (activeElement != null && node.contains(activeElement)) {
    return true;
  }

  const selection = win.getSelection();
  if (selection != null && selection.rangeCount > 0) {
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if ((anchorNode != null && node.contains(anchorNode)) || (focusNode != null && node.contains(focusNode))) {
      return true;
    }
  }

  return lastInteractionNode != null && win.performance.now() - lastInteractionAt < 1500 && node.contains(lastInteractionNode);
}
