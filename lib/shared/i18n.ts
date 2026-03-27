import type { Settings } from './types';

export type LanguagePreference = 'auto' | 'en' | 'zh-CN';
export type UiLanguage = 'en' | 'zh-CN';

type MessageValue = string | number | boolean | null | undefined;

const MESSAGE_CATALOG = {
  en: {
    appName: 'ChatGPT TurboRender',
    actionViewHistory: 'View history',
    actionHideHistory: 'Hide history',
    actionClose: 'Close',
    actionExpand: 'More',
    actionCollapse: 'Less',
    actionRestore: 'Restore',
    actionRestoreNearby: 'Restore nearby',
    actionRestoreAll: 'Restore all',
    actionPauseChat: 'Pause this chat',
    actionResumeChat: 'Resume this chat',
    actionOpenOptions: 'Open options',
    actionSave: 'Save',
    actionResetDefaults: 'Reset defaults',
    actionEnableTurboRender: 'Enable TurboRender',
    actionLanguage: 'Language',
    languageAuto: 'Follow browser/page',
    languageEnglish: 'English',
    languageChinese: '简体中文',
    labelBehavior: 'Behavior',
    labelThresholds: 'Thresholds',
    labelCurrentTab: 'Current tab',
    labelSettings: 'Settings',
    labelMode: 'Mode',
    labelPerformance: 'Performance',
    labelCompatibility: 'Compatibility',
    labelColdRestoreMode: 'Cold restore mode',
    labelColdRestorePlaceholder: 'Placeholder first',
    labelColdRestoreReadOnly: 'Read-only restore',
    labelEnabled: 'Enabled',
    labelAutoEnable: 'Auto-enable when thresholds trip',
    labelInitialTrimEnabled: 'Trim long conversations before the official render',
    labelSoftFallback: 'Start in soft-fold mode',
    labelFinalizedTurnsBeforeActivation: 'Finalized turns before activation',
    labelLiveDescendantsBeforeActivation: 'Live descendants before activation',
    labelInitialHotTurns: 'Initial hot turns for payload trim',
    labelLiveHotTurns: 'Live hot turns after initial load',
    labelRecentHotTurns: 'Recent turns to keep hot',
    labelViewportBufferTurns: 'Viewport buffer turns',
    labelTurnsPerColdGroup: 'Turns per cold group',
    labelFrameSpikeThreshold: 'Frame spike threshold (ms)',
    labelFrameSpikeCount: 'Frame spikes required',
    labelFrameSpikeWindow: 'Frame spike window (ms)',
    labelTotalTurns: 'Total turns',
    labelFinalized: 'Finalized',
    labelInitialTrim: 'Initial trim',
    labelParkedTurns: 'Parked turns',
    labelParkedGroups: 'Parked groups',
    labelLiveDomNodes: 'Live DOM nodes',
    labelMappingNodes: 'Mapping nodes',
    labelFrameSpikes: 'Frame spikes',
    labelHandledHistory: 'Handled history',
    labelHistoryInspection: 'History panel',
    stateUnsupported: 'Unsupported',
    statePaused: 'Paused',
    stateActive: 'Active',
    stateActiveSoft: 'Active (soft fallback)',
    stateMonitoring: 'Monitoring',
    stateInspecting: 'Viewing history',
    statusLoading: 'Loading…',
    statusNoSupportedTab: 'No supported ChatGPT tab was found in the active window.',
    statusUnavailable: 'Unavailable',
    statusSavedLocally: 'Saved locally.',
    statusResetToDefaults: 'Reset to defaults.',
    statusStoredLocally: 'Settings are stored locally in your browser profile.',
    statusPopupTopShelfHint: 'Managed history is available from the History button near the top-right corner of the page.',
    statusPopupSettingsHint: 'Fine-tune thresholds, language, and fallback behavior.',
    statusOptionsIntro:
      'Adjust the early trim policy, language, hot-window retention, and fallback behavior used when the host page re-renders aggressively.',
    statusShelfManaged: 'To keep ChatGPT responsive, {count} older turns are tucked away.',
    statusShelfInspecting: 'Viewing {count} managed turns. Auto-parking is temporarily paused.',
    statusShelfPaused: 'TurboRender is paused for this chat.',
    statusShelfMonitoring: 'TurboRender is active and watching this chat.',
    statusShelfMeta:
      '{state} • {handled} handled • {nodes} live nodes • {spikes} recent frame spikes',
    statusHistoryYes: 'Yes ({count} cold)',
    statusHistoryNo: 'No',
    statusInspectionOpen: 'Open',
    statusInspectionClosed: 'Closed',
    historyTriggerLabel: 'History',
    historyDrawerTitle: 'Managed history',
    historyDrawerSummary:
      '{count} earlier turns are managed here so the main conversation stays responsive.',
    historyDrawerPaused: 'TurboRender is paused for this chat. You can still browse managed history here.',
    historyDrawerEmpty: 'No managed history is available for this chat yet.',
    historyDrawerHint:
      'Older messages were moved here to keep ChatGPT smooth. Use search or open a result to jump back into the conversation.',
    historySearchPlaceholder: 'Search managed history',
    historySearchResults: '{count} matching results',
    historySearchNoMatches: 'No managed history matched this search.',
    historySearchOpenChat: 'Open in chat',
    historySearchInitialTrim: 'Initial history',
    historySearchParkedGroup: 'Managed group',
    historySearchSummary: 'Showing {count} managed turns',
    placeholderFoldedTurns: 'Folded {count} turns • #{start}-{end}',
    coldHistoryTitle: 'Managed history',
    coldHistorySummary:
      '{count} earlier turns were restored here in read-only form so the main thread can stay responsive.',
    roleUser: 'You',
    roleAssistant: 'Assistant',
    roleSystem: 'System',
    roleTool: 'Tool',
    roleUnknown: 'Message',
  },
  'zh-CN': {
    appName: 'ChatGPT TurboRender',
    actionViewHistory: '查看历史',
    actionHideHistory: '收起历史',
    actionClose: '关闭',
    actionExpand: '展开',
    actionCollapse: '收起',
    actionRestore: '恢复',
    actionRestoreNearby: '恢复附近',
    actionRestoreAll: '恢复全部',
    actionPauseChat: '暂停此会话',
    actionResumeChat: '恢复此会话',
    actionOpenOptions: '打开设置',
    actionSave: '保存',
    actionResetDefaults: '恢复默认值',
    actionEnableTurboRender: '启用 TurboRender',
    actionLanguage: '语言',
    languageAuto: '跟随浏览器/页面',
    languageEnglish: 'English',
    languageChinese: '简体中文',
    labelBehavior: '行为',
    labelThresholds: '阈值',
    labelCurrentTab: '当前标签页',
    labelSettings: '设置',
    labelMode: '模式',
    labelPerformance: '性能优先',
    labelCompatibility: '兼容优先',
    labelColdRestoreMode: '冷历史恢复方式',
    labelColdRestorePlaceholder: '先显示占位',
    labelColdRestoreReadOnly: '只读恢复',
    labelEnabled: '已启用',
    labelAutoEnable: '达到阈值后自动启用',
    labelInitialTrimEnabled: '在官方首屏渲染前裁剪超长对话',
    labelSoftFallback: '默认使用 soft-fold 模式',
    labelFinalizedTurnsBeforeActivation: '触发前的已完成消息数',
    labelLiveDescendantsBeforeActivation: '触发前的活跃 DOM 后代数',
    labelInitialHotTurns: '首屏裁剪后保留的热区消息数',
    labelLiveHotTurns: '初始加载后保留的热区消息数',
    labelRecentHotTurns: '始终保留的近期消息数',
    labelViewportBufferTurns: '视口缓冲消息数',
    labelTurnsPerColdGroup: '每组冷区消息数',
    labelFrameSpikeThreshold: '帧抖动阈值（毫秒）',
    labelFrameSpikeCount: '触发所需帧抖动次数',
    labelFrameSpikeWindow: '帧抖动统计窗口（毫秒）',
    labelTotalTurns: '消息总数',
    labelFinalized: '已完成',
    labelInitialTrim: '首屏裁剪',
    labelParkedTurns: '已收纳消息',
    labelParkedGroups: '已收纳分组',
    labelLiveDomNodes: '活跃 DOM 节点',
    labelMappingNodes: 'Mapping 节点',
    labelFrameSpikes: '帧抖动',
    labelHandledHistory: '已处理历史',
    labelHistoryInspection: '历史面板',
    stateUnsupported: '不支持',
    statePaused: '已暂停',
    stateActive: '运行中',
    stateActiveSoft: '运行中（soft fallback）',
    stateMonitoring: '监控中',
    stateInspecting: '正在查看历史',
    statusLoading: '加载中…',
    statusNoSupportedTab: '当前窗口中没有可用的 ChatGPT 标签页。',
    statusUnavailable: '不可用',
    statusSavedLocally: '已保存到本地。',
    statusResetToDefaults: '已恢复默认值。',
    statusStoredLocally: '设置只保存在当前浏览器本地配置中。',
    statusPopupTopShelfHint: '被处理历史可在页面右上角附近的历史按钮中查看。',
    statusPopupSettingsHint: '调整阈值、语言和降级行为。',
    statusOptionsIntro: '调整首屏裁剪策略、语言、热区保留数量，以及宿主页激进重渲染时的降级行为。',
    statusShelfManaged: '为保持 ChatGPT 流畅，已有 {count} 条较早历史被收纳。',
    statusShelfInspecting: '正在查看 {count} 条已处理历史，自动重新收纳已临时暂停。',
    statusShelfPaused: '此会话中的 TurboRender 已暂停。',
    statusShelfMonitoring: 'TurboRender 正在监控此会话。',
    statusShelfMeta: '{state} • 已处理 {handled} 条 • {nodes} 个活跃节点 • {spikes} 次近期帧抖动',
    statusHistoryYes: '是（{count} 条冷历史）',
    statusHistoryNo: '否',
    statusInspectionOpen: '开启',
    statusInspectionClosed: '关闭',
    historyTriggerLabel: '历史',
    historyDrawerTitle: '已处理历史',
    historyDrawerSummary: '这里集中展示 {count} 条较早历史，避免主对话继续承受完整渲染压力。',
    historyDrawerPaused: '此会话中的 TurboRender 已暂停，你仍然可以在这里查看已处理历史。',
    historyDrawerEmpty: '当前会话还没有可查看的已处理历史。',
    historyDrawerHint: '较早消息已移动到这里以保持 ChatGPT 流畅。你可以搜索历史，或点开结果回到主对话。',
    historySearchPlaceholder: '搜索已处理历史',
    historySearchResults: '匹配到 {count} 条结果',
    historySearchNoMatches: '没有匹配到相关历史。',
    historySearchOpenChat: '在对话中打开',
    historySearchInitialTrim: '首屏冷历史',
    historySearchParkedGroup: '已收纳分组',
    historySearchSummary: '当前显示 {count} 条已处理历史',
    placeholderFoldedTurns: '已收纳 {count} 条消息 • #{start}-{end}',
    coldHistoryTitle: '已处理历史',
    coldHistorySummary: '这里以只读形式恢复了 {count} 条较早消息，避免主线程再次承受完整渲染压力。',
    roleUser: '你',
    roleAssistant: '助手',
    roleSystem: '系统',
    roleTool: '工具',
    roleUnknown: '消息',
  },
} as const;

