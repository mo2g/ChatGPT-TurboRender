import { isTurboRenderUiNode } from './chatgpt-adapter';
import { requestAnimationFrameCompat } from './turbo-render-controller-utils';

type AnchoredHostMenu = {
  target: HTMLElement;
  menu: HTMLElement;
  previousInlineStyle: string | null;
};

export class HostMenuPositioning {
  private anchoredHostMenu: AnchoredHostMenu | null = null;

  constructor(
    private readonly doc: Document,
    private readonly win: Window,
    private readonly getTopPageChromeOffset: () => number,
  ) {}

  getVisibleHostMenus(): HTMLElement[] {
    return [...this.doc.querySelectorAll<HTMLElement>('[role="menu"]')].filter((candidate) => {
      if (isTurboRenderUiNode(candidate)) {
        return false;
      }
      if (candidate.getClientRects().length <= 0) {
        return false;
      }
      const style = this.win.getComputedStyle(candidate);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  findPreferredHostMenu(previousMenus: Set<HTMLElement>, anchor: HTMLElement | null): HTMLElement | null {
    const menus = this.getVisibleHostMenus();
    const candidatePools = [
      menus.filter((menu) => !previousMenus.has(menu)),
      menus,
    ];

    for (const pool of candidatePools) {
      if (pool.length === 0) {
        continue;
      }

      if (anchor == null) {
        return pool[0] ?? null;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const scored = pool
        .map((menu) => {
          const rect = this.resolveHostMenuPositionTarget(menu).getBoundingClientRect();
          const leftDelta = Math.abs(rect.left - anchorRect.left);
          const verticalDelta = Math.abs(rect.bottom - anchorRect.top);
          const score = leftDelta + verticalDelta * 2;
          return { menu, score };
        })
        .sort((left, right) => left.score - right.score);

      if ((scored[0]?.menu ?? null) != null) {
        return scored[0]!.menu;
      }
    }

    return null;
  }

  temporarilyAnchorHostActionTarget(target: HTMLElement, anchor: HTMLElement): (() => void) | null {
    const anchorRect = anchor.getBoundingClientRect();
    if (anchorRect.width <= 0 || anchorRect.height <= 0) {
      return null;
    }

    const previousStyle = target.getAttribute('style');
    target.style.setProperty('position', 'fixed', 'important');
    target.style.setProperty('left', `${Math.round(anchorRect.left)}px`, 'important');
    target.style.setProperty('top', `${Math.round(anchorRect.top)}px`, 'important');
    target.style.setProperty('width', `${Math.max(1, Math.round(anchorRect.width))}px`, 'important');
    target.style.setProperty('height', `${Math.max(1, Math.round(anchorRect.height))}px`, 'important');
    target.style.setProperty('right', 'auto', 'important');
    target.style.setProperty('bottom', 'auto', 'important');
    target.style.setProperty('margin', '0', 'important');
    target.style.setProperty('transform', 'none', 'important');
    target.style.setProperty('opacity', '0', 'important');
    target.style.setProperty('pointer-events', 'none', 'important');
    target.style.setProperty('z-index', '-1', 'important');

    return () => {
      if (previousStyle == null || previousStyle.length === 0) {
        target.removeAttribute('style');
      } else {
        target.setAttribute('style', previousStyle);
      }
    };
  }

  scheduleHostActionTargetRestore(restore: () => void, frames: number): void {
    if (frames <= 0) {
      restore();
      return;
    }

    const step = (remaining: number): void => {
      if (remaining <= 0) {
        restore();
        return;
      }

      requestAnimationFrameCompat(this.win, () => {
        step(remaining - 1);
      });
    };

    step(frames);
  }

  positionVisibleHostMenuToAnchor(menu: HTMLElement, anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const positionTarget = this.resolveHostMenuPositionTarget(menu);
    const menuRect = positionTarget.getBoundingClientRect();
    if (anchorRect.width <= 0 || anchorRect.height <= 0 || menuRect.width <= 0 || menuRect.height <= 0) {
      return;
    }

    const gap = 8;
    const viewportPadding = 8;
    const topLimit = Math.max(viewportPadding, this.getTopPageChromeOffset() + viewportPadding);
    const viewportWidth = this.win.innerWidth || this.doc.documentElement.clientWidth || 0;
    const viewportHeight = this.win.innerHeight || this.doc.documentElement.clientHeight || 0;
    const preferredLeft = anchorRect.right - menuRect.width;
    const maxLeft = Math.max(viewportPadding, viewportWidth - menuRect.width - viewportPadding);
    const viewportLeft = Math.min(Math.max(viewportPadding, preferredLeft), maxLeft);
    const aboveTop = anchorRect.top - menuRect.height - gap;
    const belowTop = anchorRect.bottom + gap;
    const spaceAbove = anchorRect.top - topLimit;
    const spaceBelow = viewportHeight - anchorRect.bottom - viewportPadding;
    const placeAbove = spaceAbove >= menuRect.height + gap || spaceAbove >= spaceBelow;
    const preferredTop = placeAbove ? aboveTop : belowTop;
    const maxTop = Math.max(topLimit, viewportHeight - menuRect.height - viewportPadding);
    const viewportTop = Math.min(Math.max(topLimit, preferredTop), maxTop);

    this.captureAnchoredHostMenuStyle(positionTarget, menu);
    positionTarget.style.setProperty('position', 'fixed', 'important');
    positionTarget.style.setProperty('inset', 'auto', 'important');
    positionTarget.style.setProperty('left', `${Math.round(viewportLeft)}px`, 'important');
    positionTarget.style.setProperty('top', `${Math.round(viewportTop)}px`, 'important');
    positionTarget.style.setProperty('right', 'auto', 'important');
    positionTarget.style.setProperty('bottom', 'auto', 'important');
    positionTarget.style.setProperty('transform', 'none', 'important');
    positionTarget.style.setProperty('margin', '0', 'important');
    positionTarget.style.setProperty('z-index', '60', 'important');
    positionTarget.dataset.turboRenderHostMenuAnchored = 'true';
    positionTarget.dataset.turboRenderHostMenuPlacement = placeAbove ? 'above' : 'below';
    menu.dataset.turboRenderHostMenuAnchored = 'true';
    menu.dataset.turboRenderHostMenuPlacement = placeAbove ? 'above' : 'below';
  }

  restoreAnchoredHostMenuStyle(): void {
    const anchored = this.anchoredHostMenu;
    this.anchoredHostMenu = null;
    if (anchored == null) {
      return;
    }

    const { target, menu, previousInlineStyle } = anchored;
    delete target.dataset.turboRenderHostMenuAnchored;
    delete target.dataset.turboRenderHostMenuPlacement;
    delete menu.dataset.turboRenderHostMenuAnchored;
    delete menu.dataset.turboRenderHostMenuPlacement;
    if (previousInlineStyle == null || previousInlineStyle.length === 0) {
      target.removeAttribute('style');
    } else {
      target.setAttribute('style', previousInlineStyle);
    }
  }

  private resolveHostMenuPositionTarget(menu: HTMLElement): HTMLElement {
    const wrapper = menu.closest<HTMLElement>('[data-radix-popper-content-wrapper]');
    if (wrapper != null && !isTurboRenderUiNode(wrapper)) {
      return wrapper;
    }
    return menu;
  }

  private captureAnchoredHostMenuStyle(target: HTMLElement, menu: HTMLElement): void {
    if (this.anchoredHostMenu?.target === target) {
      return;
    }
    this.restoreAnchoredHostMenuStyle();
    this.anchoredHostMenu = {
      target,
      menu,
      previousInlineStyle: target.getAttribute('style'),
    };
  }
}
