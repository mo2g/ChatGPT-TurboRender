## 历史方案说明

> 这份方案记录的是“同源 fixture replay”路线，现已降级为历史参考，不再作为 TurboRender 的主开发路径。
> 当前实施主线请看 [cdp-connected-development.md](./cdp-connected-development.md)。

## 目标

**保持浏览器地址栏仍然是 `https://chatgpt.com/...`，不保存 cookies / localStorage / storageState，不依赖登录态，用 Playwright 在浏览器网络层把这些同源请求回放到本地 fixture。**

这条路的好处是：

* 对扩展来说，页面还是 `chatgpt.com`
* 对内容脚本来说，host permissions、同源 API、路由判断都不变
* 不需要保存真实登录态
* 可以按 fixture 精确控制页面和接口数据
* 比 `localhost` Mock Server 更符合你当前插件架构

---

# 推荐方案：同源 fixture replay

建议把离线开发拆成两个层级。

## Level 1：同源“半离线回放”

适合作为第一阶段落地版本。

### 思路

* 浏览器仍然访问 `https://chatgpt.com/c/<fixture-id>`
* Playwright 用 `context.route()` 拦截关键请求
* 关键接口直接用本地 fixture `fulfill`
* 非关键静态资源可以先放行到真实 CDN
* 不保存登录态

### 先拦截这些请求

1. **主文档**

   * `GET https://chatgpt.com/c/<id>`
   * 返回本地保存的 `shell.html`

2. **对话数据**

   * `GET https://chatgpt.com/backend-api/conversation/<id>`
   * 返回本地 `conversation.json`

3. **可能的语音接口**

   * `POST https://chatgpt.com/backend-api/synthesize`
   * 返回本地 mock 响应

4. **认证/会话检查**

   * `/api/auth/*`
   * `/backend-api/accounts/*`
   * `/ces/*`、遥测、实验接口
   * 统一 mock 或直接 abort

5. **WebSocket / SSE / streaming**

   * 本期先 abort
   * 不做真实流式

### 这个阶段的目标

先保证：

* 能打开 `chatgpt.com/c/<id>`
* 插件 content script 能正常运行
* 归档区 / 热区开发测试可用
* 不依赖真实登录

---

## Level 2：同源“全离线回放”

等 Level 1 稳定后再做。

### 目标

除了 URL 还是 `chatgpt.com`，连静态资源也本地回放。

### 额外需要

* 本地缓存关键 JS/CSS/font/static chunk
* 主文档里引用这些本地回放的同源资源
* Playwright 同样用 `route.fulfill()` 返回它们

### 代价

* fixture 体积会变大
* 更容易受 ChatGPT 前端版本变化影响
* 维护成本显著上升

所以不建议一开始就上全离线。

---

# 关键设计：fixture 不存登录态，只存“页面壳 + 对话数据”

建议新的 fixture 结构：

```txt
fixtures/
  chat/
    <fixture-name>/
      meta.json
      shell.html
      conversation.json
      synthesize.json
      assets/
```

## 每个文件的职责

### `meta.json`

保存最小元信息：

* `fixtureId`
* `routeKind` (`chat` / `share`)
* `sourceUrl`
* `capturedAt`
* `chatgptBuildHint`
* `locale`
* `notes`

### `shell.html`

不是保存 cookies，也不是 storageState。
而是保存“能让扩展运行的页面壳”。

建议第一版保存：

* 已加载完成后的页面 DOM 快照
* 删除敏感脚本
* 删除真实认证信息
* 删除不必要的内联 runtime 数据
* 保留足够的 transcript 结构和样式容器

### `conversation.json`

保存 `/backend-api/conversation/<id>` 的完整响应。
这会直接服务你当前扩展的主链路，因为项目本来就依赖这个数据做初始历史处理。

### `synthesize.json`

用于 Read Aloud 或相关功能的固定 mock 返回。

### `assets/`

留给后续全离线模式，不是第一阶段必须。

---

# Capture 阶段计划

你的 capture 工具只在**已登录的真实浏览器**里运行一次，但输出结果里**不保存登录态**。

## Capture 步骤

### Step 1：打开真实目标页面

在已登录 Chrome 中打开：

* `https://chatgpt.com/c/<id>`
  或
* `https://chatgpt.com/share/<id>`

### Step 2：抓两类数据

1. **主文档壳**

   * 抓取一个清洗后的 `shell.html`
2. **对话接口**

   * 抓取 `conversation.json`

### Step 3：清洗敏感信息

明确不保存：

* cookies
* localStorage
* sessionStorage
* IndexedDB
* Authorization header
* 任何 bearer token
* CSRF token
* 用户 session 标识

### Step 4：输出 fixture

写入本地 fixture 目录。

---

# `shell.html` 应该怎么定义

这里是成败关键。

你不要把它理解成“完整保存 ChatGPT 页面”，而应该理解成：

**一个能让 TurboRender 扩展在同源页面里稳定运行的宿主页面快照。**

所以第一版建议做得保守：

## 第一版 `shell.html` 原则