export type TranslationKey = keyof (typeof MESSAGE_CATALOG)['en'];
export type Translator = (key: TranslationKey, values?: Record<string, MessageValue>) => string;

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  if (value === 'en' || value === 'zh-CN' || value === 'auto') {
    return value;
  }

  return 'auto';
}

export function resolveUiLanguage(
  preference: LanguagePreference | null | undefined,
  ...hints: Array<string | null | undefined>
): UiLanguage {
  if (preference === 'en' || preference === 'zh-CN') {
    return preference;
  }

  for (const hint of hints) {
    if (hint == null || hint.trim().length === 0) {
      continue;
    }

    const normalized = hint.toLowerCase();
    if (normalized.startsWith('zh')) {
      return 'zh-CN';
    }
    if (normalized.startsWith('en')) {
      return 'en';
    }
  }

  return 'en';
}

function interpolate(template: string, values: Record<string, MessageValue> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value == null ? '' : String(value);
  });
}

export function translate(
  language: UiLanguage,
  key: TranslationKey,
  values?: Record<string, MessageValue>,
): string {
  return interpolate(MESSAGE_CATALOG[language][key], values);
}

export function createTranslator(language: UiLanguage): Translator {
  return (key, values) => translate(language, key, values);
}

export function getContentLanguage(settings: Pick<Settings, 'language'>, doc: Document): UiLanguage {
  return resolveUiLanguage(settings.language, doc.documentElement?.lang, navigator.language);
}

export function getExtensionLanguage(settings: Pick<Settings, 'language'>): UiLanguage {
  return resolveUiLanguage(settings.language, navigator.language);
}

export function getCatalogKeys(): TranslationKey[] {
  return Object.keys(MESSAGE_CATALOG.en) as TranslationKey[];
}
