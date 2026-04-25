# 离线开发指南（历史方案）

> 历史方案说明：这份文档保留旧的离线开发路线，已不再作为 TurboRender 的主开发或主验收链路。
> 当前主线请使用 [docs/plan/cdp-connected-development.md](./plan/cdp-connected-development.md) 和 [docs/cookbook-controlled-chrome.zh-CN.md](./cookbook-controlled-chrome.zh-CN.md)。
> 如需真实宿主验证，优先使用 `pnpm debug:mcp-chrome`、`pnpm check:mcp-chrome`、`pnpm reload:mcp-chrome`、`pnpm test:e2e -- --chat-url=...`。
> 历史说明：本文提到的离线浏览器回放 spec 已经从主线移除；当前只保留 `pnpm legacy:fixtures:*` 维护脚本和相关背景知识。

## 概述

本项目支持两种离线开发模式：

1. **HAR 回放模式** - 使用录制的网络流量，但 Extension UI 可能不显示
2. **Mock Server 模式** - 使用本地 Mock 服务器，完整支持 Extension UI 和 Read Aloud

## 模式对比

| 功能 | HAR 回放 | Mock Server |
|------|---------|-------------|
| Extension UI 渲染 | ⚠️ 可能不显示 | ✅ 完整支持 |
| Read Aloud 测试 | ❌ 不支持 | ✅ 支持（模拟音频） |
| 网络依赖 | ❌ 完全离线 | ⚠️ 需要代理非 Mock API |
| 设置复杂度 | 低 | 中等 |

## HAR 回放模式

### 适用场景
- 快速验证页面结构和基本网络请求
- 无需 Extension UI 的测试

### 使用方法
```bash
# 1. 捕获 fixtures（需要登录的 Chrome）
pnpm legacy:fixtures:capture

# 2. 校验本地 bundle 是否完整
pnpm legacy:fixtures:check
```

### 限制
- Extension 依赖 `/backend-api/conversation/{id}` API 来构建批次 UI
- HAR 重放的 URL 匹配可能不完全，导致 API 请求 404
- 旧的离线浏览器回放 spec 已移除，因此这条路径只剩背景参考价值

## Mock Server 模式（推荐）

### 适用场景
- 完整的 Extension UI 开发和测试
- Read Aloud 功能开发和调试

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器请求 chatgpt.com/c/{id}                               │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────┐                                │
│  │   Mock Server (本地)    │                                │
│  │                         │                                │
│  │ ┌─────────────────────┐ │                                │
│  │ │ /backend-api/       │ │  返回 fixture                 │
│  │ │ /conversation/{id}  │ │  conversation.json            │
│  │ └─────────────────────┘ │                                │
│  │                         │                                │
│  │ ┌─────────────────────┐ │                                │
│  │ │ /backend-api/       │ │  返回模拟                     │
│  │ │ /synthesize         │ │  音频 URL                     │
│  │ └─────────────────────┘ │                                │
│  │                         │                                │
│  │ ┌─────────────────────┐ │                                │
│  │ │ 其他请求            │ │  代理到真实                   │
│  │ │                     │ │  chatgpt.com                  │
│  │ └─────────────────────┘ │                                │
│  └─────────────────────────┘                                │
│         │                                                   │
│         ▼                                                   │
│  Extension 获得真实对话数据，UI 正常渲染                      │
└─────────────────────────────────────────────────────────────┘
```

### 使用方法

```bash
# 1. 先捕获 fixtures（只需要运行一次）
pnpm legacy:fixtures:capture

# 2. 校验并诊断本地 bundle
pnpm legacy:fixtures:check
pnpm legacy:fixtures:diagnose <fixture-id>
```

### Mock Server API

| API | 响应 | 说明 |
|-----|------|------|
| `GET /backend-api/conversation/{id}` | `conversation.json` | 返回真实对话数据 |
| `POST /backend-api/synthesize` | 模拟音频 URL | 用于测试 Read Aloud |

### 扩展开发

使用 Mock Server 进行 Extension 开发：

```typescript
// 在测试或开发脚本中使用
import { createChatgptMockServer } from './tests/mocks/chatgpt-mock-server';

const mockServer = await createChatgptMockServer({
  fixture: SMALL_FIXTURE,  // 使用已捕获的 fixture
  port: 3000,              // 指定端口
});

// 现在可以用浏览器打开 fixture URL
// Extension 会连接到 Mock Server 获取数据
console.log(`Mock server at ${mockServer.baseUrl}`);

// 开发完成后关闭
await mockServer.close();
```

## 故障排除

### 为什么没有离线 E2E 命令了
这套历史路线已经退出主线。仓库不再维护 fake-host 浏览器 spec，也不再把本地回放结果当作 TurboRender 的宿主兼容性证据。

### HAR 回放时 Extension UI 不显示
这是已知限制。HAR 重放无法完美匹配所有 API 请求的 URL（特别是带查询参数的）。使用 **Mock Server 模式** 解决。

### Mock Server 端口冲突
默认使用随机端口（`port: 0`），如需固定端口请检查是否被占用：
```bash
lsof -i :3000  # 检查端口 3000
```

### Read Aloud 没有声音
Mock Server 返回的是示例音频 URL（beep 声）。如需测试真实音频播放，需要替换为实际的 TTS 服务或本地音频文件。

## 未来改进

- [ ] 支持多个 fixtures 同时 Mock
- [ ] 添加请求/响应日志便于调试
- [ ] 支持 WebSocket 模拟（用于实时消息）
- [ ] 提供 CLI 工具快速启动 Mock Server
