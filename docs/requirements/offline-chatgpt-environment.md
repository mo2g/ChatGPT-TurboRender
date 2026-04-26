# 离线 ChatGPT 环境需求（历史记录）

这份需求文档记录的是旧离线 fixture 方案的背景。相关捕获脚本、检查脚本、诊断脚本、fixture manifest、假宿主回放 helper 和 mock server helper 已经清理，不再作为 TurboRender 的当前开发或验收入口。

当前宿主兼容性验收以登录后的真实 `chatgpt.com` 页面为准：

```bash
pnpm debug:mcp-chrome -- https://chatgpt.com/
pnpm check:mcp-chrome
pnpm reload:mcp-chrome
pnpm test:e2e
```

默认长会话目标仍由 live runner 和 `scripts/live-targets-lib.mjs` 维护。
