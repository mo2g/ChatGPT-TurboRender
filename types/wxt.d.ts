declare module 'wxt/utils/content-script-context' {
  export interface ContentScriptContext {
    isInvalid: boolean;
    onInvalidated(callback: () => void): void;
    addEventListener<T extends EventTarget>(
      target: T,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions
    ): void;
    setInterval(callback: () => void, delay: number): number;
    clearInterval(id: number): void;
    setTimeout(callback: () => void, delay: number): number;
    clearTimeout(id: number): void;
  }
}

declare module 'wxt/utils/define-content-script' {
  import type { ContentScriptContext } from 'wxt/utils/content-script-context';

  export const defineContentScript: (config: {
    matches: string[];
    runAt: 'document_start' | 'document_end' | 'document_idle';
    world?: 'ISOLATED' | 'MAIN';
    main(ctx: ContentScriptContext): void | Promise<void>;
  }) => unknown;
}

declare module 'wxt/utils/define-background' {
  export function defineBackground(fn: () => void): unknown;
}
