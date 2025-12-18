# Page Agent Extension 🤖

Page Agent Extension 是一个基于大语言模型（LLM）的自动化浏览器插件，能够像真人一样理解网页内容并根据您的指令自动执行复杂任务（如搜索、点击、填表、甚至跨网站导航）。

本项项目深度优化自阿里巴巴开源项目 [alibaba/page-agent](https://github.com/alibaba/page-agent)，并针对 Chrome 浏览器插件环境进行了大量的健壮性改造和私有化部署支持。

## 🚀 核心特性

- **跨站任务持久化**：即使页面在任务执行中跳转、重定向或刷新，Agent 也能在新页面自动接续进度，不会丢失上下文。
- **CSP 安全限制绕过**：通过 Background Proxy 技术，在具有严格内容安全策略（CSP）的网站（如 GitHub, Google）上也能正常调用 LLM。
- **双交互模式切换**：
  - **⚡ 增强模式 (Debugger)**: 利用 CDP (Chrome DevTools Protocol) 实现最真实的物理点击，绕过复杂的 UI 框架保护。
  - **🛡️ 兼容模式 (Simulated)**: 传统的脚本模拟交互，低干扰、高兼容性。
- **详尽的运行日志**：在设置页面提供实时的决策日志、工具调用记录及 LLM 通讯记录，支持 JSON 导出，方便模型调试。
- **私有化部署友好**：所有配置（LLM 地址、API Key、模型名称）均可动态修改，完美支持内网隔离环境下的 OpenAI 兼容服务。
- **极致响应速度**：采用 `document_start` 注入技术，确保 Agent 在页面尚未完全加载时就已经就绪。

## 🛠️ 安装指南

### 开发者安装
1.  克隆本项目：
    ```bash
    git clone https://github.com/Sdcxv/page-agent-extension.git
    cd page-agent-extension
    ```
2.  安装依赖并编译：
    ```bash
    npm install
    npm run build
    ```

### 已解压安装
1.  打开 Chrome 浏览器，访问 `chrome://extensions/`。
2.  开启右上角的 **"开发者模式"**。
3.  点击 **"加载已解压的扩展程序"**，选择项目中的 `dist` 目录。

## 🤖 配置与使用

1.  点击浏览器工具栏中的机器人图标。
2.  点击右上角 **⚙️ 设置** 按钮。
3.  配置您的 LLM 提供商：
    - **API Base URL**: 如 `https://api.openai.com/v1` 或您的私有地址。
    - **API Key**: 您的模型密钥。
    - **模型名称**: 如 `gpt-4o`, `deepseek-chat`, `gemini-2.5-flash`。
4.  在输入框输入任务（例如：“帮我搜素关于量子计算的新闻并打开第一条”），点击 **执行**。

## 🙏 致谢 & 声明

本项目是在阿里巴巴优秀的开源项目 [page-agent](https://github.com/alibaba/page-agent) 基础上进行的插件化适配和功能增强。感谢原作者及其团队提供的强大核心引擎。

## 📄 开源协议

本项目遵循原项目的开源协议。
Copyright (C) 2025 Alibaba Group Holding Holding Limited.
Modified and Optimized by Sdcxv.
