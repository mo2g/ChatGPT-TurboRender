import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants';
import { getChatIdFromPathname } from './chat-id';
import { safeStorageGet, safeStorageSet } from './extension-api';
import { normalizeLanguagePreference } from './i18n';
import type { Settings } from './types';

interface LegacySettings {
  keepRecentTurns?: number;
  groupSize?: number;
  initialHotTurns?: number;
  liveHotTurns?: number;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeSettings(candidate: Partial<Settings> | null | undefined): Settings {
  const legacy = (candidate ?? {}) as LegacySettings;
  const keepRecentPairs = clampNumber(
    candidate?.keepRecentPairs ?? (typeof legacy.keepRecentTurns === 'number' ? Math.ceil(legacy.keepRecentTurns / 2) : undefined),
    DEFAULT_SETTINGS.keepRecentPairs,
    1,
    100,
  );
  const batchPairCount = clampNumber(
    candidate?.batchPairCount ?? (typeof legacy.groupSize === 'number' ? Math.ceil(legacy.groupSize / 2) : undefined),
    DEFAULT_SETTINGS.batchPairCount,
    1,
    50,
  );
  const initialHotPairs = clampNumber(
    candidate?.initialHotPairs ?? (typeof legacy.initialHotTurns === 'number' ? Math.ceil(legacy.initialHotTurns / 2) : undefined),
    DEFAULT_SETTINGS.initialHotPairs,
    1,
    50,
  );
  const liveHotPairs = clampNumber(
    candidate?.liveHotPairs ?? (typeof legacy.liveHotTurns === 'number' ? Math.ceil(legacy.liveHotTurns / 2) : undefined),
    DEFAULT_SETTINGS.liveHotPairs,
    1,
    50,
  );

  return {
    enabled: candidate?.enabled ?? DEFAULT_SETTINGS.enabled,
    autoEnable: candidate?.autoEnable ?? DEFAULT_SETTINGS.autoEnable,
    language: normalizeLanguagePreference(candidate?.language),
    mode:
      candidate?.mode === 'compatibility' || candidate?.mode === 'performance'
        ? candidate.mode
        : DEFAULT_SETTINGS.mode,
    minFinalizedBlocks: clampNumber(
      candidate?.minFinalizedBlocks,
      DEFAULT_SETTINGS.minFinalizedBlocks,
      10,
      1000,
    ),
    minDescendants: clampNumber(
      candidate?.minDescendants,
      DEFAULT_SETTINGS.minDescendants,
      100,
      20_000,
    ),
    keepRecentPairs,
    batchPairCount,
    initialHotPairs,
    liveHotPairs,
    keepRecentTurns: keepRecentPairs * 2,
    viewportBufferTurns: clampNumber(
      candidate?.viewportBufferTurns,
      DEFAULT_SETTINGS.viewportBufferTurns,
      0,
      50,
    ),
    groupSize: batchPairCount * 2,
    initialTrimEnabled: candidate?.initialTrimEnabled ?? DEFAULT_SETTINGS.initialTrimEnabled,
    initialHotTurns: initialHotPairs * 2,
    liveHotTurns: liveHotPairs * 2,
    softFallback: candidate?.softFallback ?? DEFAULT_SETTINGS.softFallback,
    frameSpikeThresholdMs: clampNumber(
      candidate?.frameSpikeThresholdMs,
      DEFAULT_SETTINGS.frameSpikeThresholdMs,
      16,
      500,
    ),
    frameSpikeCount: clampNumber(
      candidate?.frameSpikeCount,
      DEFAULT_SETTINGS.frameSpikeCount,
      1,
      20,
    ),
    frameSpikeWindowMs: clampNumber(
      candidate?.frameSpikeWindowMs,
      DEFAULT_SETTINGS.frameSpikeWindowMs,
      500,
      15_000,
    ),
  };
}

export async function getSettings(): Promise<Settings> {
  const value = await safeStorageGet(STORAGE_KEYS.settings);
  return normalizeSettings(value[STORAGE_KEYS.settings] as Partial<Settings> | undefined);
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...patch });
  await safeStorageSet({
    [STORAGE_KEYS.settings]: next,
  });
  return next;
}

export async function ensureDefaultSettings(): Promise<Settings> {
  const value = await safeStorageGet(STORAGE_KEYS.settings);

  if (value[STORAGE_KEYS.settings] == null) {
    await safeStorageSet({
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
    });
    return DEFAULT_SETTINGS;
  }

  return normalizeSettings(value[STORAGE_KEYS.settings] as Partial<Settings>);
}

export async function getPausedChats(): Promise<Record<string, boolean>> {
  const value = await safeStorageGet(STORAGE_KEYS.pausedChats);
  return (value[STORAGE_KEYS.pausedChats] as Record<string, boolean> | undefined) ?? {};
}

export async function isChatPaused(chatId: string): Promise<boolean> {
  const pausedChats = await getPausedChats();
  return pausedChats[chatId] ?? false;
}

export async function setChatPaused(chatId: string, paused: boolean): Promise<void> {
  const pausedChats = await getPausedChats();
  const next = { ...pausedChats, [chatId]: paused };
  await safeStorageSet({
    [STORAGE_KEYS.pausedChats]: next,
  });
}

export function getCurrentChatId(): string {
  return getChatIdFromPathname(globalThis.location?.pathname ?? '/');
}
