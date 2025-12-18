// Page Agent Content Script
// This script is injected into web pages to enable the PageAgent functionality

import './content-style.css'
import { PageAgent } from './page-agent-bundle'
import { MESSAGE_TYPES, createMessage, type ExtensionMessage, type ExecuteTaskMessage } from '../lib/messages'
import { getConfig } from '../lib/storage'
import type { ExtensionConfig } from '../lib/config'

// PageAgent instance (will be dynamically created)
let pageAgent: any = null
let isInitialized = false

// Initialize content script
console.log('[PageAgent] Content script loaded')

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    console.log('[PageAgent Content] Received message:', message.type, message)
    handleMessage(message, sendResponse)
    return true // Keep channel open for async response
})

async function handleMessage(message: ExtensionMessage, sendResponse: (response: any) => void) {
    switch (message.type) {
        case MESSAGE_TYPES.EXECUTE_TASK:
            await executeTask((message as ExecuteTaskMessage).task)
            sendResponse({ success: true })
            break

        case MESSAGE_TYPES.STOP_TASK:
            stopTask()
            sendResponse({ success: true })
            break

        case MESSAGE_TYPES.PAUSE_TASK:
            if (pageAgent) {
                pageAgent.paused = true
            }
            sendResponse({ success: true })
            break

        case MESSAGE_TYPES.RESUME_TASK:
            if (pageAgent) {
                pageAgent.paused = false
            }
            sendResponse({ success: true })
            break

        case MESSAGE_TYPES.GET_STATUS:
            sendResponse({
                initialized: isInitialized,
                running: pageAgent && !pageAgent.disposed,
                paused: pageAgent?.paused || false,
            })
            break

        case 'PING':
            sendResponse({ pong: true })
            break

        default:
            sendResponse({ error: 'Unknown message type' })
    }
}

// Execute a task
async function executeTask(task: string) {
    try {
        // Get configuration
        const config = await getConfig()

        // Create PageAgent instance
        pageAgent = await createPageAgent(config)

        // Notify popup that task started
        chrome.runtime.sendMessage(createMessage({
            type: MESSAGE_TYPES.TASK_STARTED,
        }))

        // Execute the task
        const result = await pageAgent.execute(task)

        // Notify popup of completion
        chrome.runtime.sendMessage(createMessage({
            type: MESSAGE_TYPES.TASK_COMPLETED,
            success: result.success,
            result: result.data,
        }))
    } catch (error: any) {
        console.error('[PageAgent] Task execution failed:', error)

        chrome.runtime.sendMessage(createMessage({
            type: MESSAGE_TYPES.TASK_ERROR,
            error: error.message || 'Unknown error',
        }))
    }
}

// Stop the current task
function stopTask() {
    if (pageAgent && !pageAgent.disposed) {
        pageAgent.dispose('USER_STOPPED')
        pageAgent = null
    }
}

// Create PageAgent instance with config
async function createPageAgent(config: ExtensionConfig): Promise<any> {
    // Create custom tools config based on enabled/disabled tools
    const customTools: Record<string, any> = {}
    for (const toolId of config.tools.disabledTools) {
        customTools[toolId] = null // Disable this tool
    }

    // Create and return PageAgent instance
    const agent = new PageAgent({
        baseURL: config.llm.baseURL,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        temperature: config.llm.temperature,
        maxTokens: config.llm.maxTokens,
        maxRetries: config.llm.maxRetries,
        language: config.ui.language,
        customTools,

        // Lifecycle hooks for progress updates
        onAfterStep: (stepCnt: number, history: any[]) => {
            const lastStep = history[history.length - 1]
            chrome.runtime.sendMessage(createMessage({
                type: MESSAGE_TYPES.TASK_PROGRESS,
                step: stepCnt,
                maxSteps: 20,
                status: lastStep?.action?.name || 'processing',
                brain: lastStep?.brain ? {
                    evaluation: lastStep.brain.evaluation_previous_goal,
                    memory: lastStep.brain.memory,
                    nextGoal: lastStep.brain.next_goal,
                } : undefined,
            }))
        },
    })

    isInitialized = true
    return agent
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (pageAgent && !pageAgent.disposed) {
        pageAgent.dispose('PAGE_UNLOADING')
    }
})