* 保留真实 DOM 结构
* 保留必要 class / aria / data-testid
* 保留对话区域容器
* 去掉真实脚本执行
* 去掉登录相关依赖
* 不追求官方 JS 继续工作
* 目标是让扩展基于现有 DOM 进行开发测试

这意味着：

### 第一版主要服务什么

* 归档 UI
* 热区逻辑
* parking / restore
* 分页冷区
* 样式对齐
* DOM 适配器测试

### 第一版不服务什么

* 完整的官方前端行为
* 真正的 regenerate / edit
* 复杂的官方交互链路

这点要明确，不然你会把范围做爆。

---

# Replay 阶段计划

Playwright 启动时不再访问 localhost，而是：

* 正常 `page.goto('https://chatgpt.com/c/<fixture-id>')`
* 但在 browser context 层把关键请求改成从 fixture 返回

## 推荐的拦截矩阵

### 1. 主文档

```ts
context.route(`https://chatgpt.com/c/${fixtureId}`, async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: shellHtml,
  });
});
```

### 2. conversation API

```ts
context.route(`https://chatgpt.com/backend-api/conversation/${fixtureId}*`, async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(conversationJson),
  });
});
```

### 3. synthesize

```ts
context.route('https://chatgpt.com/backend-api/synthesize*', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(mockSynthesizeResponse),
  });
});
```

### 4. 登录和会话相关

统一处理为：

* 返回未登录但不跳转的固定结果
* 或直接 abort

### 5. 遥测 / websocket / 实验接口

第一版直接 abort。

---

# 为什么这条路能解决“localhost 不同源”问题

因为请求 URL **没有变**。
浏览器、页面、扩展都仍然认为自己在访问：

* `https://chatgpt.com/c/<id>`
* `https://chatgpt.com/backend-api/conversation/<id>`

只是 Playwright 在网络层把响应替换成了本地 fixture。

所以：

* 扩展 host permission 仍匹配
* content script 仍注入到 `chatgpt.com`
* 你的路由识别逻辑仍成立
* `conversation/:id` 的同源读取仍成立

这正好贴合你现在的实现方式。 

---

# 推荐开发顺序

## Phase 1：先做 MVP

目标：让 `https://chatgpt.com/c/<fixture-id>` 在无登录状态下可打开，并让扩展 UI 出来。

### 任务

1. 实现离线 fixture 捕获命令（历史任务，当前已移除）

   * 输出 `meta.json`
   * 输出 `shell.html`
   * 输出 `conversation.json`

2. 实现 `fixture replay harness`

   * Playwright `context.route`
   * 同源拦截 document + conversation

3. 跑通一个最小 E2E

   * 页面可打开
   * content script 注入成功
   * 插件 UI 出现
   * 能读到 fixture conversation

### 验收

* 无 cookies / 无 storageState
* 无登录也能跑
* URL 仍是 `chatgpt.com`

---

## Phase 2：补足扩展开发所需接口

### 任务

* mock `/backend-api/synthesize`
* 屏蔽无关 auth / telemetry / websocket
* 增加 fixture 切换能力

### 验收

* Read Aloud 等相关路径可开发
* 测试环境更稳定

---

## Phase 3：增强壳页面可靠性

### 任务

* 优化 `shell.html` 清洗逻辑
* 加入 build/version 检测
* 当 fixture 与当前 DOM 适配器不兼容时给出提示

### 验收

* fixture 过期时更容易发现
* 减少“页面能开但行为诡异”的情况

---

## Phase 4：全离线增强（可选）

### 任务

* 本地回放 CSS/JS/font/static assets
* 真正做到断网也可运行

### 验收

* 关闭外网仍可启动 fixture 页面

---

# 主要风险

## 风险 1：`shell.html` 太“活”

如果你直接保存完整运行中的 HTML，里面可能残留过多脚本和动态状态，回放时会继续向真实服务发请求，或者因为缺失上下文报错。

### 规避

第一版把 `shell.html` 当成“静态宿主页”，不是“完整复活 ChatGPT App”。

---

## 风险 2：`shell.html` 太“死”

如果只保存一个过于简化的 HTML，扩展适配器可能找不到熟悉的 DOM 结构。

### 规避

保留 transcript 容器、turn 节点、关键 `data-testid` / `aria` / class。

---

## 风险 3：fixture 很快过期

ChatGPT DOM 改版后，旧 fixture 可能不适配。

### 规避

* 在 `meta.json` 记录 capture 时间和 build hint
* fixture 只作为开发测试基线，不作为永远稳定资产
* 提供一键 recapture

---

# 这条 plan 的一句话版本

**不用 localhost 伪装服务端，而是在 Playwright 里让浏览器继续访问 `chatgpt.com`，同时把主文档和 `/backend-api/conversation/:id` 等关键同源请求直接用本地 fixture fulfill 掉。**

这就是最符合你当前项目架构、也最安全的做法。

如果你愿意，我下一条可以直接帮你把这个 plan 继续细化成：
**目录结构 + capture 脚本设计 + Playwright replay harness 代码骨架**。
