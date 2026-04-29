const COMPOSER_SELECTOR = [
  'textarea',
  '[contenteditable="true"]',
  '[role="textbox"][contenteditable="true"]',
].join(',');

const SEND_BUTTON_SELECTOR = [
  'button[data-testid="send-button"]',
  'button[data-testid="composer-submit-button"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="发送"]',
].join(',');

export class SlidingWindowReadonlyGuard {
  private readonly doc: Document;

  constructor(doc: Document = document) {
    this.doc = doc;
  }

  apply(readonly: boolean): void {
    if (readonly) {
      this.disableComposer();
      return;
    }

    this.restoreComposer();
  }

  private disableComposer(): void {
    for (const element of this.doc.querySelectorAll<HTMLElement>(COMPOSER_SELECTOR)) {
      if (element.closest('[data-turbo-render-ui-root="true"]') != null) {
        continue;
      }

      element.dataset.turboRenderReadonlyGuard = 'true';
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        element.dataset.turboRenderReadonlyOriginalDisabled = element.disabled ? 'true' : 'false';
        element.disabled = true;
        continue;
      }

      if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
        element.dataset.turboRenderReadonlyOriginalContenteditable = element.getAttribute('contenteditable') ?? '';
        element.setAttribute('contenteditable', 'false');
      }
      element.setAttribute('aria-disabled', 'true');
    }

    for (const button of this.doc.querySelectorAll<HTMLButtonElement>(SEND_BUTTON_SELECTOR)) {
      if (button.closest('[data-turbo-render-ui-root="true"]') != null) {
        continue;
      }

      button.dataset.turboRenderReadonlyGuard = 'true';
      button.dataset.turboRenderReadonlyOriginalDisabled = button.disabled ? 'true' : 'false';
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    }
  }

  private restoreComposer(): void {
    for (const element of this.doc.querySelectorAll<HTMLElement>('[data-turbo-render-readonly-guard="true"]')) {
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        if (element.dataset.turboRenderReadonlyOriginalDisabled !== 'true') {
          element.disabled = false;
        }
      } else if (element.dataset.turboRenderReadonlyOriginalContenteditable != null) {
        const original = element.dataset.turboRenderReadonlyOriginalContenteditable;
        if (original.length === 0) {
          element.removeAttribute('contenteditable');
        } else {
          element.setAttribute('contenteditable', original);
        }
      }

      if (element instanceof HTMLButtonElement && element.dataset.turboRenderReadonlyOriginalDisabled !== 'true') {
        element.disabled = false;
      }
      element.removeAttribute('aria-disabled');
      delete element.dataset.turboRenderReadonlyGuard;
      delete element.dataset.turboRenderReadonlyOriginalDisabled;
      delete element.dataset.turboRenderReadonlyOriginalContenteditable;
    }
  }
}
