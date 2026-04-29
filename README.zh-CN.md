# ChatGPT TurboRender

<p align="center">
  <b>不替换 ChatGPT 原生界面，让超长对话重新流畅运行</b>
</p>

<p align="center">
  <a href="https://github.com/mo2g/ChatGPT-TurboRender/stargazers"><img src="https://img.shields.io/github/stars/mo2g/ChatGPT-TurboRender?style=flat-square&color=ffd700" alt="GitHub Stars"></a>
  <a href="https://github.com/mo2g/ChatGPT-TurboRender/releases"><img src="https://img.shields.io/github/v/release/mo2g/ChatGPT-TurboRender?style=flat-square&color=blue" alt="Latest Release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License"></a>
    <img src="https://img.shields.io/badge/Chrome-Compatible-blue.svg?style=flat-square&logo=google-chrome" alt="Chrome">
  <img src="https://img.shields.io/badge/Edge-Compatible-blue.svg?style=flat-square&logo=microsoft-edge" alt="Edge">
  <img src="https://img.shields.io/badge/Firefox-Compatible-orange.svg?style=flat-square&logo=firefox" alt="Firefox">
  <a href="./README.md"><img src="https://img.shields.io/badge/English-Readme-blue?style=flat-square" alt="English"></a>
</p>

<p align="center">
  <a href="docs/assets/preview.jpg">
    <img src="docs/assets/preview.jpg" alt="ChatGPT TurboRender 预览" width="640">
  </a>
</p>

> 🚀 **TurboRender** 为 ChatGPT 带来滑动窗口导航。像浏览文档一样翻阅千轮对话，全文搜索、秒速跳转 —— 告别卡顿。

