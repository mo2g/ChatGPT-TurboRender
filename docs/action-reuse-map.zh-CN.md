# 归档消息 Action 复用边界

这份文档说明 TurboRender 在归档消息里如何复用 ChatGPT 官方能力，哪些地方是插件自管 fallback，以及为什么不能把所有 action 都改成“直接调用官方实现”。

## 判断原则

TurboRender 优先顺序是：

1. 能定位到同一条消息的官方 host 按钮时，模拟真实用户点击官方按钮。
2. 找不到官方按钮但有官方后端接口和真实 message id 时，调用官方后端接口。
3. 没有稳定官方入口时，使用本地 fallback，并尽量复用官方图标、文案和状态表现。

这个顺序服务于核心目标：旧消息不能重新长期挂回 ChatGPT 的 live React 子树，否则长会话性能问题会回来。

## 数据来源差异

`parked-dom` 历史来自页面上曾经存在过的官方 DOM。它通常仍能恢复或定位到原始 host 节点，因此最有机会走官方按钮点击。

`initial-trim` 历史来自页面 hydration 前截获的 conversation payload。它从未完整进入官方 React transcript，因此没有可复用的官方按钮实例和 React handler。它只能使用官方图标模板、官方 API 或本地 fallback。

`mixed` 批次同时包含上述两类 entry。每个 entry 的 action 需要独立判断，不能按整个批次一刀切。

## Action 复用现状

### Copy

优先级：

1. `host-bound`：能定位到官方 copy 按钮时，点击官方按钮。
2. `local-fallback`：找不到官方按钮时，使用插件自己的 rich clipboard 逻辑。

为什么不能全官方：

- `initial-trim` entry 没有官方 copy 按钮实例。
- 官方 copy handler 是 React 内部事件逻辑，不是稳定公开 API。
- 本地 fallback 必须保留，否则首屏裁剪历史无法复制。

当前 UI 要求：

- 按钮图标优先复用官方捕获到的 SVG/sprite。
- fallback copy 成功后使用本地 check 图标反馈。

### Like / Dislike

优先级：

1. `host-bound`：能定位到同一消息的官方 like/dislike 按钮时，点击官方按钮，并从 host DOM 读取选中态。
2. `local-fallback`：找不到官方按钮但有 conversation id 和真实 message id 时，调用 `/backend-api/conversation/message_feedback`。
3. `unavailable`：既没有官方按钮，也没有足够的后端反馈上下文时禁用。

为什么不能全官方：

- `initial-trim` entry 没有官方按钮可点。
- 官方按钮状态存在于 host DOM/React state 里；API fallback 成功后，host DOM 不会自动变更。
- 因此 API fallback 成功后必须由 TurboRender 自己维护选中态、高亮和隐藏相反按钮。

当前 UI 要求：

- API 成功后，选中按钮应 `aria-pressed="true"`。
- 选中图标应进入官方同款高亮态。
- 点赞后隐藏 dislike，点踩后隐藏 like。
- 只有 `host-bound` entry 才允许 host DOM selection 覆盖本地 selection；`local-fallback` 必须保留 API 成功后的本地 selection。

### Share

优先级：

1. `host-bound`：能定位到官方 share 按钮时可复用官方点击。
2. 默认保守禁用：无法稳定定位官方 share 上下文时，不伪造分享行为。

为什么不能全官方：

- 官方 share 强依赖当前 conversation UI 状态、真实 message/context 和 host 弹窗逻辑。
- `initial-trim` entry 没有可点击官方 share button。
- 错误触发 share 会打开错误消息或错误会话的分享流程，风险高于 copy/feedback。

当前 UI 要求：

- 未启用 debug/share 复用条件不足时，按钮保持禁用并给出说明。
- 图标如果没有官方模板，使用本地 fallback 图标。

### More

优先级：

1. `host-bound`：能定位到官方 More 按钮和官方 popover 时，使用官方 More 菜单。
2. `local-fallback`：找不到官方 More 时，使用 TurboRender 本地菜单。

为什么不能全官方：

- `initial-trim` entry 没有官方 More button。
- 官方 More popover 依赖 host 当前 DOM 和定位上下文。
- 错误复用全局 More 容易点到热区里的另一条消息。

当前 UI 要求：

- 本地 More 菜单位置跟随按钮，优先在按钮上方，空间不足时在下方。
- 第二次点击 More 必须关闭菜单。
- 菜单项保留 branch/read aloud/stop read aloud 等能力。

### Branch In New Chat

优先级：

1. 能打开官方 More popover 并找到官方 branch 菜单项时，点击官方菜单项。
2. 找不到官方菜单项时，只记录本地 action，不伪造跳转。

为什么不能全官方：

- 官方 branch 是 More 菜单里的二级行为，不是单独稳定按钮。
- `initial-trim` entry 的 host menu 不存在。

### Read Aloud / Stop Read Aloud

优先级：

1. 能打开官方 More popover 并找到官方 read aloud/stop 按钮时，点击官方菜单项。
2. 有真实 conversation/message id 时，使用官方 read aloud backend 生成音频。
3. 后端不可用且允许 fallback 时，使用浏览器 speech synthesis。

为什么不能全官方：

- 官方朗读按钮同样依赖 host More 菜单上下文。
- `initial-trim` entry 需要通过 payload/host id 解析出真实 message id。
- 音频播放、streaming 和停止状态需要由扩展在归档区维护。

## 为什么不能全部使用官方实现

1. 性能目标冲突：全量官方 DOM/React 复用意味着旧消息重新进入 live subtree，长会话卡顿会回来。
2. 初始裁剪没有官方实例：`initial-trim` 历史只有 payload 数据，没有官方按钮、菜单和 React handler。
3. 官方内部不是稳定 API：React props、DOM 层级、sprite id、菜单结构都会变。
4. 错误点击风险高：在长对话里用“最近的官方按钮”容易点到另一条消息。
5. MV3 扩展隔离：content script 无法安全依赖宿主私有闭包和 React 内部方法。
6. 可用性需要 fallback：没有 fallback 时，归档历史里的 copy、feedback、read aloud 会在许多场景完全不可用。

## 改进方向

- 优先提高 `parked-dom` entry 的 host-bound 命中率。
- 保持 `initial-trim` entry 的官方图标和官方 API fallback。
- 对 share 单独做更保守的官方复用研究，避免误触发错误消息的分享流程。
- 为每个 action 保留明确的 `host-bound`、`local-fallback`、`unavailable` 状态，方便测试和 live debug。
