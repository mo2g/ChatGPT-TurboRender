import { DEFAULT_SETTINGS } from './constants';

// 全局调试状态（由控制器或主入口更新）
let globalDebugEnabled = DEFAULT_SETTINGS.debugEnabled;

/**
 * 简化的日志函数
 * - debug: 仅在 debugEnabled 时输出
 * - verbose: 仅在 debugEnabled && debugVerbose 时输出
 * - error/warn: 始终输出（这些是重要的）
 */
export const logger = {
  /**
   * 调试日志 - 仅在 debugEnabled 时输出
   */
  debug: (...args: unknown[]): void => {
    if (globalDebugEnabled) {
      console.log('[TurboRender]', ...args);
    }
  },

  /**
   * 信息日志 - 仅在 debugEnabled 时输出
   */
  info: (...args: unknown[]): void => {
    if (globalDebugEnabled) {
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
