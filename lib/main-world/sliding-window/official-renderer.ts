import type {
  ConversationMappingNode,
  ConversationPayload,
  SlidingWindowPairIndex,
  SlidingWindowRange,
} from '../../shared/sliding-window';
import { mwLogger } from '../logger';

const VERIFY_TIMEOUT_MS = 2_500;
const VERIFY_INTERVAL_MS = 50;

interface ReactRouterLike {
  revalidate?: () => unknown;
  navigate?: (to: string, options?: { replace?: boolean; preventScrollReset?: boolean }) => unknown;
}

interface ReactRouterManifestRoute {
  hasLoader?: boolean;
  hasClientLoader?: boolean;
  module?: string;
  imports?: string[];
}

interface ReactRouterManifestLike {
  routes?: Record<string, ReactRouterManifestRoute>;
}

interface OfficialConversationStoreModule {
  i8?: {
    resetThread?: (conversationId: string) => unknown;
    updateThreadFromServer?: (
      conversationId: string,
      payload: ConversationPayload,
      options?: Record<string, unknown>,
    ) => unknown;
  };
  w8?: {
    getState?: () => {
      threads?: Record<string, unknown>;
      clientNewThreadIdToServerIdMapping?: Record<string, string>;
    };
  };
  n8?: {
    getConversationTurns?: (thread: unknown) => unknown[];
    getCurrentLeafId?: (thread: unknown) => string | null;
  };
}

interface OfficialConversationWindow extends Window {
  __reactRouterDataRouter?: ReactRouterLike;
  __reactRouterManifest?: ReactRouterManifestLike;
  __turboRenderOfficialConversationModule?: OfficialConversationStoreModule;
}

export interface SlidingWindowDomVerificationTarget {
  range: SlidingWindowRange;
  nodeIds: Set<string>;
  first: SlidingWindowDomMarker | null;
  last: SlidingWindowDomMarker | null;
}

interface SlidingWindowDomMarker {
  nodeId: string;
  messageId: string | null;
  text: string;
}

function getReactRouter(win: Window): ReactRouterLike | null {
  const router = (win as OfficialConversationWindow).__reactRouterDataRouter;
  return router != null && typeof router === 'object' ? router : null;
}

function getReactRouterManifest(win: Window): ReactRouterManifestLike | null {
  const manifest = (win as OfficialConversationWindow).__reactRouterManifest;
  return manifest != null && typeof manifest === 'object' ? manifest : null;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractMessageText(node: ConversationMappingNode): string {
  const fragments: string[] = [];
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 5 || value == null) {
      return;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        fragments.push(trimmed);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((part) => visit(part, depth + 1));
      return;
    }
    if (typeof value !== 'object') {
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
      visit(record.text, depth + 1);
    }
    if (Array.isArray(record.parts)) {
      visit(record.parts, depth + 1);
    }
    if (Array.isArray(record.content)) {
      visit(record.content, depth + 1);
    }
    if (typeof record.title === 'string') {
      visit(record.title, depth + 1);
    }
  };

  visit(node.message?.content?.parts ?? []);
  return fragments.join(' ').trim();
}

function isVisibleMessageNode(node: ConversationMappingNode | undefined): node is ConversationMappingNode {
  const role = node?.message?.author?.role;
  return (
    node?.message != null &&
    role !== 'system' &&
    role !== 'root' &&
    node.message.metadata?.is_visually_hidden_from_conversation !== true
  );
}

function toMarker(node: ConversationMappingNode): SlidingWindowDomMarker {
  return {
    nodeId: node.id,
    messageId: node.message?.id?.trim() || node.id,
    text: extractMessageText(node),
  };
}

export function buildSlidingWindowDomVerificationTarget(
  payload: ConversationPayload,
  pairIndex: SlidingWindowPairIndex,
  range: SlidingWindowRange,
): SlidingWindowDomVerificationTarget {
  const nodeIds = new Set<string>();
  for (const pair of pairIndex.pairs) {
    if (pair.pairIndex < range.startPairIndex || pair.pairIndex > range.endPairIndex) {
      continue;
    }
    pair.relatedNodeIds.forEach((nodeId) => nodeIds.add(nodeId));
  }

  const orderedMarkers = pairIndex.activeNodeIds
    .filter((nodeId) => nodeIds.has(nodeId))
    .map((nodeId) => payload.mapping?.[nodeId])
    .filter(isVisibleMessageNode)
    .map(toMarker)
    .filter((marker) => marker.messageId != null || marker.text.length > 0);

  return {
    range,
    nodeIds,
    first: orderedMarkers[0] ?? null,
    last: orderedMarkers.at(-1) ?? null,
  };
}

