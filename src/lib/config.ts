// Page Agent Extension Configuration Types

export interface LLMConfig {
    baseURL: string
    apiKey: string
    model: string
    temperature: number
    maxTokens: number
    maxRetries: number
}

export interface ToolConfig {
    enabled: string[]
    disabledTools: string[]
}

export interface UIConfig {
    language: 'zh-CN' | 'en-US'
}

export interface ExtensionConfig {
    llm: LLMConfig
    tools: ToolConfig
    ui: UIConfig
}

// Default configuration (from original page-agent project)
export const DEFAULT_CONFIG: ExtensionConfig = {
    llm: {
        baseURL: 'https://hwcxiuzfylggtcktqgij.supabase.co/functions/v1/llm-testing-proxy',
        apiKey: 'PAGE-AGENT-FREE-TESTING-RANDOM',
        model: 'PAGE-AGENT-FREE-TESTING-RANDOM',
        temperature: 0.7,
        maxTokens: 4096,
        maxRetries: 2,
    },
    tools: {
        enabled: [
            'done',
            'wait',
            'ask_user',
            'click_element_by_index',
            'input_text',
            'select_dropdown_option',
            'scroll',
            'scroll_horizontally',
        ],
        disabledTools: ['execute_javascript'], // Experimental tool disabled by default
    },
    ui: {
        language: 'zh-CN',
    },
}

// All available internal tools
export const ALL_TOOLS = [
    { id: 'done', name: '完成任务', description: '完成当前任务并提供结果摘要' },
    { id: 'wait', name: '等待', description: '等待页面加载或数据更新' },
    { id: 'ask_user', name: '询问用户', description: '向用户询问问题并等待回答' },
    { id: 'click_element_by_index', name: '点击元素', description: '通过索引点击页面元素' },
    { id: 'input_text', name: '输入文本', description: '在输入框中输入文本' },
    { id: 'select_dropdown_option', name: '选择下拉选项', description: '从下拉菜单中选择选项' },
    { id: 'scroll', name: '滚动页面', description: '垂直滚动页面' },
    { id: 'scroll_horizontally', name: '水平滚动', description: '水平滚动页面或元素' },
    { id: 'execute_javascript', name: '执行脚本', description: '执行 JavaScript 代码（实验性）', experimental: true },
]
