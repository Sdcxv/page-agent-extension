# Page Agent 私有化部署指南 (Internal Deployment Guide)

本指南旨在帮助您在内网/隔离环境（Intranet/Air-gapped environment）中部署和配置 Page Agent 浏览器插件。

## 1. 编译与打包

如果您直接拿到了 `page-agent-extension.zip`，可以跳过此步骤。

1.  在环境内安装 NodeJS (建议 v18+)。
2.  进入项目根目录，运行：
    ```bash
    npm install
    npm run build
    ```
3.  编译后的产物将存放在 `dist` 目录中。

## 2. 安装插件 (Chrome/Edge)

由于私有环境通常无法访问 Chrome Web Store，请按以下步骤手动加载：

1.  打开浏览器，访问 `chrome://extensions/` (或 Edge 的 `edge://extensions/`)。
2.  在右上角开启 **"开发者模式" (Developer mode)**。
3.  点击 **"加载已解压的扩展程序" (Load unpacked)**。
4.  选择本项目中的 `dist` 目录。
5.  插件图标将出现在浏览器工具栏中。

## 3. 私有 LLM 配置

Page Agent 的核心是 LLM。在内网环境，您需要将其指向企业内部部署的 OpenAI 兼容接口：

1.  点击插件图标，选择右上角的 **"⚙️ 设置"** 图标进入配置页。
2.  **API Base URL**: 填写您内网 LLM 服务的地址，例如 `http://10.x.x.x:8000/v1`。
3.  **API Key**: 填写内网服务的授权密钥（如果有）。
4.  **模型名称**: 填写内网部署的模型名称，例如 `deepseek-chat` 或 `qwen-max`。
5.  点击底部的 **"保存设置"**。

## 4. 离线使用注意事项

*   **交互模式**: 在内网环境建议首选 **"⚡ 增强模式" (Debugger)**，因为它不依赖外网的 Polyfill。
*   **图像识别**: 如果内网环境无法访问外部图片服务器，部分依赖视觉分析的工具可能会受限，建议使用纯文本能力强的模型。
*   **日志调试**: 如遇到执行问题，可在设置页底部的 **"运行日志"** 查看详细的报错信息。

## 5. 常见问题 (FAQ)

*   **Q: 插件提示“连接失败”？**
    A: 请确保您配置的 API Base URL 在内网是可达的，且支持跨域 (CORS) 请求。
*   **Q: 为什么某些页面无法点击？**
    A: 尝试切换回“兼容模式”，或检查内网安全软件是否拦截了 `chrome.debugger` 的调用。
