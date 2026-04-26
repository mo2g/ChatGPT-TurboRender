# TurboRender 完整重构设计与避坑指南

这份文档不是对当前实现的逐行解释，而是假设要把项目做一次更彻底的结构重构时，应当保留哪些核心不变量、怎样重新划分模块、按什么顺序迁移，以及哪些坑不能踩。

## 一句话目标

TurboRender 只解决一件事：让超长 ChatGPT 会话保持响应，同时尽量维持官方阅读和交互体验。

所有设计都要服从这个目标：

- 最新热区继续留在 ChatGPT 官方 transcript 里，保持官方 React 交互。
- 历史冷区从官方 live subtree 里移出，降低布局、样式计算、mutation 和事件压力。
- 用户查看归档历史时，内容、边距、markdown、操作按钮和菜单尽量接近官方。
- 能复用官方 DOM/action 就复用；不能复用时使用官方 API 或本地 fallback，并明确暴露状态。

## 当前复杂度来源

项目现在已经完成多轮拆分，但仍有两个重力中心。

`TurboRenderController` 仍然同时承担：

- 页面扫描和 DOM 观察
- 运行时状态编排
- 首屏裁剪 session 合并
- parking / restore / soft fallback
- 归档分页和搜索状态
- status bar 状态构建
- action availability、selection、host-bound 判断
- copy、like、share、more、branch、read aloud 调度
- scroll 恢复和菜单定位

`StatusBar` 仍然同时承担：

- 归档批次 DOM 渲染
- 展开/折叠和搜索 UI
- 官方 action 模板实例化
- fallback action button 构建
- action row 对齐、图标替换和视觉状态
- More 菜单 DOM
- host 事件隔离
- 页面顶部 chrome offset 采样

这两个文件的问题不是“太长”本身，而是职责边界还没有变成稳定契约。继续机械拆函数会降低单文件长度，但不会降低系统理解成本。

## 重构后的目标分层

### 1. Bootstrap 层

职责：

- 在 MAIN world 捕获 conversation payload。
- 对 `/backend-api/conversation/:id` 和 share loaderData 做最早裁剪。
- 把 `InitialTrimSession` 通过 bridge 发给 isolated content script。
- 只维护页面早期数据截获，不参与归档 UI 和 action 逻辑。

保留文件方向：

- `lib/main-world/conversation-bootstrap.ts`
- `entrypoints/chatgpt-bootstrap.content/index.ts`
- `lib/shared/runtime-bridge.ts`
- `lib/shared/conversation-trim.ts`

重构要求：

- bootstrap 输出必须是纯数据，不携带 DOM 节点。
- 只允许向 content script 发送 session/config/request-state 三类消息。
- read aloud 的 message id 解析可以保留在 bootstrap 边界内，但要作为独立 resolver，而不是混在 fetch patching 主流程里。

### 2. Host Adapter 层

职责：

- 识别 ChatGPT 页面结构。
- 扫描 transcript、turn、scroll container、history mount target。
- 读取 turn role、streaming、message id、可见区。
- 屏蔽 TurboRender 自己创建的 UI 节点。

保留文件方向：

- `lib/content/chatgpt-adapter.ts`
- `lib/content/visible-range.ts`
- `lib/content/protected-turn.ts`
- `lib/content/mutation-refresh-filter.ts`
- `lib/content/host-message-id-resolver.ts`

重构要求：

- Adapter 只描述当前宿主页面事实，不修改 DOM。
- `scanChatPage()` 的输出要成为 controller 唯一的宿主快照入口。
- host selector 变更必须集中在 adapter/host resolver，不要散进 UI 组件。

### 3. Archive Model 层

职责：

- 把 `initial-trim` 和 live DOM records 合并成统一历史时间线。
- 维护 turn、pair、batch、page 的稳定索引。
- 区分 `initial-trim`、`parked-group` 和 mixed batch。
- 提供搜索、分页、归档数量、当前热区边界等纯数据能力。

保留文件方向：

- `lib/content/managed-history.ts`
- `lib/content/archive-pager.ts`
- `lib/shared/interaction-pairs.ts`
- `lib/shared/types.ts`

重构要求：

- Archive Model 不应知道 StatusBar、按钮、菜单或 DOM event。
- 所有 source 判定必须落在 entry 级别，batch 只做聚合描述。
- `messageId`、`turnId`、`liveTurnId`、`turnIndex` 的语义要固定并写入类型注释。

### 4. Parking Engine 层

职责：

