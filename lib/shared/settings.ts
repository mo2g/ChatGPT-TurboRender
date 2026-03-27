import { browser } from 'wxt/browser';

import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants';
import { getChatIdFromPathname } from './chat-id';
import type { Settings } from './types';

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeSettings(candidate: Partial<Settings> | null | undefined): Settings {
  return {
    enabled: candidate?.enabled ?? DEFAULT_SETTINGS.enabled,
    autoEnable: candidate?.autoEnable ?? DEFAULT_SETTINGS.autoEnable,
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
    keepRecentTurns: clampNumber(
      candidate?.keepRecentTurns,
      DEFAULT_SETTINGS.keepRecentTurns,
      4,
      500,
    ),
    viewportBufferTurns: clampNumber(
      candidate?.viewportBufferTurns,
      DEFAULT_SETTINGS.viewportBufferTurns,
      0,
      50,
    ),
    groupSize: clampNumber(candidate?.groupSize, DEFAULT_SETTINGS.groupSize, 2, 100),
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
  const value = await browser.storage.local.get(STORAGE_KEYS.settings);
  return normalizeSettings(value[STORAGE_KEYS.settings] as Partial<Settings> | undefined);
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...patch });
  await browser.storage.local.set({
    [STORAGE_KEYS.settings]: next,
  });
  return next;
}

export async function ensureDefaultSettings(): Promise<Settings> {
  const value = await browser.storage.local.get(STORAGE_KEYS.settings);

  if (value[STORAGE_KEYS.settings] == null) {
    await browser.storage.local.set({
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
    });
    return DEFAULT_SETTINGS;
  }

  return normalizeSettings(value[STORAGE_KEYS.settings] as Partial<Settings>);
}

export async function getPausedChats(): Promise<Record<string, boolean>> {
  const value = await browser.storage.local.get(STORAGE_KEYS.pausedChats);
  return (value[STORAGE_KEYS.pausedChats] as Record<string, boolean> | undefined) ?? {};
}

export async function isChatPaused(chatId: string): Promise<boolean> {
  const pausedChats = await getPausedChats();
  return pausedChats[chatId] ?? false;
}

export async function setChatPaused(chatId: string, paused: boolean): Promise<void> {
  const pausedChats = await getPausedChats();
  const next = { ...pausedChats, [chatId]: paused };
  await browser.storage.local.set({
    [STORAGE_KEYS.pausedChats]: next,
  });
}

export function getCurrentChatId(): string {
  return getChatIdFromPathname(globalThis.location?.pathname ?? '/');
}
