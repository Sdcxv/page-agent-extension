# AI 编码助手指南

> 本文件遵循 [AGENTS.md](https://agents.md) 开放标准，为 AI 编码助手提供项目特定的上下文和指引。

## 项目概述

这是一个 **Chrome 浏览器扩展**，基于 [page-agent](https://github.com/AiWaves-Code/page-agent) 库开发，用于在网页上运行 AI 自动化任务。

### 目录结构

```
src/
├── background/          # Service Worker 后台脚本
│   └── service-worker.ts    # 消息处理、任务状态管理、日志存储
├── content/             # 内容脚本
│   └── content-script.ts    # PageAgent 初始化、任务执行
├── popup/               # 弹出窗口 UI
├── options/             # 设置页面
└── lib/                 # 核心库
    ├── page-agent/      # AI Agent 核心
    │   ├── PageAgent.ts     # ⭐ 主 Agent 类
    │   ├── llms/            # LLM 客户端
    │   ├── tools/           # Agent 工具定义
    │   └── prompts/         # 系统提示词
    ├── page-controller/ # DOM 操作控制器
    │   ├── PageController.ts  # ⭐ 主控制器类
    │   ├── actions.ts         # 元素交互（点击、输入、滚动）
    │   └── dom/dom_tree/      # DOM 提取引擎
    ├── ui/              # UI 组件
    └── messages.ts      # 消息类型定义
```

## 开发命令

```bash
npm install              # 安装依赖
npm run dev              # 开发模式（监听文件变化）
npm run build            # 生产构建
npm run typecheck        # TypeScript 类型检查
```

## 核心架构

### 消息通信

扩展使用 `chrome.runtime.sendMessage` 进行组件间通信：

- **Content Script → Service Worker**: 任务心跳、日志、代理请求
- **Service Worker → Content Script**: 任务恢复、配置更新
- **Popup ↔ Service Worker**: 任务控制、状态查询

消息类型定义在 `src/lib/messages.ts`。

### 交互模式

支持两种交互模式（在设置页面配置）：

1. **Debugger 模式**: 使用 Chrome Debugger Protocol 模拟鼠标/键盘事件
2. **Simulated 模式**: 使用 JavaScript 合成事件

### 跨页面任务恢复

- 页面卸载时通过 `onDispose` 回调保存 history 到 Service Worker
- 新页面加载时通过 `tabs.onUpdated` 恢复任务状态

## 关键文件说明

| 文件 | 说明 |
|------|------|
| `src/lib/page-agent/PageAgent.ts` | ⭐ 核心 Agent，处理 LLM 交互和任务循环 |
| `src/lib/page-agent/llms/OpenAIClient.ts` | LLM 客户端（通过 Proxy 绕过 CORS） |
| `src/lib/page-agent/llms/utils.ts` | 模型适配补丁（modelPatch 函数） |
| `src/lib/page-agent/tools/index.ts` | Agent 工具定义（点击、输入、滚动等） |
| `src/lib/page-agent/prompts/system_prompt.md` | 系统提示词（中文优化版） |
| `src/lib/page-controller/actions.ts` | DOM 操作实现 |
| `src/background/service-worker.ts` | 后台任务管理、日志存储 |
| `src/content/content-script.ts` | 页面注入脚本、Agent 生命周期 |

## 添加新功能

### 添加新 Agent 工具

1. 在 `src/lib/page-agent/tools/index.ts` 中定义工具
2. 如需 DOM 操作，先在 `PageController` 中添加方法
3. 工具通过 `this.pageController.methodName()` 调用 DOM 操作

### 添加新交互模式支持

1. 在 `src/lib/page-controller/actions.ts` 中实现对应模式的逻辑
2. 在 `service-worker.ts` 中添加消息处理（如 Debugger 模式）

## 代码规范

- 使用 TypeScript 严格模式
- 公共 API 必须有显式类型注解
- 代码和注释使用中文或英文（用户交互部分使用中文）
- 每次修改应同时提升代码质量，不仅仅是实现功能

## 上游变更合并流程

当需要合并上游 [page-agent](https://github.com/AiWaves-Code/page-agent) 仓库的变更时，**必须遵循以下流程**：

### 1. 获取变更文件清单

```bash
# 在上游仓库目录执行
git diff <旧版本SHA>..<新版本SHA> --name-only
```

### 2. 逐个文件对比

对于每个变更文件，**必须**：
1. 查看上游文件的完整差异：`git diff <旧SHA>..<新SHA> -- <文件路径>`
2. 检查插件中对应文件是否存在及内容
3. 判断变更是否需要合并到插件

### 3. 文件映射关系

| 上游路径 | 插件路径 | 说明 |
|----------|----------|------|
| packages/page-agent/src/ | src/lib/page-agent/ | PageAgent 核心 |
| packages/page-controller/src/ | src/lib/page-controller/ | DOM 控制器 |
| packages/llms/src/ | src/lib/page-agent/llms/ | LLM 客户端 |
| packages/ui/src/ | src/lib/ui/ | UI 组件 |

### 4. 必须记录合并结果

创建变更合并报告，记录：
- 变更文件清单
- 每个文件的变更内容摘要
- 合并状态（已合并/跳过/待合并）
- 跳过原因（如：网站专用、依赖配置等）

### 5. 忽略的文件类型

以下文件类型无需合并：
- `package.json`、`package-lock.json`（插件有独立依赖管理）
- `packages/website/*`（网站专用）
- 测试文件 `*.test.ts`、`*.spec.ts`