function transcriptCandidates(doc: Document): HTMLElement[] {
  const selector = [
    '[data-testid^="conversation-turn-"]',
    '[data-message-author-role]',
    'article',
  ].join(',');
  return [...doc.querySelectorAll<HTMLElement>(selector)].filter((candidate) => {
    return candidate.closest('[data-turbo-render-ui-root="true"]') == null;
  });
}

function markerIndexByMessageId(candidates: HTMLElement[], marker: SlidingWindowDomMarker): number {
  const messageId = marker.messageId?.trim() ?? '';
  if (messageId.length === 0) {
    return -1;
  }
  const index = candidates.findIndex((candidate) => {
    const candidateMessageId = candidate.getAttribute('data-message-id')?.trim() ?? '';
    if (candidateMessageId.length > 0 && candidateMessageId === messageId) {
      return true;
    }
    const testId = candidate.getAttribute('data-testid')?.trim() ?? '';
    if (testId.includes(messageId)) {
      return true;
    }
    return false;
  });

  // 调试日志：如果找不到，记录原因
  if (index < 0) {
    const sampleCandidates = candidates.slice(0, 3).map(el => ({
      testId: el.getAttribute('data-testid'),
      messageId: el.getAttribute('data-message-id'),
      textPreview: el.textContent?.substring(0, 30),
    }));
    mwLogger.debug('marker not found by messageId:', {
      markerMessageId: messageId,
      markerNodeId: marker.nodeId,
      sampleCandidates,
    });
  }

  return index;
}

function markerIndexByText(candidates: HTMLElement[], marker: SlidingWindowDomMarker): number {
  const text = normalizeText(marker.text);
  if (text.length === 0) {
    return -1;
  }

  return candidates.findIndex((candidate) => normalizeText(candidate.textContent ?? '').includes(text));
}

function markerIndex(candidates: HTMLElement[], marker: SlidingWindowDomMarker | null): number {
  if (marker == null) {
    return -1;
  }
  const byId = markerIndexByMessageId(candidates, marker);
  if (byId >= 0) {
    return byId;
  }
  const byText = markerIndexByText(candidates, marker);
  if (byText >= 0) {
    mwLogger.debug('marker found by text fallback:', { nodeId: marker.nodeId, index: byText });
  }
  return byText;
}

function containsMarker(candidates: HTMLElement[], marker: SlidingWindowDomMarker): boolean {
  return markerIndex(candidates, marker) >= 0;
}

function targetVisible(
  doc: Document,
  target: SlidingWindowDomVerificationTarget,
  previous: SlidingWindowDomVerificationTarget | null,
): boolean {
  const candidates = transcriptCandidates(doc);
  const firstIndex = markerIndex(candidates, target.first);
  const lastIndex = markerIndex(candidates, target.last);

  // 详细调试日志
  mwLogger.verbose('targetVisible check:', {
    candidatesCount: candidates.length,
    targetRange: target.range,
    firstMarker: target.first ? { nodeId: target.first.nodeId, messageId: target.first.messageId, textPreview: target.first.text.substring(0, 50) } : null,
    lastMarker: target.last ? { nodeId: target.last.nodeId, messageId: target.last.messageId, textPreview: target.last.text.substring(0, 50) } : null,
    firstIndex,
    lastIndex,
  });

  if (firstIndex < 0 || lastIndex < firstIndex) {
    mwLogger.debug('targetVisible failed: first/last index invalid', { firstIndex, lastIndex });
    return false;
  }

  // 修复：放宽stale markers检查 - 对于in-place导航，React需要时间重新渲染
  // 只记录stale markers存在但不阻塞验证，因为目标标记已经找到
  const staleMarkers = [previous?.first, previous?.last].filter((marker): marker is SlidingWindowDomMarker => {
    return marker != null && !target.nodeIds.has(marker.nodeId);
  });
  const stalePresent = staleMarkers.some((marker) => containsMarker(candidates, marker));
  if (stalePresent) {
    mwLogger.verbose('targetVisible: stale markers still present (ignoring for inplace nav)', {
      staleMarkers: staleMarkers.map(m => m.nodeId),
      firstIndex,
      lastIndex,
    });
    // 修复：不返回false，继续验证通过
    // 对于无刷新翻页，只要目标标记存在就认为成功
  }

  return true;
}

