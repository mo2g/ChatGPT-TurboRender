# 受控 Chrome 中 unpacked 扩展未加载的排障 Cookbook

[English version](./cookbook-controlled-chrome.md)

这份 cookbook 记录的是一个很具体的问题：`chrome-devtools` 明明已经连上了受控浏览器，但 `.output/chrome-mv3` 这个 unpacked 扩展并没有真正生效，导致 ChatGPT 页面上看不到 TurboRender 的注入标记，也看不到任何折叠批次 UI。

它适合在以下场景复用：

- 你需要让 Codex 的 `chrome-devtools` MCP 指向一个可控浏览器
- 你想在这个浏览器里加载仓库里的 unpacked 扩展
- 你发现“浏览器起了，但扩展没进去”

## 症状

最初看起来一切都正常：

- 受控 Chrome / Chromium 窗口启动了
- `chrome-devtools` 也能连上 `http://127.0.0.1:9222`
- 页面的 URL 也确实是目标 ChatGPT 页面

但进一步检查时，会发现：

- `chrome://extensions/` 里没有预期的扩展条目
- 目标页面没有 TurboRender 注入痕迹
- 例如 `document.querySelector('[data-turbo-render-inline-history-root="true"]')` 为空
- 批次卡片、`展开 / 折叠` 操作轨、顶部状态条都不会出现

这说明问题不在页面逻辑，而在“受控浏览器的启动链路”。

## 误区

一开始我踩了几个容易误判的点：

1. 只要 `--load-extension` 写在命令行里，扩展就一定会加载。
2. 只要 MCP 能连到浏览器，这个浏览器就一定是“我刚启动的那个”。
3. 只要在 `chrome://extensions` 里手工点“加载未打包的扩展程序”，就能稳定复用到 DevTools MCP。

实际情况不是这样。

在这个项目里，系统安装的稳定版 Google Chrome 并不是一个可靠的 unpacked 扩展调试目标。更稳的做法是使用 Chromium 系浏览器，最好是仓库内可控、可重复启动的那一个。

## 根因

问题有两层。

### 1. MCP 不一定在连你以为的浏览器

`chrome-devtools-mcp` 默认会附着到它自己能看到的目标。如果没有强制指定一个稳定的远程调试端口，它很容易连到另一个实例，或者连到一个没有扩展的浏览器。

### 2. 稳定版 Google Chrome 对这条开发流不够友好

在这个排障里，稳定版 Google Chrome 对 `--load-extension` 的表现不可靠。命令行参数看起来还在，但 unpacked 扩展并没有真正按预期注入。

我们实际验证后确认：

- `Google Chrome for Testing` 可以通过远程调试端口稳定启动
- 带 `--load-extension` 的 Chromium 系浏览器是可用的
- 旧 profile 可能会把启动状态污染掉，所以 profile 需要隔离

## 解决方案

最后采用的是“仓库内受控浏览器”方案。

### 1. 用仓库脚本统一启动浏览器

通过 `scripts/debug-mcp-chrome.mjs` 启动受控浏览器，而不是在 MCP 自带浏览器里手工点扩展页。

```bash
pnpm debug:mcp-chrome -- https://chatgpt.com/share/<share-id>
```

这个脚本会：

- 检查 `.output/chrome-mv3` 是否已经构建
- 优先使用 Playwright 自带的 `Google Chrome for Testing`
- 如果可用，也可以使用本地 Chromium
- 绑定固定的远程调试端口
- 使用独立的 `user-data-dir`
- 预加载 `.output/chrome-mv3`

### 2. 给浏览器和 profile 做隔离

我们遇到过一个很隐蔽的问题：旧 profile 状态会污染新实例，导致浏览器能起，但扩展还是不稳定。

最终做法是把 profile 按浏览器类型和端口隔离，例如：

- `.wxt/mcp-chrome-profile/chrome-for-testing-9222`
- `.wxt/mcp-chrome-profile/chromium-9222`

这样每次都是干净的受控实例，问题不会从上次会话里继承过来。

### 3. 让 `chrome-devtools` MCP 明确连接这个实例

项目级 `.codex/config.toml` 固定把 `chrome-devtools` 指向 `http://127.0.0.1:9222`，这样重新打开 Codex 会话后，DevTools 会接到你自己启动的浏览器，而不是别的浏览器实例。

## 验证方法

建议按这个顺序验收。

### 1. 确认浏览器真的起来了

启动后，脚本应输出类似信息：

```text
[TurboRender] launched controlled Chrome on http://127.0.0.1:9222
[TurboRender] browser: chrome-for-testing (...)
[TurboRender] extension path: .../.output/chrome-mv3
[TurboRender] profile path: .../.wxt/mcp-chrome-profile/...
```

### 2. 确认 CDP 端口可访问

```bash
curl http://127.0.0.1:9222/json/version
```

你应该能看到一个有效的 `webSocketDebuggerUrl`。

### 3. 打开目标页面并检查注入标记

在 DevTools 里检查这些 DOM 标记：

```js
document.querySelector('[data-turbo-render-inline-history-root="true"]')
document.querySelectorAll('[data-turbo-render-group-id]').length
document.querySelectorAll('[data-turbo-render-action="toggle-group"]').length
```

如果扩展真的生效，至少应该能看到 `inline-history-root`，长会话里还会出现分组和折叠按钮。

### 4. 不要只看 `chrome://extensions`

在这个场景里，`chrome://extensions` 只能说明你打开了扩展管理页，不能单独证明目标页面已经注入成功。真正可靠的是目标页面上的 TurboRender 标记。

## 排障经验

- 稳定版 Google Chrome 不应再作为 unpacked 扩展调试的默认目标。
- 远程调试端口比“肉眼确认浏览器窗口”更可靠。
- profile 一定要隔离，不要复用一个已经被污染过的调试目录。
- 验收时优先看目标页面上的 DOM 标记，而不是只看 `chrome://extensions`。
- 如果你要做可分享的调试 cookbook，应该把“怎么启动”和“怎么验收”写在同一份文档里。

## 最终建议

如果你只想记住一句话：

> 用仓库脚本启动一个独立的 Chromium 系浏览器，固定远程调试端口，隔离 profile，并让 `chrome-devtools` MCP 指向它。

这条链路比“在 MCP 自带浏览器里手工加载扩展”稳定得多。
