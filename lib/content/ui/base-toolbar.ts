/**
 * UI工具函数 - 提供Toolbar/StatusBar公共功能的可复用工具
 * 简化方案：提取公共逻辑为函数，避免复杂的类继承结构
 */

import {
  TURBO_RENDER_UI_ROOT_ATTRIBUTE,
  TURBO_RENDER_UI_ROOT_VALUE,
} from '../../shared/constants';

export interface ToolbarMountOptions {
  rootTag?: keyof HTMLElementTagNameMap;
  rootClassName: string;
  rootDataset: Record<string, string>;
}

/**
 * 创建标准UI根元素
 */
export function createToolbarRoot(
  doc: Document,
  options: ToolbarMountOptions,
): HTMLElement {
  const root = doc.createElement(options.rootTag ?? 'section');
  root.setAttribute(TURBO_RENDER_UI_ROOT_ATTRIBUTE, TURBO_RENDER_UI_ROOT_VALUE);
  root.className = options.rootClassName;
  Object.assign(root.dataset, options.rootDataset);
  return root;
}

/**
 * 注入CSS样式（带重复检查）
 */
export function injectToolbarStyles(doc: Document, styleId: string, styles: string): void {
  if (doc.getElementById(styleId) != null) {
    return;
  }
  const style = doc.createElement('style');
  style.id = styleId;
  style.textContent = styles;
  doc.head.append(style);
}

/**
 * HTML转义工具
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}

/**
 * HTML属性转义
 */
export function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