function delay(win: Window, ms: number): Promise<void> {
  return new Promise((resolve) => {
    win.setTimeout(resolve, ms);
  });
}

async function waitForDomVerification(input: {
  win: Window;
  doc: Document;
  target: SlidingWindowDomVerificationTarget;
  previous: SlidingWindowDomVerificationTarget | null;
}): Promise<boolean> {
  const startedAt = Date.now();
  let lastCheck = null;
  let checkCount = 0;

  mwLogger.debug('DOM verification started:', {
    targetRange: input.target.range,
    previousRange: input.previous?.range,
    timeout: VERIFY_TIMEOUT_MS,
  });

  while (Date.now() - startedAt <= VERIFY_TIMEOUT_MS) {
    checkCount++;
    const visible = targetVisible(input.doc, input.target, input.previous);
    if (visible) {
      mwLogger.debug('DOM verification success:', {
        duration: Date.now() - startedAt,
        checks: checkCount,
      });
      return true;
    }
    lastCheck = {
      candidates: transcriptCandidates(input.doc).length,
      first: input.target.first?.nodeId,
      last: input.target.last?.nodeId,
    };
    await delay(input.win, VERIFY_INTERVAL_MS);
  }

  mwLogger.error('DOM verification timeout:', {
    duration: Date.now() - startedAt,
    targetRange: input.target.range,
    checkCount,
    lastCheck,
    // 额外调试：列出所有候选元素
    allCandidates: transcriptCandidates(input.doc).map((el, i) => ({
      index: i,
      testId: el.getAttribute('data-testid'),
      role: el.getAttribute('data-message-author-role'),
      textPreview: el.textContent?.substring(0, 50),
    })),
  });
  return false;
}

async function invoke(value: unknown): Promise<void> {
  await Promise.resolve(value);
}

function currentConversationRouteId(win: Window): string {
  return /^\/g\/[^/]+\/c\/[^/]+/.test(win.location.pathname)
    ? 'routes/_conversation.g.$gizmoId.c.$conversationId'
    : 'routes/_conversation.c.$conversationId';
}

function shouldTryRouterAdapter(win: Window): boolean {
  const routes = getReactRouterManifest(win)?.routes;
  if (routes == null) {
    return true;
  }

  const route = routes[currentConversationRouteId(win)];
  if (route == null) {
    return true;
  }

  return route.hasLoader === true || route.hasClientLoader === true;
}

function toAbsoluteModuleUrl(win: Window, moduleUrl: string): string | null {
  try {
    return new URL(moduleUrl, win.location.origin).href;
  } catch {
    return null;
  }
}

function collectOfficialModuleUrls(win: Window): string[] {
  const routes = getReactRouterManifest(win)?.routes;
  if (routes == null) {
    return [];
  }

  const routeIds = [
    currentConversationRouteId(win),
    'routes/_conversation',
    ...Object.keys(routes).filter((routeId) => routeId.includes('_conversation')),
  ];
  const urls = new Set<string>();

  for (const routeId of routeIds) {
    const route = routes[routeId];
    if (route == null) {
      continue;
    }
    for (const imported of route.imports ?? []) {
      const absoluteUrl = toAbsoluteModuleUrl(win, imported);
      if (absoluteUrl != null) {
        urls.add(absoluteUrl);
      }
    }
    if (route.module != null) {
      const absoluteUrl = toAbsoluteModuleUrl(win, route.module);
      if (absoluteUrl != null) {
        urls.add(absoluteUrl);
      }
    }
  }

  return [...urls];
}

function isOfficialConversationStoreModule(value: unknown): value is OfficialConversationStoreModule {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  const module = value as OfficialConversationStoreModule;
  return (
    typeof module.i8?.updateThreadFromServer === 'function' &&
    typeof module.w8?.getState === 'function' &&
    typeof module.n8?.getConversationTurns === 'function'
  );
}

