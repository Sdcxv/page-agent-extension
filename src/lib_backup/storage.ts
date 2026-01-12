// Chrome Storage API wrapper for Page Agent Extension

import { DEFAULT_CONFIG, type ExtensionConfig, type LLMConfig, type ToolConfig, type UIConfig } from './config'

const STORAGE_KEY = 'page_agent_config'

/**
 * Get the full extension configuration
 */
export async function getConfig(): Promise<ExtensionConfig> {
    return new Promise((resolve) => {
        chrome.storage.sync.get([STORAGE_KEY], (result) => {
            if (result[STORAGE_KEY]) {
                // Merge with defaults to ensure all fields exist
                resolve({
                    ...DEFAULT_CONFIG,
                    ...result[STORAGE_KEY],
                    llm: { ...DEFAULT_CONFIG.llm, ...result[STORAGE_KEY]?.llm },
                    tools: { ...DEFAULT_CONFIG.tools, ...result[STORAGE_KEY]?.tools },
                    ui: { ...DEFAULT_CONFIG.ui, ...result[STORAGE_KEY]?.ui },
                })
            } else {
                resolve(DEFAULT_CONFIG)
            }
        })
    })
}

/**
 * Save the full extension configuration
 */
export async function saveConfig(config: ExtensionConfig): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.sync.set({ [STORAGE_KEY]: config }, () => {
            resolve()
        })
    })
}

/**
 * Get LLM configuration
 */
export async function getLLMConfig(): Promise<LLMConfig> {
    const config = await getConfig()
    return config.llm
}

/**
 * Save LLM configuration
 */
export async function saveLLMConfig(llmConfig: Partial<LLMConfig>): Promise<void> {
    const config = await getConfig()
    config.llm = { ...config.llm, ...llmConfig }
    await saveConfig(config)
}

/**
 * Get tools configuration
 */
export async function getToolsConfig(): Promise<ToolConfig> {
    const config = await getConfig()
    return config.tools
}

/**
 * Save tools configuration
 */
export async function saveToolsConfig(toolsConfig: Partial<ToolConfig>): Promise<void> {
    const config = await getConfig()
    config.tools = { ...config.tools, ...toolsConfig }
    await saveConfig(config)
}

/**
 * Get UI configuration
 */
export async function getUIConfig(): Promise<UIConfig> {
    const config = await getConfig()
    return config.ui
}

/**
 * Save UI configuration
 */
export async function saveUIConfig(uiConfig: Partial<UIConfig>): Promise<void> {
    const config = await getConfig()
    config.ui = { ...config.ui, ...uiConfig }
    await saveConfig(config)
}

/**
 * Reset configuration to defaults
 */
export async function resetConfig(): Promise<void> {
    await saveConfig(DEFAULT_CONFIG)
}

/**
 * Check if using default/demo configuration
 */
export async function isUsingDefaultConfig(): Promise<boolean> {
    const config = await getConfig()
    return (
        config.llm.baseURL === DEFAULT_CONFIG.llm.baseURL &&
        config.llm.apiKey === DEFAULT_CONFIG.llm.apiKey
    )
}