- 决定哪些 live turn 可以离开热区。
- 执行 hard parking 或 soft-fold。
- 保持 live subtree 小且可恢复。
- 避免触碰 protected turn、streaming turn 和 composer 区域。

保留文件方向：

- `lib/content/parking-lot.ts`
- `lib/content/layout.ts`
- `lib/content/frame-spike-monitor.ts`

重构要求：

- Parking Engine 只处理宿主 DOM 的生命周期，不处理归档展示。
- 进入 parking 的节点必须有明确 owner 和恢复路径。
- soft fallback 是宿主不稳定时的安全模式，不是正常渲染路径。

### 5. Runtime Orchestrator 层

职责：

- 串联 bootstrap session、adapter snapshot、archive model、parking engine、UI presenter。
- 管理 settings、paused、route change、refresh scheduling。
- 输出 `TabRuntimeStatus`。
- 只负责流程编排，不直接拼 UI、不直接实现 action 细节。

建议新模块：

- `lib/content/runtime/turbo-render-runtime.ts`
- `lib/content/runtime/refresh-scheduler.ts`
- `lib/content/runtime/route-session-controller.ts`
- `lib/content/runtime/runtime-status-service.ts`
- `lib/content/runtime/archive-state-service.ts`

重构要求：

- 让现在的 `TurboRenderController` 退化为薄 façade。
- controller 对外仍保留 `start()`、`stop()`、`setSettings()`、`setPaused()`、`setInitialTrimSession()`、`getStatus()`，避免入口和测试一次性重写。
- 内部状态按服务拆分，服务之间通过数据对象通信，不互相读 DOM 私有字段。

### 6. Archive Presenter 层

职责：

- 渲染归档批次、搜索、分页、展开/折叠。
- 渲染 message body，并挂载 action row。
- 接收纯 `ArchiveViewModel`，只通过 callback 把用户意图交回 runtime。

保留/拆分方向：

- `lib/content/status-bar.ts` 降级为 `ArchivePresenter` façade。
- `lib/content/history-entry-renderer.ts` 继续负责 body 渲染。
- `lib/content/status-bar-styles.ts` 继续负责 CSS 注入。
- `lib/content/status-bar-icons.ts` 继续负责本地图标。

建议新模块：

- `lib/content/archive-ui/archive-presenter.ts`
- `lib/content/archive-ui/archive-batch-view.ts`
- `lib/content/archive-ui/archive-search-view.ts`
- `lib/content/archive-ui/archive-entry-actions-view.ts`
- `lib/content/archive-ui/action-row-alignment.ts`
- `lib/content/archive-ui/page-chrome-offset.ts`

重构要求：

- UI 层不直接判断 host-bound 能力，只消费 `EntryActionAvailabilityMap`、template 和 selection。
- action row 视觉状态和 action 调度分离。
- `StatusBarState` 应改名为 `ArchiveViewModel`，字段按页面、batch、entry、action 四组拆开。

### 7. Action Service 层

职责：

- 统一判断 copy/like/dislike/share/more/branch/read aloud 的可用模式。
- 执行 host-bound 点击、官方 API fallback、本地 fallback。
- 维护 fallback action selection 和临时反馈状态。
- 暴露可测试的 action state reducer。

保留/拆分方向：

- `lib/content/message-actions.ts`
- `lib/content/entry-action-state.ts`
- `lib/content/host-action-events.ts`
- `lib/content/host-action-matching.ts`
- `lib/content/host-action-wait.ts`
- `lib/content/host-more-menu-actions.ts`
- `lib/content/host-menu-positioning.ts`
- `lib/content/read-aloud-backend.ts`
- `lib/content/read-aloud-host-controls.ts`
- `lib/content/read-aloud-streaming.ts`

建议新模块：

- `lib/content/actions/archive-action-service.ts`
- `lib/content/actions/action-availability.ts`
- `lib/content/actions/action-selection-store.ts`
- `lib/content/actions/copy-action.ts`
- `lib/content/actions/feedback-action.ts`
- `lib/content/actions/share-action.ts`
- `lib/content/actions/more-menu-action.ts`
- `lib/content/actions/read-aloud-action.ts`

重构要求：

- 每个 action 都必须显式返回 `host-bound`、`local-fallback` 或 `unavailable`。
- host-bound 只允许点击经过 entry 匹配校验的官方按钮。
- local-fallback 成功后的 UI state 不能被 host DOM 的空状态覆盖。
- share 默认保守，不能用“最近的 share 按钮”代替同消息绑定。

### 8. Background / Popup / Options 层

职责：

- background 负责 tab 状态请求、runtime 消息转发和恢复。
- popup 负责状态展示、暂停、恢复、打开帮助。
- options 负责本地 settings 编辑。

