// Page Agent Options Page Logic

import { ALL_TOOLS, DEFAULT_CONFIG, type ExtensionConfig } from '../lib/config'
import { getConfig, saveConfig, resetConfig } from '../lib/storage'
import { modelPatch } from '../lib/page-agent/llms/utils'

// DOM Elements
const elements = {
    // LLM Config
    baseUrl: document.getElementById('baseUrl') as HTMLInputElement,
    apiKey: document.getElementById('apiKey') as HTMLInputElement,
    model: document.getElementById('model') as HTMLInputElement,
    temperature: document.getElementById('temperature') as HTMLInputElement,
    temperatureValue: document.getElementById('temperatureValue') as HTMLSpanElement,
    maxTokens: document.getElementById('maxTokens') as HTMLInputElement,
    maxRetries: document.getElementById('maxRetries') as HTMLInputElement,
    toggleApiKey: document.getElementById('toggleApiKey') as HTMLButtonElement,

    // Tools
    toolsGrid: document.getElementById('toolsGrid') as HTMLDivElement,

    // UI Config
    language: document.getElementById('language') as HTMLSelectElement,

    // Footer
    statusIndicator: document.getElementById('statusIndicator') as HTMLSpanElement,
    statusText: document.getElementById('statusText') as HTMLSpanElement,
    resetBtn: document.getElementById('resetBtn') as HTMLButtonElement,
    saveBtn: document.getElementById('saveBtn') as HTMLButtonElement,
    testBtn: document.getElementById('testBtn') as HTMLButtonElement,
    testToolBtn: document.getElementById('testToolBtn') as HTMLButtonElement,
    testResult: document.getElementById('testResult') as HTMLDivElement,
}

let currentConfig: ExtensionConfig

// Initialize page
async function init() {
    currentConfig = await getConfig()
    populateForm(currentConfig)
    renderTools()
    setupEventListeners()
    updateStatus('已加载配置', 'success')
}

// Populate form with config values
function populateForm(config: ExtensionConfig) {
    // LLM Config
    elements.baseUrl.value = config.llm.baseURL === DEFAULT_CONFIG.llm.baseURL ? '' : config.llm.baseURL
    elements.apiKey.value = config.llm.apiKey === DEFAULT_CONFIG.llm.apiKey ? '' : config.llm.apiKey
    elements.model.value = config.llm.model === DEFAULT_CONFIG.llm.model ? '' : config.llm.model
    elements.temperature.value = config.llm.temperature.toString()
    elements.temperatureValue.textContent = config.llm.temperature.toString()
    elements.maxTokens.value = config.llm.maxTokens.toString()
    elements.maxRetries.value = config.llm.maxRetries.toString()

    // UI Config
    elements.language.value = config.ui.language
}

// Render tools grid
function renderTools() {
    elements.toolsGrid.innerHTML = ''

    ALL_TOOLS.forEach(tool => {
        const isEnabled = currentConfig.tools.enabled.includes(tool.id)
        const isExperimental = 'experimental' in tool && tool.experimental

        const toolItem = document.createElement('label')
        toolItem.className = `tool-item ${!isEnabled ? 'disabled' : ''} ${isExperimental ? 'experimental' : ''}`
        toolItem.innerHTML = `
      <input type="checkbox" class="tool-checkbox" data-tool-id="${tool.id}" ${isEnabled ? 'checked' : ''} />
      <div class="tool-info">
        <div class="tool-name">${tool.name} ${isExperimental ? '<span class="tool-badge">实验性</span>' : ''}</div>
        <div class="tool-desc">${tool.description}</div>
      </div>
    `

        elements.toolsGrid.appendChild(toolItem)
    })
}

// Setup event listeners
function setupEventListeners() {
    // Temperature slider
    elements.temperature.addEventListener('input', () => {
        elements.temperatureValue.textContent = elements.temperature.value
    })

    // Toggle API key visibility
    elements.toggleApiKey.addEventListener('click', () => {
        const isPassword = elements.apiKey.type === 'password'
        elements.apiKey.type = isPassword ? 'text' : 'password'
        elements.toggleApiKey.textContent = isPassword ? '🙈' : '👁️'
    })

    // Tools checkboxes
    elements.toolsGrid.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement
        if (target.classList.contains('tool-checkbox')) {
            const toolId = target.dataset.toolId!
            const toolItem = target.closest('.tool-item')

            if (target.checked) {
                if (!currentConfig.tools.enabled.includes(toolId)) {
                    currentConfig.tools.enabled.push(toolId)
                }
                currentConfig.tools.disabledTools = currentConfig.tools.disabledTools.filter(t => t !== toolId)
                toolItem?.classList.remove('disabled')
            } else {
                currentConfig.tools.enabled = currentConfig.tools.enabled.filter(t => t !== toolId)
                if (!currentConfig.tools.disabledTools.includes(toolId)) {
                    currentConfig.tools.disabledTools.push(toolId)
                }
                toolItem?.classList.add('disabled')
            }
        }
    })

    // Save button
    elements.saveBtn.addEventListener('click', handleSave)

    // Reset button
    elements.resetBtn.addEventListener('click', handleReset)

    // Test buttons
    elements.testBtn.addEventListener('click', testConnection)
    elements.testToolBtn.addEventListener('click', testToolUse)
}

// Get form values
function getFormValues(): ExtensionConfig {
    return {
        llm: {
            baseURL: elements.baseUrl.value.trim() || DEFAULT_CONFIG.llm.baseURL,
            apiKey: elements.apiKey.value.trim() || DEFAULT_CONFIG.llm.apiKey,
            model: elements.model.value.trim() || DEFAULT_CONFIG.llm.model,
            temperature: parseFloat(elements.temperature.value),
            maxTokens: parseInt(elements.maxTokens.value, 10),
            maxRetries: parseInt(elements.maxRetries.value, 10),
        },
        tools: currentConfig.tools,
        ui: {
            language: elements.language.value as 'zh-CN' | 'en-US',
        },
    }
}