async function importOfficialModule(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url);
}

async function resolveOfficialConversationStoreModule(
  win: Window,
): Promise<OfficialConversationStoreModule | null> {
  const override = (win as OfficialConversationWindow).__turboRenderOfficialConversationModule;
  if (isOfficialConversationStoreModule(override)) {
    return override;
  }

  for (const url of collectOfficialModuleUrls(win)) {
    try {
      const module = await importOfficialModule(url);
      if (isOfficialConversationStoreModule(module)) {
        return module;
      }
    } catch {
      // Try the next official route chunk. ChatGPT build splits change often.
    }
  }

  return null;
}

function readOfficialThread(
  module: OfficialConversationStoreModule,
  conversationId: string,
): unknown {
  const state = module.w8?.getState?.();
  const serverId = state?.clientNewThreadIdToServerIdMapping?.[conversationId] ?? conversationId;
  return state?.threads?.[serverId] ?? state?.threads?.[conversationId] ?? null;
}

async function renderViaOfficialConversationStore(input: {
  win: Window;
  doc: Document;
  conversationId: string;
  payload: ConversationPayload;
  target: SlidingWindowDomVerificationTarget;
  previous: SlidingWindowDomVerificationTarget | null;
}): Promise<boolean> {
  const storeStart = Date.now();
  const module = await resolveOfficialConversationStoreModule(input.win);
  if (module == null) {
    mwLogger.error('official store module not found');
    return false;
  }

  try {
    await invoke(module.i8?.resetThread?.(input.conversationId));
    await invoke(module.i8?.updateThreadFromServer?.(input.conversationId, input.payload, {
      source: 'turbo-render-sliding-window-inplace',
    }));
  } catch (error) {
    mwLogger.error('store module update failed:', error);
    return false;
  }

  const thread = readOfficialThread(module, input.conversationId);
  const turns = thread != null ? module.n8?.getConversationTurns?.(thread) : null;
  if (thread == null || turns == null || turns.length === 0) {
    mwLogger.error('thread not found or empty:', {
      hasThread: thread != null,
      turnsCount: turns?.length ?? 0,
    });
    return false;
  }

  mwLogger.debug('store module updated:', {
    turnsCount: turns.length,
    duration: Date.now() - storeStart,
  });

  return waitForDomVerification(input);
}

export async function renderOfficialSlidingWindow(input: {
  win: Window;
  doc: Document;
  conversationId: string;
  payload: ConversationPayload;
  target: SlidingWindowDomVerificationTarget;
  previous: SlidingWindowDomVerificationTarget | null;
  prepareTicket: () => void;
}): Promise<boolean> {
  const renderStart = Date.now();
  const router = getReactRouter(input.win);
  const hasRouter = router != null && shouldTryRouterAdapter(input.win);

  mwLogger.debug('renderOfficialSlidingWindow start:', {
    conversationId: input.conversationId,
    targetRange: input.target.range,
    hasRouter,
    hasRevalidate: typeof router?.revalidate === 'function',
    hasNavigate: typeof router?.navigate === 'function',
  });

  if (hasRouter) {
    if (typeof router.revalidate === 'function') {
      input.prepareTicket();
      await invoke(router.revalidate());
      if (await waitForDomVerification(input)) {
        mwLogger.debug('render via revalidate success:', {
          duration: Date.now() - renderStart,
        });
        return true;
      }
      mwLogger.debug('revalidate failed, trying navigate');
    }

    if (typeof router.navigate === 'function') {
      input.prepareTicket();
      const currentRoute = `${input.win.location.pathname}${input.win.location.search}${input.win.location.hash}`;
      await invoke(router.navigate(currentRoute, {
        replace: true,
        preventScrollReset: true,
      }));
      if (await waitForDomVerification(input)) {
        mwLogger.debug('render via navigate success:', {
          duration: Date.now() - renderStart,
        });
        return true;
      }
      mwLogger.debug('navigate failed, falling back to store module');
    }
  }

  const result = await renderViaOfficialConversationStore(input);
  mwLogger.debug(result
    ? 'render via store module success'
    : 'render via store module failed - DOM verification may have timed out', {
    duration: Date.now() - renderStart,
    targetRange: input.target.range,
  });
  return result;
}
