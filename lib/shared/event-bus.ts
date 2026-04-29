// Simple typed event bus for decoupled state synchronization
// Replaces repetitive scheduleRefresh() calls with event-driven architecture

export type EventHandler<T = unknown> = (payload: T) => void;

export class TypedEventBus<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<EventHandler<Events[keyof Events]>>>();

  on<K extends keyof Events>(type: K, handler: EventHandler<Events[K]>): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler as EventHandler<Events[keyof Events]>);
    this.listeners.set(type, set);

    return () => {
      set.delete(handler as EventHandler<Events[keyof Events]>);
    };
  }

    off<K extends keyof Events>(type: K, handler: EventHandler<Events[K]>): void {
    const handlers = this.listeners.get(type);
    if (handlers) {
      handlers.delete(handler as EventHandler<Events[keyof Events]>);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

// Controller-specific event types
export type ControllerEvents = {
  refreshNeeded: { reason: string; priority?: 'high' | 'normal' | 'low' };
  archiveToggled: { groupId: string };
  settingsChanged: { settings: Record<string, unknown> };
  pauseToggled: { paused: boolean };
  chatChanged: { chatId: string };
};

// Global controller event bus instance
new TypedEventBus<ControllerEvents>();
