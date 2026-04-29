import type { SlidingWindowRange } from '../../shared/sliding-window';
import type { SlidingWindowNavigationDirection } from './reload-command';

export interface SlidingWindowRenderTicket {
  conversationId: string;
  targetRange: SlidingWindowRange;
  requestedAt: number;
  reason: SlidingWindowNavigationDirection;
}

const renderTickets = new Map<string, SlidingWindowRenderTicket>();

export function writeSlidingWindowRenderTicket(ticket: SlidingWindowRenderTicket): void {
  renderTickets.set(ticket.conversationId, ticket);
}

export function readSlidingWindowRenderTicket(conversationId: string): SlidingWindowRenderTicket | null {
  return renderTickets.get(conversationId) ?? null;
}

export function clearSlidingWindowRenderTicket(conversationId: string): void {
  renderTickets.delete(conversationId);
}

export function consumeSlidingWindowRenderTicket(conversationId: string): SlidingWindowRenderTicket | null {
  const ticket = readSlidingWindowRenderTicket(conversationId);
  clearSlidingWindowRenderTicket(conversationId);
  return ticket;
}

export function clearAllSlidingWindowRenderTickets(): void {
  renderTickets.clear();
}
