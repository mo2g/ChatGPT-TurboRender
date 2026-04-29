export type ChatgptRouteKind = 'chat' | 'share' | 'other';

export interface PageLike {
  url(): string;
  waitForLoadState?(state: 'domcontentloaded', options?: { timeout?: number }): Promise<unknown>;
  evaluate?<TResult, TArg>(pageFunction: (arg: TArg) => TResult | Promise<TResult>, arg: TArg): Promise<TResult>;
}

export interface ExtensionTabLike {
  id?: number;
  url?: string;
}

export interface ChatgptPageSelection<TPage> {
  chatgptPages: TPage[];
  exactPages: TPage[];
  matchedPage: TPage | null;
}

export interface ChatgptPageInspection {
  title: string;
  readyState: string;
  routeKind: ChatgptRouteKind;
  inlineHistoryRoots: number;
  visibleInlineHistoryRoots: number;
  uiRoots: number;
  boundaryRoots: number;
  boundaryButtons: number;
  visibleBoundaryRoots: number;
  batchAnchors: number;
  groups: number;
  toggleActions: number;
  hostMessages: number;
}

export interface LivePerformanceSample {
  phase: string;
  archivePageCount: number;
  currentArchivePageIndex: number | null;
  liveDescendantCount: number;
  spikeCount: number;
  parkedGroups: number;
  residentParkedGroups: number;
  serializedParkedGroups: number;
}

export function collectChatgptPages<TPage extends PageLike>(pages: TPage[]): TPage[];
export function selectExactChatgptPage<TPage extends PageLike>(
  pages: TPage[],
  targetUrl: string,
): ChatgptPageSelection<TPage>;
export function selectExactChatgptExtensionTab<TTab extends ExtensionTabLike>(tabs: TTab[], targetUrl: string): TTab | null;
export function createLivePerformanceSample(phase: string, runtime: Record<string, unknown> | null): LivePerformanceSample | null;
export function validateLivePerformanceSample(sample: LivePerformanceSample | null): string[];
export function formatLivePerformanceSample(sample: LivePerformanceSample | null): string;

export function hasTurboRenderInjection(
  inspection: Pick<
    ChatgptPageInspection,
    'inlineHistoryRoots' | 'uiRoots' | 'boundaryRoots' | 'boundaryButtons' | 'batchAnchors' | 'groups' | 'toggleActions'
  >,
): boolean;
export function hasArchiveAccess(
  inspection: Pick<
    ChatgptPageInspection,
    'visibleBoundaryRoots' | 'batchAnchors' | 'visibleInlineHistoryRoots' | 'boundaryButtons'
  >,
): boolean;
