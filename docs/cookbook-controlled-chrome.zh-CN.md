# 受控 Chrome 中 unpacked 扩展未加载的排障 Cookbook

[English version](./cookbook-controlled-chrome.md)

这条受控浏览器链路现在已经是 TurboRender 的主开发路径。更完整的日常开发说明见 [docs/plan/cdp-connected-development.md](./plan/cdp-connected-development.md)。

## 主开发链路

```bash
pnpm build
pnpm debug:mcp-chrome -- https://chatgpt.com/
pnpm check:mcp-chrome
```

`pnpm check:mcp-chrome` 现在把默认的长 `https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1` 会话当作精确护栏目标，并报告 archive 就绪状态，因此它很适合作为 live smoke 之前的预检。

之后每次改代码，执行 `pnpm build` 和 `pnpm reload:mcp-chrome`，然后按目标选择真实宿主回归：

- `pnpm test:e2e`：默认 chat 主线 smoke，使用 `https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1`
- `pnpm test:e2e -- --chat-url=https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1`：显式覆盖默认 chat 目标
- `pnpm test:e2e -- --use-active-tab`：只有你确认当前活动 ChatGPT 标签页已经是目标长对话时才用

`pnpm test:e2e:live` 仍保留为同一套 live runner 的显式别名。

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

### 2. 先跑仓库内的健康检查

```bash
pnpm check:mcp-chrome
```

这个命令会检查 CDP endpoint、精确输出当前匹配到的 ChatGPT 标签页，并确认 TurboRender DOM 标记和 archive 就绪状态是否已经注入。

### 3. 需要时再手工确认 CDP 端口

```bash
curl http://127.0.0.1:9222/json/version
```

你应该能看到一个有效的 `webSocketDebuggerUrl`。

### 4. 打开目标页面并检查注入标记

在 DevTools 里检查这些 DOM 标记：

```js
document.querySelector('[data-turbo-render-inline-history-root="true"]')
document.querySelectorAll('[data-turbo-render-group-id]').length
document.querySelectorAll('[data-turbo-render-action="toggle-archive-group"]').length
```

如果扩展真的生效，至少应该能看到 `inline-history-root`，长会话里还会出现分组和折叠按钮。

### 5. 不要只看 `chrome://extensions`

在这个场景里，`chrome://extensions` 只能说明你打开了扩展管理页，不能单独证明目标页面已经注入成功。真正可靠的是目标页面上的 TurboRender 标记。

## Live Smoke 排障

如果 `pnpm test:e2e` 或 `pnpm test:e2e:live` 失败，先把问题归到下面四类之一，再决定是否需要改代码。

### 1. CDP endpoint 不可达

症状：

- `pnpm check:mcp-chrome` 还没报告 ChatGPT 标签页就失败
- `curl http://127.0.0.1:9222/json/version` 失败或没有返回

恢复步骤：

```bash
pnpm build
pnpm debug:mcp-chrome -- https://chatgpt.com/
pnpm check:mcp-chrome
```

### 2. 受控浏览器没有落在正确的 ChatGPT 标签页

症状：

- `pnpm check:mcp-chrome` 能连上，但输出的 tab URL 不是预期的精确 `/c/...`
- live smoke 因为 `runtime` 为 `null` 或 `routeKind` 不对而失败

恢复步骤：

- 在受控浏览器里关闭重复的 ChatGPT 标签页
- 重新打开目标路由
- 重新执行 `pnpm check:mcp-chrome`，确认命中的就是目标页签后再跑 smoke

### 3. TurboRender 注入缺失

症状：

- 页面打开了，但一直看不到 `[data-turbo-render-inline-history-root="true"]`
- `pnpm check:mcp-chrome` 报 `inline-history=0` 或 `ui-root=0`

恢复步骤：

```bash
pnpm build
pnpm reload:mcp-chrome
pnpm check:mcp-chrome
```

如果这样还不行，再回头检查本文前面关于 unpacked 扩展路径和 profile 隔离的步骤。

### 4. 宿主 read-aloud 菜单打不开或锚点错位

症状：

- 归档批次已经展开，但官方风格 more 菜单里没有 `Read aloud / 朗读`
- 菜单弹出位置和 more 按钮明显脱锚，或者点击后没有触发 `/backend-api/synthesize`

恢复步骤：

- 确认当前跑的是目标 `/c/...` 会话，而不是其他无关 ChatGPT 标签页
- 先确认 assistant archive entry 已可见，再打开 more 菜单
- 重新执行 `pnpm reload:mcp-chrome`，确认 TurboRender 标记仍然存在后再重跑 read-aloud smoke

## 排障经验

- 稳定版 Google Chrome 不应再作为 unpacked 扩展调试的默认目标。
- 远程调试端口比“肉眼确认浏览器窗口”更可靠。
- profile 一定要隔离，不要复用一个已经被污染过的调试目录。
- 验收时优先看目标页面上的 DOM 标记，而不是只看 `chrome://extensions`。
- 如果你要做可分享的调试 cookbook，应该把“怎么启动”和“怎么验收”写在同一份文档里。

## 历史：抓取离线真实页 Fixture

这条受控浏览器链路仍可用于维护离线 ChatGPT fixture bundle，但这已经是历史/补充路径，不再是主开发流程，假宿主浏览器回放也已退出 E2E。

1. 先启动受控浏览器并登录：

```bash
pnpm debug:mcp-chrome -- https://chatgpt.com/
```

2. 录制本机 fixture bundle：

```bash
pnpm legacy:fixtures:capture
```

`pnpm legacy:fixtures:capture` 会先连接到已登录的受控 Chrome，把该浏览器的 profile 克隆到一个临时录制 profile，再在这个临时浏览器里完成抓取。录制期间请保持源浏览器运行且保持登录状态。

3. 如果你想把 bundle 放到机器上的其他目录：

```bash
TURBO_RENDER_FIXTURE_ROOT=/absolute/path pnpm legacy:fixtures:capture
```

4. 之后只做剩余的历史维护检查：

```bash
pnpm legacy:fixtures:check
pnpm legacy:fixtures:diagnose <fixture-id>
```

fixture 默认落在 `tests/fixtures-local/chatgpt`，该目录会被 gitignore，只服务本机开发/测试。旧的浏览器回放 spec 已删除，因此这些 bundle 不再被当作宿主兼容性证据。

## 最终建议

如果你只想记住一句话：

> 用仓库脚本启动一个独立的 Chromium 系浏览器，固定远程调试端口，隔离 profile，并让 `chrome-devtools` MCP 指向它。

这条链路比“在 MCP 自带浏览器里手工加载扩展”稳定得多。
