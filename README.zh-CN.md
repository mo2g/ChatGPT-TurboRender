# ChatGPT TurboRender

尽量不改 ChatGPT 原生界面，只解决“超长对话把网页拖慢”这件事。

[English README](./README.md) | [架构说明](./docs/architecture.zh-CN.md) | [Architecture Notes](./docs/architecture.md) | [CDP 真实页指南](./docs/plan/cdp-connected-development.md) | [受控 Chrome Cookbook](./docs/cookbook-controlled-chrome.zh-CN.md) | [Controlled Chrome Cookbook](./docs/cookbook-controlled-chrome.md)

ChatGPT TurboRender 是一个 Chromium 优先的浏览器扩展，目标是在超长 ChatGPT 会话中降低掉帧、输入延迟、滚动卡顿和页面无响应问题。它通过“首屏裁剪冷历史 + 热区保留 + 按需恢复”的方式，减少页面上长期活跃的 DOM 负担。

如果这个项目对你有帮助，欢迎 Star 仓库，也欢迎带着性能录屏、Profile 或复现案例来提 Issue。真实世界的长对话样本，是把插件做稳的最快方式。

如果它也帮你节省了时间，可以看下方的 [支持项目](#support)。

## 为什么要做这个项目

ChatGPT 对话一旦很长，网页端通常会出现这些问题：

- 历史消息越来越多，DOM 节点不断堆积
- 回答流式生成时，每次更新都要碰一个很大的节点树
- 滚动开始卡顿
- 输入框延迟明显
- CPU、内存持续上升

TurboRender 的目标不是改造你的使用习惯，而是把渲染压力从主线程上挪开。它保留最近的热区消息，把更早、已完成的历史消息裁剪或折叠成轻量历史块，只有在你真的回看时才恢复。

## 它现在能做什么

- 尽量保留 ChatGPT 原生界面，而不是强制切到自定义阅读器模式
- 仅在受支持的会话路由（`/c/<id>`、`/share/<id>`）上工作，支持 `chatgpt.com` 与 `chat.openai.com`
- 默认只保留最近 5 对交互，其余历史按原位批次卡片折叠在 transcript 里
- 仅在达到阈值后自动介入（已完成消息数、活跃 DOM 后代数或帧抖动次数）
- 在页面主世界里裁剪首屏 ` /backend-api/conversation/:id ` payload，并支持 share 页 loaderData
- 将冷区消息按组 parking，并替换成轻量原位批次卡片
- Popup 只在受支持的 ChatGPT 会话页上作为状态/控制面板使用；如果当前受支持会话页的运行时暂时失联，会显示该页面的恢复态
- 长批次展开后，右侧 `展开 / 折叠` 按钮会随滚动保持可见
- 支持英文与简体中文，默认自动跟随，也可手动覆盖
- 如果宿主页 DOM 变化太激进，会自动切到更保守的 soft-fold 模式
- 所有设置只保存在本地，不会把对话内容发送到外部服务

## 项目状态

- 首发浏览器：Chrome / Edge
- 运行模型：Manifest V3
- 数据边界：仅本地
- 网络边界：仅在页面层拦截并裁剪首屏 conversation payload，不接后端、不做云同步
- 当前开发主线：通过 `pnpm debug:mcp-chrome` + `pnpm reload:mcp-chrome` + `pnpm test:e2e` 连接已登录受控浏览器，在真实 `chatgpt.com` 上开发和回归（默认使用 `https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1`）
- 历史兼容说明：离线 fixture 只保留在显式的 `pnpm legacy:fixtures:*` 维护命令下，假宿主浏览器回放不再属于 E2E

## 折叠历史如何工作

TurboRender 会保留最新 5 对交互继续走原生 ChatGPT transcript。

- 更早历史保持在原本的位置，只是折叠成批次卡片
- 每个批次默认容纳 5 对交互，顺序不变
- 已经进入官方 DOM 的批次，展开时优先恢复原始宿主 DOM
- 首屏被裁掉的批次，展开时会在原位显示近似原生的只读内容
- 如果展开后的批次很长，右侧的 `展开 / 折叠` 操作轨会随滚动保持可见，方便快速收回

## 快速开始

```bash
pnpm install
pnpm build
```

如果你想要本地解压后的目录，可用 `pnpm build`、`pnpm build:edge`、`pnpm build:firefox`，然后侧载 `.output/chrome-mv3`、`.output/edge-mv3` 或 `.output/firefox-mv2`。如果你想要 GitHub Release 归档，可用 `pnpm package:chrome`、`pnpm package:edge`、`pnpm package:firefox`，分别生成 Chrome/Edge 的 `.zip` 和 Firefox 的签名 `.xpi`。

常用命令：

```bash
pnpm dev
pnpm debug:mcp-chrome -- https://chatgpt.com/
pnpm check:mcp-chrome
pnpm reload:mcp-chrome
pnpm test
pnpm test:e2e
pnpm test:e2e -- --chat-url=https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1
pnpm test:e2e -- --use-active-tab
pnpm test:all
pnpm package:chrome
pnpm package:edge
pnpm package:firefox
```

`pnpm test:e2e:live` 仍保留为同一套真实页 smoke 的显式别名。`pnpm test:all` 会先跑 `pnpm test:unit`，再把同样的真实宿主参数转发给 live runner。历史 fixture 维护命令保留为：`pnpm legacy:fixtures:capture`、`pnpm legacy:fixtures:check`、`pnpm legacy:fixtures:diagnose`、`pnpm legacy:fixtures:update-id`。

## 浏览器 Release

GitHub Actions 会在 [.github/workflows/browser-packages.yml](./.github/workflows/browser-packages.yml) 里通过 tag 触发，构建 Chrome 和 Edge 的 `.zip` 归档，以及 Firefox 的签名 `.xpi`，并发布到 GitHub Release。

详细的触发方式、Release asset 名称、签名密钥要求和手动安装步骤见 [docs/browser-packages.md](./docs/browser-packages.md)。

浏览器商店自动提交流程单独记录在 [docs/store-publishing.md](./docs/store-publishing.md)。

## 受控 Chrome 调试

这是当前仓库的主开发和真实页验收链路。如果要让 `chrome-devtools` MCP 真正连到“已加载 unpacked 扩展”的浏览器，不要再在 MCP 自启浏览器里手动点 `chrome://extensions`。统一使用仓库内的受控 Chrome 启动命令：

```bash
pnpm build
pnpm debug:mcp-chrome -- https://chatgpt.com/
pnpm check:mcp-chrome
```

`pnpm check:mcp-chrome` 现在把默认的长 `https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1` 会话当作精确护栏目标，并报告 archive 就绪状态，因此它很适合作为 live smoke 之前的预检。

每次修改代码后，先 `pnpm build`，再 `pnpm reload:mcp-chrome`，然后按目标选择真实宿主回归命令：

- `pnpm test:e2e`：默认 chat 主线 smoke，使用 `https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1`
- `pnpm test:e2e -- --chat-url=https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1`：显式覆盖默认 chat 目标
- `pnpm test:e2e -- --use-active-tab`：仅在你确认当前活动 ChatGPT 标签页已经是目标长对话时，才当作便捷模式使用

这个命令会拉起一个固定监听 `http://127.0.0.1:9222` 的 Chromium 系浏览器，并预加载 `.output/chrome-mv3`。启动器会优先使用仓库自带的 Playwright 浏览器（`Google Chrome for Testing`）或本地 Chromium，因为稳定版 Google Chrome 已经不再对 unpacked 扩展生效 `--load-extension`。启动后重新打开当前仓库的 Codex 会话，让项目级的 `[.codex/config.toml](./.codex/config.toml)` 把 `chrome-devtools` MCP 指向这个浏览器。完整指南见 [docs/plan/cdp-connected-development.md](./docs/plan/cdp-connected-development.md)。

## 历史离线 Fixture

离线 fixture 资产仍保留在仓库里，作为历史参考，但它不再是主开发或主验收路径，假宿主浏览器回放也已经退出 E2E。

- `pnpm test:e2e` 现在是主线真实页 smoke 回归入口
- `pnpm test:e2e:live` 继续保留为同一套真实页 smoke 的显式别名
- popup 等扩展自有界面不再单独维持浏览器 E2E 车道，继续通过单元/集成测试和手工检查覆盖
- `pnpm legacy:fixtures:capture`、`pnpm legacy:fixtures:check`、`pnpm legacy:fixtures:diagnose`、`pnpm legacy:fixtures:update-id` 继续保留用于历史维护
- 历史 fixture 捕获不再被当作宿主兼容性证据
- 历史背景见 [docs/offline-development.md](./docs/offline-development.md) 和 [docs/requirements/offline-chatgpt-environment.md](./docs/requirements/offline-chatgpt-environment.md)

每个 fixture 默认保存在 `tests/fixtures-local/chatgpt`，目录内包含 `replay.har.zip`、`page.mhtml`、`conversation.json`、`storage-state.json`、`metadata.json`。这个目录默认被 gitignore，只服务当前机器。

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
- 不会把完整对话上传到设备外
- 运行时不持久化完整对话快照
- 历史离线 fixture 只是本地开发测试产物，默认存放在 gitignore 的本机目录里

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

<a id="support"></a>

<a id="popup-status-control-panel"></a>

## Popup 状态/控制面板

Popup 只在受支持的 ChatGPT 会话页上作为状态/控制面板使用。

- 支持的路由：`https://chatgpt.com/c/<id>`、`https://chatgpt.com/share/<id>`、`https://chat.openai.com/c/<id>`、`https://chat.openai.com/share/<id>`
- 非支持的 ChatGPT 页面会显示明确的不可用状态，并提示支持的 URL 规则
- 如果当前标签页是受支持的 ChatGPT 会话页但运行时暂时无法读取，Popup 会显示该页面的恢复态
- 演示按钮会打开一个稳定的分享页：[https://chatgpt.com/share/69cb7947-c818-83e8-9851-1361e4480e08](https://chatgpt.com/share/69cb7947-c818-83e8-9851-1361e4480e08)
- 帮助按钮会打开本节

## 支持项目

如果 TurboRender 帮你节省了时间，也欢迎支持后续维护和兼容性更新。

| 微信赞赏码 | 支付宝收款码 |
| --- | --- |
| <img src="./public/assets/wechat-sponsor.jpg" alt="微信赞赏码" width="280" /> | <img src="./public/assets/aliapy-sponsor.jpg" alt="支付宝收款码" width="280" /> |

支持会帮助我持续做维护、真实长对话测试，以及 ChatGPT 兼容性更新。

## License

[MIT](./LICENSE)
