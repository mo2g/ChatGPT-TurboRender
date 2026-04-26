# 离线开发指南（历史方案）

这份文档只保留旧方案的背景说明。离线 fixture 捕获、检查、诊断、假宿主回放和本地 mock server helper 已经从当前有效测试面移除。

当前主线请使用：

```bash
pnpm debug:mcp-chrome -- https://chatgpt.com/
pnpm check:mcp-chrome
pnpm reload:mcp-chrome
pnpm test:e2e -- --chat-url=https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1
```

需要了解为什么放弃离线路线时，可参考 `docs/plan/origin-fixture-replay.md`，但不要把其中的旧任务当作当前可执行命令。