保留文件方向：

- `entrypoints/background/index.ts`
- `lib/background/service.ts`
- `lib/background/tab-message-recovery.ts`
- `entrypoints/popup/main.ts`
- `entrypoints/options/main.ts`
- `lib/shared/settings.ts`
- `lib/shared/messages.ts`

重构要求：

- UI 设置和 runtime 设置必须走 `normalizeSettings()`。
- popup 不应知道 DOM 细节，只展示 `TabRuntimeStatus`。
- background 不持有完整对话内容。

## 新核心数据契约

### `HostSnapshot`

表示一次 adapter 扫描结果：

- route kind / route id / runtime id
- transcript root
- scroll container
- history mount target
- live turn records
- streaming/protected 状态
- descendant count

它是 runtime 每轮 refresh 的输入。

### `ArchiveTimeline`

表示归档模型输出：

- entries
- pairs
- pages
- groups
- hot window start
- source summary
- search index result

它不包含 DOM 节点。

### `ArchiveViewModel`

表示 UI 层唯一输入：

- current page and page meta
- archive groups
- search state
- expanded/collapsed state
- action availability
- action selection
- action templates
- host message id map
- speaking/copied/menu transient state

它可以由 runtime 和 action service 共同组装，但 UI 层不能回读 runtime 内部状态。

### `EntryActionState`

表示单个归档 entry 的 action 状态：

- action mode: `host-bound` / `local-fallback` / `unavailable`
- selected feedback: `like` / `dislike` / none
- host message id
- copied feedback key
- speaking key
- menu selection

这个状态应该能独立单测，不依赖 jsdom 上完整页面。

## 推荐迁移顺序

### 阶段 1：建立契约，不改变行为

1. 新增 `ArchiveViewModel`、`HostSnapshot`、`EntryActionState` 类型。
2. 让 `TurboRenderController` 内部先构建这些对象，但仍交给现有 `StatusBar`。
3. 把现有测试断言补到新对象上，确保语义固定。

验收标准：

- `pnpm test:unit` 通过。
- 现有 integration controller 测试不需要大面积改断言。
- live smoke 行为不变。

### 阶段 2：抽 Runtime 服务

1. 抽 `refresh-scheduler`，接管 mutation、idle、raf、scroll refresh。
2. 抽 `archive-state-service`，接管 archive page/search/expanded state。
3. 抽 `runtime-status-service`，接管 `TabRuntimeStatus` 构建。
4. 保留 controller façade 对外 API。

验收标准：

- controller 文件明显变薄。
- scheduler、archive state、status builder 都有直接单测。
- route change、pause/resume、initial trim session 替换测试仍通过。

### 阶段 3：抽 Action Service

1. 把 host-bound 解析、fallback API、selection store 从 controller 移走。
2. 每个 action 拆成 strategy。
3. UI 只消费 action service 输出，不自己推断可用性。

验收标准：

- copy 保留 rich text。
- like/dislike host-bound 和 API fallback 都能分别测试。
- share 默认保守，只有同消息 host-bound 时启用。
- More 菜单第二次点击关闭，位置仍正确。

### 阶段 4：拆 Archive UI

1. 把 StatusBar 拆成 presenter façade + batch view + search view + entry action view。
2. 把 action row 对齐、官方模板实例化、本地图标 fallback 独立出来。
3. 保留 CSS 注入单点。

验收标准：

- 展开/折叠不跳动。
- 归档消息边距与官方对齐。
- 官方 icon template 变化能触发重渲染。
- UI 层单测不需要完整 controller。

### 阶段 5：整理 Bootstrap 和 Read Aloud

1. 把 read aloud message id 解析从 bootstrap fetch patching 主流程里拆出去。
2. 把 payload cache 和 read aloud context 做成明确的 main-world service。
3. content script 只接收解析结果，不反向依赖 bootstrap 内部细节。

验收标准：

- conversation payload 裁剪仍发生在官方完整渲染前。
- share loaderData 路径不退化。
- read aloud backend 和 local fallback 行为保持。

## 避坑指南

### 不要把归档历史重新灌回官方 transcript

这是最关键的坑。归档历史如果重新长期进入官方 React live subtree，项目核心收益会消失。允许短暂点击官方按钮，但不允许为了“完全官方 UI”恢复整段历史并保持常驻。

### 不要把 batch source 当成 entry source

一个 mixed batch 里可能同时有 `initial-trim` 和 `parked-group` entry。action 是否 host-bound 必须按 entry 判断，不能按批次判断。

