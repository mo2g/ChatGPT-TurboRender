import type { TurboRenderPageConfig } from '../shared/runtime-bridge';

// main-world 专用的轻量级 logger
// 通过 updateMainWorldDebugState() 从 conversation-bootstrap.ts 初始化

let debugEnabled = false;
let debugVerbose = false;

/**
 * 从 conversation-bootstrap.ts 调用，初始化调试状态
 */
export function updateMainWorldDebugState(config: Pick<TurboRenderPageConfig, 'debugEnabled' | 'debugVerbose'>): void {
  debugEnabled = config.debugEnabled;
  debugVerbose = config.debugVerbose;
}

/**
 * main-world 专用的日志函数
 * - debug: 仅在 debugEnabled 时输出
 * - verbose: 仅在 debugEnabled && debugVerbose 时输出
 * - error/warn: 始终输出（这些是重要的）
 */
export const mwLogger = {
  /**
   * 调试日志 - 仅在 debugEnabled 时输出
   */
  debug: (...args: unknown[]): void => {
    if (debugEnabled) {
      console.log('[TurboRender]', ...args);
    }
  },

  /**
   * 详细调试日志 - 仅在 debugEnabled && debugVerbose 时输出
   */
  verbose: (...args: unknown[]): void => {
    if (debugEnabled && debugVerbose) {
      console.log('[TurboRender:Verbose]', ...args);
    }
  },

  /**
   * 信息日志 - 仅在 debugEnabled 时输出
   */
  info: (...args: unknown[]): void => {
    if (debugEnabled) {
      console.info('[TurboRender:Info]', ...args);
    }
  },

  /**
   * 警告日志 - 始终输出（重要）
   */
  warn: (...args: unknown[]): void => {
    console.warn('[TurboRender:Warn]', ...args);
  },

  /**
   * 错误日志 - 始终输出（最重要）
   */
  error: (...args: unknown[]): void => {
    console.error('[TurboRender:Error]', ...args);
  },
};
