# ChatGPT TurboRender

尽量不改 ChatGPT 原生界面，只解决“超长对话把网页拖慢”这件事。

[English README](./README.md) | [架构说明](./docs/architecture.zh-CN.md) | [Architecture Notes](./docs/architecture.md)

ChatGPT TurboRender 是一个 Chromium 优先的浏览器扩展，目标是在超长 ChatGPT 会话中降低掉帧、输入延迟、滚动卡顿和页面无响应问题。它通过“冷区历史消息停车 + 热区保留 + 按需恢复”的方式，减少页面上长期活跃的 DOM 负担。

如果这个项目对你有帮助，欢迎 Star 仓库，也欢迎带着性能录屏、Profile 或复现案例来提 Issue。真实世界的长对话样本，是把插件做稳的最快方式。

## 为什么要做这个项目

ChatGPT 对话一旦很长，网页端通常会出现这些问题：

- 历史消息越来越多，DOM 节点不断堆积
- 回答流式生成时，每次更新都要碰一个很大的节点树
- 滚动开始卡顿
- 输入框延迟明显
- CPU、内存持续上升

TurboRender 的目标不是改造你的使用习惯，而是把渲染压力从主线程上挪开。它保留最近的热区消息，把更早、已完成的历史消息折叠成轻量占位块，只有在你真的回看时才恢复。

## 它现在能做什么

- 尽量保留 ChatGPT 原生界面，而不是强制切到自定义阅读器模式
- 当线程长度或帧压力超过阈值时自动介入
- 将冷区消息按组 parking，并替换成轻量恢复块
- 支持恢复附近历史或恢复全部历史
- 如果宿主页 DOM 变化太激进，会自动切到更保守的 soft-fold 模式
- 所有设置只保存在本地，不拦截 OpenAI 网络请求

## 项目状态

- 首发浏览器：Chrome / Edge
- 运行模型：Manifest V3
- 数据边界：仅本地
- 网络边界：不拦截请求、不改写响应、不接后端
- 当前 E2E 说明：仓库里已经有 Playwright 扩展测试，但在某些无头沙箱里拉起 Chromium persistent extension context 仍然可能不稳定

## 快速开始

```bash
pnpm install
pnpm build
```

然后在 Chrome 或 Edge 中以开发者模式加载 `.output/chrome-mv3`。

常用命令：

```bash
pnpm dev
pnpm test
pnpm test:all
pnpm zip
```

## 仓库结构

- `entrypoints/`：WXT 入口，包括 background、content script、popup、options 和本地 harness 页面
- `lib/content/`：ChatGPT 页面适配、停车引擎、可见区计算、页内状态条
- `lib/background/`：后台消息处理和状态编排
- `lib/shared/`：设置、类型、消息协议、chat-id 工具
- `lib/testing/`：harness 和测试共用的 transcript fixture
- `tests/`：单元测试、集成测试、扩展级 Playwright 测试
- `docs/`：设计思路与实现说明

## 设计原则

- 先解决渲染压力
- 尽量保留原生交互
- 让扩展透明、可逆、可暂停
- 本地优先、权限最小化
- 宿主页变化时优先安全降级

## 隐私边界

TurboRender 不会把对话内容发送到任何外部服务。

- 没有云同步
- 没有埋点分析
- 不拦截 OpenAI 请求
- v1 不持久化完整对话快照

## Roadmap

- 更稳的 ChatGPT DOM 适配器
- Popup 中更细的单会话诊断信息
- 通过替换后台运行时继续推进 Firefox 支持
- 补齐商店发布所需截图、素材和元数据
- 建立更大的真实长对话性能样本库

## 参与贡献

欢迎提 Issue 或 PR，尤其是下面几类信息很有价值：

- 可稳定复现的长对话卡顿案例
- ChatGPT 页面结构变化后的 DOM 快照或录屏
- 插件开关前后的性能对比 Profile

## License

[MIT](./LICENSE)