### 不要相信全局最近按钮

ChatGPT 长会话里可能同时存在多个 copy/like/share/more 按钮。host-bound 必须证明按钮属于同一条 entry，不能靠“屏幕上第一个”或“最近一个”。

### 不要让 host DOM 空状态覆盖 fallback 状态

`initial-trim` 的 like/dislike API fallback 成功后，host DOM 不会变成选中态。只有 host-bound entry 才允许从 host DOM 读 selection 并覆盖本地 selection。

### 不要把 share 当成普通按钮

share 行为风险比 copy/feedback 高。错误 share 会触发错误消息或错误会话的分享流程。没有同消息 host-bound 证据时，应该禁用或保守提示。

### 不要让 UI 组件自己做业务推断

UI 层只能消费 view model。它可以根据 `host-bound`、`local-fallback`、`unavailable` 渲染不同状态，但不应该自己扫描 host DOM 来决定 action 是否可用。

### 不要把 bootstrap 做成第二个 controller

MAIN world bootstrap 只负责尽早截获官方 payload。它不应该管理 UI、分页、搜索、settings 面板或 action 状态。

### 不要扩大 MutationObserver 的观察面

观察整个 document 或整个 archive UI 会重新引入性能问题。观察范围必须限制在 live transcript、必要的 mount target 和少量 host popover 变化。

### 不要把 soft fallback 当作主路径

soft-fold 是宿主结构变化时的安全降级。主路径仍应是 hard parking + 自管 archive。

### 不要混淆真实 message id 和 synthetic id

`turn-*` 这类 synthetic id 只能用于本地定位，不能直接调用官方 feedback/read aloud API。调用官方 API 前必须解析真实 message id。

### 不要把测试重新带回过时 fixture

当前主验收路径是已登录真实 ChatGPT 宿主。fixture 可以解释历史背景，但不能作为官方 DOM 兼容性的真相来源。

### 不要一次性重写入口和测试

重构时保留 controller façade，可以让 entrypoints、popup/background 消息和 integration 测试逐步迁移。一次性替换入口会让行为回归难以定位。

## 测试策略

重构后的测试应按契约分层。

### 纯函数单测

覆盖：

- route 解析
- payload trim
- interaction pair/batch
- archive pagination
- action availability
- action selection reducer
- message id resolver
- mutation refresh filter

### DOM 单测

覆盖：

- ChatGPT adapter selector 变体
- host action template capture
- archive entry body render
- action row icon fallback
- More menu positioning

### Controller 集成测试

覆盖：

- initial-trim session 合并
- parked DOM 同步
- hard/soft fallback 切换
- archive page/search/expanded state
- host-bound action 点击路径
- local-fallback feedback UI 状态

### Live smoke

覆盖：

- 登录态真实 `/c/<id>`
- 默认长会话目标
- active tab 便捷模式
- archive ready 状态
- copy、like/dislike、More、read aloud 的关键路径

## 成功标准

完整重构完成后，应达到这些状态：

- `TurboRenderController` 只保留 façade 和高层编排。
- `StatusBar` 不再承担 action 业务推断和页面 chrome 探测。
- 每个 action 的复用策略能单独解释、单独测试。
- `initial-trim` 与 `parked-group` 的差异在类型和测试里显式存在。
- 文档中的模块边界与目录结构一致。
- 单元、集成和 live smoke 的职责清晰，不再依赖过时假宿主回放。

## 推荐目录形态

```text
lib/content/
  adapter/
    chatgpt-adapter.ts
    host-message-id-resolver.ts
    mutation-refresh-filter.ts
    visible-range.ts
  archive-model/
    managed-history.ts
    archive-pager.ts
    archive-ui-state.ts
  parking/
    parking-lot.ts
    layout.ts
    frame-spike-monitor.ts
  runtime/
    turbo-render-runtime.ts
    refresh-scheduler.ts
    archive-state-service.ts
    runtime-status-service.ts
  actions/
    archive-action-service.ts
    action-availability.ts
    action-selection-store.ts
    copy-action.ts
    feedback-action.ts
    share-action.ts
    more-menu-action.ts
    read-aloud-action.ts
  archive-ui/
    archive-presenter.ts
    archive-batch-view.ts
    archive-search-view.ts
    archive-entry-actions-view.ts
    action-row-alignment.ts
    page-chrome-offset.ts
  render/
    history-entry-renderer.ts
    status-bar-icons.ts
    status-bar-styles.ts
```

目录迁移可以晚于代码拆分。先建立契约和服务边界，再移动文件，能降低 import churn 和 review 噪音。