**[⬇️ 从 Releases 安装](https://github.com/mo2g/ChatGPT-TurboRender/releases)** • **[📖 技术文档](./docs/architecture.zh-CN.md)** • **[🇬🇧 English Docs](./README.md)**

---

## 😫 痛点

ChatGPT 对话一旦变长，网页端就会出现这些问题：
- ⌨️ **打字卡顿** — 输入延迟超过 500ms，字打完字母才蹦出来
- 📜 **滚动掉帧** — 滚轮不听使唤，页面一卡一卡
- 🐌 **内存飙升** — 浏览器吃掉 2GB+ 内存，风扇狂转
- ⏱️ **流式卡顿** — 每输出一个字，整个页面都跟着抖

**TurboRender 彻底解决这些问题** —— **滑动窗口模式**：只渲染当前页消息，完整对话本地缓存，搜索翻页秒开。

> 💡 **觉得好用？** [点个 ⭐ Star](https://github.com/mo2g/ChatGPT-TurboRender/stargazers) 让更多人发现这个项目！

## ✨ 核心特性

| 特性 | 说明 |
|------|------|
| 🪟 **滑动窗口模式** | **主推模式** —— 像浏览文档一样翻阅长对话。上一页/下一页/首页/最新页 + 秒级全文搜索 |
| 🎯 **保留原生界面** | 不像阅读模式扩展，保留 ChatGPT 全部功能 |
| 🔍 **全文搜索** | 秒级搜索整个对话历史，一键跳转到任意轮次 |
| 📦 **收纳模式** | 自动折叠旧消息，保留最近 5 对。仅当性能下降时智能激活 |
| 🛡️ **隐私优先** | 零数据外传，本地 IndexedDB 缓存，无云端 |
| ⚡ **秒速导航** | 告别无限滚动等待，任意页面毫秒级跳转 |

### 🪟 滑动窗口模式（推荐）

**主推模式**，专为长对话设计。TurboRender 将完整对话数据缓存在浏览器 IndexedDB 中，ChatGPT 只渲染当前窗口（默认 10 对交互）。

- **翻页浏览**：上一页、下一页、最早、最新按钮
- **全文搜索**：秒级搜索整个对话，快速定位
- **页码跳转**：输入页码，瞬间直达
- **历史只读**：历史窗口为只读状态，发送消息需回到最新页

### 📦 收纳模式

- 保留最近 5 对交互，旧消息折叠为轻量卡片
- 点击展开查看完整内容
- 与 ChatGPT 原生 UI 无缝融合

## 🚀 快速开始

### 从 GitHub Releases 安装

1. 下载对应浏览器的最新版本：
   - **[Chrome/Edge (.zip)](https://github.com/mo2g/ChatGPT-TurboRender/releases)**
   - **[Firefox (.xpi)](https://github.com/mo2g/ChatGPT-TurboRender/releases)**

2. Chrome/Edge 加载解压版扩展：
   - 打开 `chrome://extensions` → 开启"开发者模式"
   - 点击"加载已解压的扩展程序" → 选择解压后的文件夹

3. 打开任意长 ChatGPT 对话 —— TurboRender 会在需要时自动激活

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/mo2g/ChatGPT-TurboRender.git
cd ChatGPT-TurboRender

# 安装依赖并构建
pnpm install
pnpm build

# 加载 .output/chrome-mv3/ 作为解压版扩展
```

## 📊 性能提升

| 指标 | 不使用 TurboRender | 使用 TurboRender | 改善效果 |
|------|-------------------|-----------------|---------|
| DOM 节点数（千轮） | ~50,000+ | ~2,000 | **减少 96%** |
| 输入延迟 | 300-800ms | <50ms | **输入丝滑** |
| 内存占用 | 2-4GB | 200-400MB | **减少 90%** |
| 滚动性能 | 卡顿 15-20fps | 流畅 60fps | **如丝般顺滑** |

*实际效果因对话长度和内容而异。测试环境：Chrome 120，1000+ 轮对话。*

## 🔒 隐私与安全

- ✅ **零数据外传** —— 对话内容永远不会离开你的设备
- ✅ **无云同步** —— 所有数据保存在浏览器本地
- ✅ **无埋点分析** —— 零追踪，零遥测
- ✅ **开源透明** —— MIT 协议，代码全公开
- ✅ **最小权限** —— 只在 `chatgpt.com` 和 `chat.openai.com` 运行

> 滑动窗口模式下，对话数据保存在 **ChatGPT 页面 origin 下的 IndexedDB** 中（与 ChatGPT 本身同一安全边界）。可随时从页内工具条清除缓存。

## 工作原理

**滑动窗口模式**（新用户默认）
- 在 IndexedDB 中缓存完整对话数据（位于 ChatGPT origin 下）
- 通过原生 ChatGPT UI 仅渲染当前窗口（可配置 N 对交互）
- 导航时通过合成响应（缓存命中）重新加载同一路由，无需重新获取完整 payload
- 工具条提供上一页/下一页/最早/最新/页码跳转/搜索功能

**收纳模式**（后备，自动激活）
- 监控已完成消息数、活跃 DOM 后代数和帧抖动
- 超过阈值时将旧消息折叠为紧凑 inline 卡片，保留最近 5 对交互
- 用户可展开卡片查看完整内容；右侧有固定的展开/折叠控制
- 若宿主页重渲染过于激进，则回退到软折叠模式

## 工具条功能

滑动窗口模式激活时，页内工具条提供：

- **翻页导航**：最早、上一页、下一页、最新按钮
- **页码跳转**：输入页码，瞬间直达
- **全文搜索**：搜索整个对话，快速定位
- **缓存管理**：清除当前会话缓存或全部滑动窗口缓存
- **设置**：配置窗口大小和首选模式

## 开发命令

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

`pnpm test:e2e:live` 仍保留为同一套真实页 smoke 的显式别名。`pnpm test:all` 会先跑 `pnpm test:unit`，再把同样的真实宿主参数转发给 live runner。

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
- performance 模式不会持久化完整对话快照
- sliding-window 模式会把完整 conversation payload 保存在 ChatGPT 页面 origin 下的本地 IndexedDB，用于翻页和搜索时避免每个窗口都重新下载完整会话
- sliding-window 缓存可在页内工具条中清除，支持清除当前会话或清除全部 sliding-window 会话缓存
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
