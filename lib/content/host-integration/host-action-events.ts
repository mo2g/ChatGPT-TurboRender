export function dispatchHumanClick(target: HTMLElement): void {
  if (dispatchReactLikeClick(target)) {
    return;
  }

  const rect = target.getBoundingClientRect();
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  const dispatchPointer = (type: string, buttons: number): void => {
    const eventInit = {
      bubbles: true,
      cancelable: true,
      clientX: centerX,
      clientY: centerY,
      button: 0,
      buttons,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    } as PointerEventInit;
    if (typeof PointerEvent === 'function') {
      target.dispatchEvent(new PointerEvent(type, eventInit));
      return;
    }
    target.dispatchEvent(new MouseEvent(type, eventInit));
  };

  dispatchPointer('pointerover', 0);
  dispatchPointer('pointerenter', 0);
  target.dispatchEvent(
    new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      clientX: centerX,
      clientY: centerY,
      button: 0,
      buttons: 0,
    }),
  );
  target.dispatchEvent(
    new MouseEvent('mouseenter', {
      bubbles: true,
      cancelable: true,
      clientX: centerX,
      clientY: centerY,
      button: 0,
      buttons: 0,
    }),
  );
  dispatchPointer('pointerdown', 1);
  target.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: centerX,
      clientY: centerY,
      button: 0,
      buttons: 1,
    }),
  );
  dispatchPointer('pointerup', 0);
  target.dispatchEvent(
    new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      clientX: centerX,
      clientY: centerY,
      button: 0,
      buttons: 0,
    }),
  );
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: centerX,
      clientY: centerY,
      button: 0,
      buttons: 0,
    }),
  );
}

function dispatchReactLikeClick(target: HTMLElement): boolean {
  const reactProps = getReactProps(target);
  if (reactProps == null) {
    return false;
  }

  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const createEvent = (buttons: number) => {
    const clientX = rect.x + rect.width / 2;
    const clientY = rect.y + rect.height / 2;
    let defaultPrevented = false;
    const event = {
      isTrusted: true,
      get defaultPrevented(): boolean {
        return defaultPrevented;
      },
      button: 0,
      buttons,
      clientX,
      clientY,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      pointerType: 'mouse',
      detail: 1,
      target,
      currentTarget: target,
      nativeEvent: undefined as unknown,
      preventDefault(): void {
        defaultPrevented = true;
      },
      stopPropagation(): void {
        // No-op for the synthetic host bridge.
      },
    } as {
      isTrusted: boolean;
      defaultPrevented: boolean;
      button: number;
      buttons: number;
      clientX: number;
      clientY: number;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      pointerType: string;
      detail: number;
      target: EventTarget | null;
      currentTarget: EventTarget | null;
      nativeEvent: unknown;
      preventDefault(): void;
      stopPropagation(): void;
    };
    event.nativeEvent = {
      isTrusted: true,
      button: event.button,
      buttons: event.buttons,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      pointerType: event.pointerType,
      detail: event.detail,
      target,
      currentTarget: target,
      get defaultPrevented(): boolean {
        return defaultPrevented;
      },
      preventDefault(): void {
        defaultPrevented = true;
      },
      stopPropagation(): void {
        // No-op for the synthetic host bridge.
      },
    } as unknown;
    return event;
  };

  const invoke = (name: string, event: ReturnType<typeof createEvent>): boolean => {
    const handler = reactProps[name];
    if (typeof handler !== 'function') {
      return false;
    }

    try {
      handler(event);
    } catch {
      // Fall through to the DOM event bridge below when React props misbehave.
    }
    return true;
  };

  const pointerMoveEvent = createEvent(1);
  const pointerDownEvent = createEvent(1);
  const pointerUpEvent = createEvent(0);
  const clickEvent = createEvent(0);
  let invoked = false;
  invoked = invoke('onPointerMove', pointerMoveEvent) || invoked;
  invoked = invoke('onPointerDown', pointerDownEvent) || invoked;
  invoked = invoke('onPointerUp', pointerUpEvent) || invoked;
  invoked = invoke('onClick', clickEvent) || invoked;

  return invoked;
}

function getReactProps(target: HTMLElement): Record<string, unknown> | null {
  const propsKey = Reflect.ownKeys(target).find(
    (key): key is string => typeof key === 'string' && key.startsWith('__reactProps'),
  );
  if (propsKey == null) {
    return null;
  }

  const props = (target as unknown as Record<string, unknown>)[propsKey];
  if (props == null || typeof props !== 'object') {
    return null;
  }

  return props as Record<string, unknown>;
}

