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
let isExecuting = false

// Initialize content script
console.log('[PageAgent] Content script loaded at:', new Date().toISOString())

// Immediate synchronous indicator (optional, but gives immediate feedback)
const showResumingIndicator = () => {
    const div = document.createElement('div')
    div.id = 'page-agent-resuming-indicator'
    div.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(8px);
        color: white;
        padding: 10px 20px;
        border-radius: 24px;
        font-size: 13px;
        z-index: 2147483647;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.2);
        transition: opacity 0.5s ease;
    `
    div.innerHTML = '<span style="animation: spin 1s linear infinite">⏳</span> 正在恢复 Page Agent 任务...'

    // Add animation
    const style = document.createElement('style')
    style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'
    document.head?.appendChild(style)

    // Append to documentElement for earliest visibility
    document.documentElement.appendChild(div)
    return div
}

const indicator = showResumingIndicator()

checkBackgroundStatus()

async function checkBackgroundStatus() {
    console.log('[PageAgent Content] Requesting status from background...')
    try {
        // Retry a few times if background is busy/sleeping
        let response: any = null
        for (let i = 0; i < 3; i++) {
            try {
                response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_STATUS })
                break
            } catch (e) {
                console.warn(`[PageAgent Content] Status query attempt ${i + 1} failed:`, e)
                await new Promise(r => setTimeout(r, 200))
            }
        }

        if (response?.active && response.task) {
            console.log('[PageAgent Content] Found active task, resuming execution:', response.task.task)
            // Remove indicator before starting long-running execution
            if (indicator) {
                indicator.style.opacity = '0'
                setTimeout(() => indicator.remove(), 500)
            }
            await executeTask(response.task.task, response.task.history)
        } else {
            console.log('[PageAgent Content] No active task found for this tab.')
            // Remove indicator if no task
            if (indicator) {
                indicator.style.opacity = '0'
                setTimeout(() => indicator.remove(), 500)
            }
        }
    } catch (e) {
        console.warn('[PageAgent Content] Final failure in querying background status:', e)
        if (indicator) {
            indicator.style.opacity = '0'
            setTimeout(() => indicator.remove(), 500)
        }
    }
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    console.log('[PageAgent Content] Received message:', message.type)
    handleMessage(message, sendResponse)
    return true // Keep channel open for async response
})

async function handleMessage(message: ExtensionMessage, sendResponse: (response: any) => void) {
    switch (message.type) {
        case MESSAGE_TYPES.EXECUTE_TASK:
            const executeMessage = message as any
            await executeTask(executeMessage.task, executeMessage.initialHistory)
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
                running: !!pageAgent && !pageAgent.disposed,
                paused: pageAgent?.paused || false,
            })
            break

        case 'PING':
            sendResponse({ pong: true })
            break

        case MESSAGE_TYPES.CONFIG_UPDATED:
            // Live update config if running
            if (pageAgent) {
                const newMode = (message as any).payload?.interactionMode
                if (newMode) {
                    console.log('[PageAgent] Dynamic mode update:', newMode)
                    pageAgent.config.interactionMode = newMode
                    if (pageAgent.pageController) {
                        pageAgent.pageController.config.interactionMode = newMode
                    }
                }
            }
            sendResponse({ success: true })
            break

        default:
            sendResponse({ error: 'Unknown message type' })
    }
}

// Execute a task
async function executeTask(task: string, initialHistory?: any[]) {
    if (isExecuting) {
        console.log('[PageAgent] Task already executing, ignoring request')
        return
    }

    // Critical: Clean up previous agent if exists to avoid checking duplications and UI conflicts
    if (pageAgent) {
        console.log('[PageAgent] Disposing previous agent before starting new task')
        try {
            pageAgent.dispose('STARTING_NEW_TASK')
        } catch (e) {
            console.warn('Error disposing old agent:', e)
        }
        pageAgent = null
    }

    try {
        isExecuting = true
        console.log('[PageAgent] Starting execution for task:', task)

        // Get configuration
        const config = await getConfig()

        // Create PageAgent instance
        pageAgent = await createPageAgent(config, initialHistory)

        // Notify background that task started (or resumed)
        chrome.runtime.sendMessage(createMessage({
            type: MESSAGE_TYPES.TASK_STARTED,
            payload: { task }
        } as any))

        // Execute the task
        const result = await pageAgent.execute(task)

        // Notify completion - BUT check if it was aborted/stopped first
        // If result.success is false and data contains "Aborted", we treat it as stopped?
        // Actually PageAgent.execute catches AbortError and returns specific data.
        // Let's rely on standard flow.
        chrome.runtime.sendMessage(createMessage({
            type: MESSAGE_TYPES.TASK_COMPLETED,
            success: result.success,
            result: result.data,
        }))
    } catch (error: any) {
        if (error.message === 'AbortError') {
            console.log('[PageAgent] Task execution aborted (expected during navigation/stop)')
            return
        }
        console.error('[PageAgent] Task execution failed:', error)

        chrome.runtime.sendMessage(createMessage({
            type: MESSAGE_TYPES.TASK_ERROR,
            error: error.message || 'Unknown error',
        }))
    } finally {
        isExecuting = false
    }
}

// Stop the current task
function stopTask() {
    if (pageAgent && !pageAgent.disposed) {
        // Use stop() first to keep UI alive for feedback
        if (pageAgent.running && typeof pageAgent.stop === 'function') {
            pageAgent.stop()
        } else {
            // Fallback to dispose if not running or old version?
            pageAgent.dispose('USER_STOPPED')
            pageAgent = null
        }
    }
    isExecuting = false
    // 发送停止确认给后台，以便清理状态
    chrome.runtime.sendMessage(createMessage({
        type: MESSAGE_TYPES.TASK_STOPPED
    } as any)).catch(() => {
        // 忽略发送失败（可能后台不可达）
    })
}

// Create PageAgent instance with config
async function createPageAgent(config: ExtensionConfig, initialHistory?: any[]): Promise<any> {
    const customTools: Record<string, any> = {}
    for (const toolId of config.tools.disabledTools) {
        customTools[toolId] = null
    }

    const agent = new PageAgent({
        baseURL: config.llm.baseURL,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        temperature: config.llm.temperature,
        maxTokens: config.llm.maxTokens,
        maxRetries: config.llm.maxRetries,
        language: config.ui.language,
        interactionMode: config.ui.interactionMode,
        customTools,
        initialHistory,

        onAfterStep: (stepCnt: number, history: any[]) => {
            // Heartbeat to background
            chrome.runtime.sendMessage(createMessage({
                type: MESSAGE_TYPES.TASK_HEARTBEAT,
                payload: { history, status: 'executing' }
            } as any))

            // Progress to popup
            chrome.runtime.sendMessage(createMessage({
                type: MESSAGE_TYPES.TASK_PROGRESS,
                step: stepCnt,
                maxSteps: 20,
                status: history[history.length - 1]?.action?.name || 'processing',
                brain: history[history.length - 1]?.brain ? {
                    evaluation: history[history.length - 1].brain.evaluation_previous_goal,
                    memory: history[history.length - 1].brain.memory,
                    nextGoal: history[history.length - 1].brain.next_goal,
                } : undefined,
            }))
        },
        onStatusChange: (status: string) => {
            chrome.runtime.sendMessage(createMessage({
                type: MESSAGE_TYPES.TASK_THINKING,
                status,
            } as any))
        },
        onDispose: function (reason?: string) {
            // When page is unloading, synchronously save history to background
            if (reason === 'PAGE_UNLOADING' && this.history && this.history.length > 0) {
                console.log('[PageAgent] Page unloading, saving history:', this.history.length, 'items')
                // Use sendMessage - Chrome will queue it even during unload
                chrome.runtime.sendMessage(createMessage({
                    type: MESSAGE_TYPES.TASK_HEARTBEAT,
                    payload: {
                        history: this.history,
                        status: 'navigating'
                    }
                } as any)).catch(() => {
                    // Ignore errors during unload
                })
            }
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

// Handle back/forward cache
window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        console.log('[PageAgent] Page restored from BFCache, re-checking status...')
        checkBackgroundStatus()
    }
})