// Handle save
async function handleSave() {
    try {
        const config = getFormValues()
        await saveConfig(config)
        currentConfig = config
        updateStatus('设置已保存', 'success')

        // Notify other parts of the extension
        chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED', config })
    } catch (error) {
        console.error('Failed to save config:', error)
        updateStatus('保存失败', 'error')
    }
}

// Handle reset
async function handleReset() {
    if (!confirm('确定要重置所有设置为默认值吗？')) {
        return
    }

    try {
        await resetConfig()
        currentConfig = DEFAULT_CONFIG
        populateForm(currentConfig)
        renderTools()
        updateStatus('已重置为默认设置', 'warning')
    } catch (error) {
        console.error('Failed to reset config:', error)
        updateStatus('重置失败', 'error')
    }
}

// Update status indicator
function updateStatus(text: string, type: 'success' | 'warning' | 'error') {
    elements.statusText.textContent = text
    elements.statusIndicator.className = 'status-indicator'
    if (type !== 'success') {
        elements.statusIndicator.classList.add(type)
    }

    // Auto-clear warning/error after 3 seconds
    if (type !== 'success') {
        setTimeout(() => {
            updateStatus('已加载配置', 'success')
        }, 3000)
    }
}

// Test connection
async function testConnection() {
    const config = getFormValues().llm

    // UI Loading state
    elements.testBtn.disabled = true
    elements.testBtn.textContent = '正在测试...'
    elements.testResult.style.display = 'none'
    elements.testResult.className = 'test-result'

    try {
        // Simple chat completion request
        const response = await fetch(`${config.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 5,
                temperature: 0.1
            })
        })

        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`
            try {
                const errorData = await response.json()
                if (errorData.error?.message) {
                    errorMessage += `\nMessage: ${errorData.error.message}`
                }
            } catch (e) {
                // Ignore json parse error
            }
            throw new Error(errorMessage)
        }

        const data = await response.json()

        // Success
        elements.testResult.textContent = `✅ 连接成功!\n\n响应:\n${JSON.stringify(data, null, 2)}`
        elements.testResult.classList.add('success')
        elements.testResult.style.display = 'block'

    } catch (error: any) {
        console.error('Test connection failed:', error)
        elements.testResult.textContent = `❌ 连接失败\n\n错误信息:\n${error.message}\n\n检查建议:\n1. 确认 API Key 正确\n2. 确认 Base URL 正确 (通常以 /v1 结尾)\n3. 确认模型名称正确`
        elements.testResult.classList.add('error')
        elements.testResult.style.display = 'block'
    } finally {
        elements.testBtn.disabled = false
        elements.testBtn.textContent = '⚡ 测试连接 (Chat)'
    }
}

// Test tool use capability
async function testToolUse() {
    const config = getFormValues().llm

    // UI Loading state
    elements.testToolBtn.disabled = true
    elements.testToolBtn.textContent = '正在测试工具调用...'
    elements.testResult.style.display = 'none'
    elements.testResult.className = 'test-result'

    try {
        // Simple tool definition
        const sampleTools = [
            {
                type: 'function',
                function: {
                    name: 'get_weather',
                    description: '获取指定城市的当前天气',
                    parameters: {
                        type: 'object',
                        properties: {
                            city: {
                                type: 'string',
                                description: '城市名称，例如：北京'
                            }
                        },
                        required: ['city']
                    }
                }
            }
        ]

        // Apply modelPatch to make test consistent with real execution
        const requestBody = modelPatch({
            model: config.model,
            messages: [{ role: 'user', content: '北京天气怎么样？' }],
            tools: sampleTools,
            tool_choice: 'required',
            max_tokens: 100,
            temperature: 0.1
        })

        console.log('[Options Test] Testing Tool Use with body:', requestBody)

        const response = await fetch(`${config.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(requestBody)
        })

        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`
            try {
                const errorData = await response.json()
                if (errorData.error?.message) {
                    errorMessage += `\n\n详情: ${errorData.error.message}`
                }
            } catch (e) { }
            throw new Error(errorMessage)
        }

        const data = await response.json()
        const hasToolCall = data.choices?.[0]?.message?.tool_calls?.length > 0

        if (hasToolCall) {
            elements.testResult.textContent = `✅ Tool Use 测试成功!\n\n模型成功生成了工具调用:\n${JSON.stringify(data.choices[0].message.tool_calls[0], null, 2)}`
            elements.testResult.classList.add('success')
        } else {
            elements.testResult.textContent = `⚠️ 连接成功，但模型未触发工具调用。\n\n这可能是因为模型认为不需要调用工具，或者该模型对特定语言的指令理解有偏差。建议检查模型是否原生支持 Tool Use。\n\n响应内容: ${data.choices?.[0]?.message?.content || '空'}`
            elements.testResult.classList.add('warning')
        }
        elements.testResult.style.display = 'block'

    } catch (error: any) {
        console.error('Tool use test failed:', error)
        elements.testResult.textContent = `❌ Tool Use 测试失败\n\n错误信息:\n${error.message}\n\n排查建议:\n1. 确认该模型是否支持 Function Calling / Tool Use\n2. OpenRouter 用户请确保选中的 Provider 支持该功能\n3. 检查 API Base URL 是否包含 /v1 路径`
        elements.testResult.classList.add('error')
        elements.testResult.style.display = 'block'
    } finally {
        elements.testToolBtn.disabled = false
        elements.testToolBtn.textContent = '🛠️ 测试 Tool Use (智能识别工具)'
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init)
