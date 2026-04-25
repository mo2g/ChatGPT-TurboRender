# FAQ

## Playwright 或受控 Chrome 启动失败

如果你遇到下面这些情况，通常不是 `pnpm build` 的缓存问题：

- `Playwright` 启动浏览器后立刻退出
- `chromium.connectOverCDP()` 报 `ECONNREFUSED 127.0.0.1:9222`
- 浏览器可以起来，但扩展没有注入到页面
- 受控浏览器能连上，但页面看起来还是旧效果

### 常见原因

1. **浏览器是在受限环境里直接启动的**
   - 我们在排障时遇到过：Chrome / Chromium / WebKit 直接在受限环境里启动会崩溃、`SIGTRAP`、或因为 `crashpad` / profile 权限问题退出。
   - 这类问题和代码逻辑无关，通常是浏览器启动路径本身不稳定。

2. **连接到了错误的浏览器实例**
   - `chrome-devtools` / Playwright 只会连接到它看到的 remote debugging 端口。
   - 如果目标浏览器没真正起来，或者端口不是 `9222`，就会出现 `ECONNREFUSED`。

3. **用了不可靠的浏览器二进制**
   - 稳定版 Google Chrome 对 `--load-extension` 这种 unpacked 扩展调试方式并不可靠。
   - 这个仓库更适合使用 Chromium、Chrome for Testing，或仓库脚本管理的受控浏览器。

4. **页面已经打开，但没有重新注入**
   - `pnpm build` 只会生成新 bundle，不会自动让已经打开的 ChatGPT 页面重新跑一遍 content script。
   - 需要重载扩展、重开页面，或者至少对页面做一次硬刷新。

### 推荐解决方案

1. **优先通过仓库脚本启动受控浏览器**
   ```bash
   pnpm debug:mcp-chrome -- about:blank
   ```

   这个脚本会：

   - 检查 `.output/chrome-mv3` 是否存在
   - 优先选择可用的 Chromium / Chrome for Testing
   - 使用独立的 `user-data-dir`
   - 预加载仓库的 unpacked 扩展
   - 打开固定的 remote debugging 端口
   - 如果 9222 上已经有一个已登录的受控浏览器，它会直接复用现有实例，而不是强行拉起新的浏览器

2. **确认 remote debugging 端口真的活着**
   ```bash
   curl http://127.0.0.1:9222/json/version
   ```

   只要这个接口返回了 `webSocketDebuggerUrl`，Playwright / MCP 才有可能稳定连上。

3. **在 Playwright 里连接到现有受控浏览器**
   - 测试和调试时优先使用 `CHROME_DEBUG_PORT=9222`
   - 不要让测试进程自己再额外启动一份随机浏览器
   - 如果你想保留 Google Chrome for Testing 的登录态，不要 `pkill` 这个进程；让脚本复用已存在的 9222 会话即可

4. **改完代码后重开页面**
   - 扩展 reload 以后，已经打开的 ChatGPT 页面通常需要重开或硬刷新。
   - 如果你看到页面没有变化，先确认你看的还是新的 tab 和新的扩展实例，而不是旧页面状态。

### 保留登录态的工作流

如果你的 Chrome for Testing 已经登录好了，建议这样做：

1. 保持浏览器进程一直开着，不要 `pkill`。
2. `pnpm build` 之后，在 `chrome://extensions` 里手动重载 TurboRender 扩展。
3. 如果你想自动完成第 2 步和第 3 步，直接运行：
   ```bash
   pnpm reload:mcp-chrome
   ```
   这个脚本会复用 `9222` 上的现有浏览器，只重载扩展并刷新 ChatGPT 相关标签页，不会关闭浏览器或清掉登录态。
4. 需要跑 E2E 时，优先使用 `pnpm test:e2e -- --chat-url=https://chatgpt.com/c/<conversation-id>`；只有确认当前活动页签就是目标长会话时，才使用 `pnpm test:e2e -- --use-active-tab`。

如果你想强制拉起一个全新的调试浏览器，可以显式设置：

```bash
CHROME_DEBUG_FORCE_RESTART=1 pnpm debug:mcp-chrome -- about:blank
```

### 快速排查顺序

1. 先跑 `pnpm build`
2. 再跑 `pnpm debug:mcp-chrome -- about:blank`
3. 再检查 `curl http://127.0.0.1:9222/json/version`
4. 如果只是想把扩展重载进当前登录态，先跑 `pnpm reload:mcp-chrome`
5. 最后重新打开 ChatGPT 页面并刷新

### 典型错误和含义

- `connect ECONNREFUSED 127.0.0.1:9222`
  - 受控浏览器没启动，或者 remote debugging 端口不是这个值

- 浏览器进程退出但没有页面
  - 常见于受限环境里直接启动浏览器，换成仓库脚本管理的受控浏览器

- 页面里没有 TurboRender 标记
  - 说明扩展没有真正注入，重点查浏览器实例、扩展加载和页面是否重开

### 经验结论

如果只记一条：

> 不是先怀疑 `pnpm build` 缓存，而是先确认受控浏览器、remote debugging 端口和页面重新注入都已经就绪。
