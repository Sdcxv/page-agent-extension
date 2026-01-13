// Background Service Worker for Page Agent Extension

import { MESSAGE_TYPES, TaskStatus, type ExtensionMessage, createMessage } from '../lib/messages'
import { getConfig, isUsingDefaultConfig } from '../lib/storage'

// Keep track of active tabs running tasks
interface TaskState {
    taskId: string;
    startTime: number;
    task: string;
    history: any[];
    status: TaskStatus;  // 使用枚举类型
}

// Helper to handle task state persistence
const storage = {
    async getTasks(): Promise<Record<number, TaskState>> {
        const result = await chrome.storage.local.get('activeTasks')
        return result.activeTasks || {}
    },
    async setTask(tabId: number, state: TaskState) {
        const tasks = await this.getTasks()
        tasks[tabId] = state
        await chrome.storage.local.set({ activeTasks: tasks })
    },
    async removeTask(tabId: number) {
        const tasks = await this.getTasks()
        delete tasks[tabId]
        await chrome.storage.local.set({ activeTasks: tasks })
    },
    async getTask(tabId: number): Promise<TaskState | undefined> {
        const tasks = await this.getTasks()
        return tasks[tabId]
    }
}

// Logging System
interface LogEntry {
    timestamp: number;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    details?: any;
    source: string;
}

const logStorage = {
    async getLogs(): Promise<LogEntry[]> {
        const result = await chrome.storage.local.get('page_agent_logs')
        return result.page_agent_logs || []
    },
    async addLog(log: Omit<LogEntry, 'timestamp'>) {
        const logs = await this.getLogs()
        logs.push({ ...log, timestamp: Date.now() })
        // Keep only last 10000 logs (increased from 1000)
        const trimmed = logs.slice(-10000)
        await chrome.storage.local.set({ page_agent_logs: trimmed })
    },
    async clearLogs() {
        await chrome.storage.local.remove('page_agent_logs')
    }
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    console.log('[PageAgent BG] Received message:', message.type, 'from:', sender.tab ? `tab ${sender.tab.id}` : 'popup/options')
    handleMessage(message, sender, sendResponse)
    return true // Keep the message channel open for async response
})

// Check for task resumption when a tab is updated
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        const state = await storage.getTask(tabId);
        // 只有状态不是已完成/已失败/停止中才恢复
        const terminalStatuses: TaskStatus[] = [
            TaskStatus.COMPLETED,
            TaskStatus.FAILED,
            TaskStatus.STOPPING,
            TaskStatus.IDLE
        ];
        if (state && !terminalStatuses.includes(state.status)) {
            console.log('[PageAgent BG] Tab updated, resuming task:', tabId, 'status:', state.status);
            // Send resume message immediately when status is complete
            chrome.tabs.sendMessage(tabId, createMessage({
                type: MESSAGE_TYPES.EXECUTE_TASK,
                task: state.task,
                initialHistory: state.history
            } as any)).catch(err => {
                console.warn('[PageAgent BG] Immediate resume failed, might be too early:', err);
            });
        } else if (state) {
            // 任务已结束，清理状态
            console.log('[PageAgent BG] Task in terminal state, cleaning up:', tabId, 'status:', state.status);
            await storage.removeTask(tabId);
        }
    }
});

async function handleMessage(
    message: ExtensionMessage,
    sender: any, // chrome.runtime.MessageSender types are flaky in this env
    sendResponse: (response: any) => void
) {
    switch (message.type) {
        case MESSAGE_TYPES.GET_CONFIG:
            const config = await getConfig()
            const isDefault = await isUsingDefaultConfig()
            sendResponse({ config, isDefault })
            break

        case MESSAGE_TYPES.TASK_STARTED:
            if (sender.tab?.id) {
                const payload = (message as any).payload || {}
                const tabId = sender.tab.id
                const existing = await storage.getTask(tabId)

                // Only create new if not existing or different task
                if (!existing || existing.task !== payload.task) {
                    await storage.setTask(tabId, {
                        taskId: crypto.randomUUID(),
                        startTime: Date.now(),
                        task: payload.task || '',
                        history: [],
                        status: TaskStatus.STARTING
                    })
                } else {
                    console.log('[PageAgent BG] Task already known, skipping re-init:', payload.task)
                    existing.status = TaskStatus.EXECUTING
                    await storage.setTask(tabId, existing)
                }
            }
            break

        case MESSAGE_TYPES.TASK_HEARTBEAT:
            if (sender.tab?.id) {
                const tabId = sender.tab.id
                const state = await storage.getTask(tabId)
                if (state) {
                    const payload = (message as any).payload
                    state.history = payload.history || state.history
                    state.status = payload.status || state.status
                    await storage.setTask(tabId, state)
                }
            }
            break

        case MESSAGE_TYPES.TASK_PROGRESS:
            if (sender.tab?.id) {
                const tabId = sender.tab.id
                const state = await storage.getTask(tabId)
                if (state) {
                    const msg = message as any
                    if (msg.payload?.history) {
                        state.history = msg.payload.history
                        await storage.setTask(tabId, state)
                    }
                }
            }
            break

        case MESSAGE_TYPES.TASK_COMPLETED:
            if (sender.tab?.id) {
                const state = await storage.getTask(sender.tab.id)
                if (state) {
                    state.status = TaskStatus.COMPLETED
                    await storage.setTask(sender.tab.id, state)
                }
                // 延迟清理，给其他组件时间读取最终状态
                setTimeout(async () => {
                    await storage.removeTask(sender.tab!.id!)
                }, 1000)
            }
            break

        case MESSAGE_TYPES.TASK_ERROR:
            if (sender.tab?.id) {
                const state = await storage.getTask(sender.tab.id)
                if (state) {
                    state.status = TaskStatus.FAILED
                    await storage.setTask(sender.tab.id, state)
                }
                // 延迟清理
                setTimeout(async () => {
                    await storage.removeTask(sender.tab!.id!)
                }, 1000)
            }
            break

        case MESSAGE_TYPES.TASK_STOPPED:
            // 任务已确认停止，清理状态
            if (sender.tab?.id) {
                console.log('[PageAgent BG] Task stopped confirmed, cleaning up:', sender.tab.id)
                await storage.removeTask(sender.tab.id)
            }
            sendResponse({ success: true })
            break

        case MESSAGE_TYPES.STOP_TASK:
            // 处理来自 popup 的停止请求
            const stopTabId = (message as any).payload?.tabId
            if (stopTabId) {
                const state = await storage.getTask(stopTabId)
                if (state) {
                    state.status = TaskStatus.STOPPING
                    await storage.setTask(stopTabId, state)
                    // 向 content script 发送停止命令
                    try {
                        await chrome.tabs.sendMessage(stopTabId, createMessage({
                            type: MESSAGE_TYPES.STOP_TASK
                        }))
                    } catch (e) {
                        // content script 不可达，直接清理
                        console.log('[PageAgent BG] Content script unreachable, cleaning up directly')
                        await storage.removeTask(stopTabId)
                    }
                }
            }
            sendResponse({ success: true })
            break

        case MESSAGE_TYPES.GET_STATUS:
            const targetTabId = (message as any).payload?.tabId || sender.tab?.id
            if (targetTabId) {
                const state = await storage.getTask(targetTabId)
                if (state) {
                    sendResponse({ active: true, task: state })
                } else {
                    sendResponse({ active: false })
                }
            } else {
                sendResponse({ active: false })
            }
            break

        case MESSAGE_TYPES.PROXY_FETCH:
            const { url, options: fetchOptions } = (message as any).payload
            try {
                const response = await fetch(url, fetchOptions)
                const contentType = response.headers.get('content-type')
                let data: any

                if (contentType && contentType.includes('application/json')) {
                    data = await response.json()
                } else {
                    data = await response.text()
                }

                await logStorage.addLog({
                    level: response.ok ? 'info' : 'error',
                    source: 'proxy',
                    message: `LLM Call: ${url}`,
                    details: {
                        status: response.status,
                        success: response.ok,
                        // Avoid logging sensitive API keys, but model info is fine
                        model: JSON.parse(fetchOptions.body || '{}').model
                    }
                })

                sendResponse({
                    ok: response.ok,
                    status: response.status,
                    statusText: response.statusText,
                    data
                })
            } catch (error: any) {
                console.error('[PageAgent BG] Proxy fetch failed:', error)
                await logStorage.addLog({
                    level: 'error',
                    source: 'proxy',
                    message: `LLM Call Failed: ${url}`,
                    details: { error: error.message }
                })
                sendResponse({
                    ok: false,
                    error: error.message || 'Fetch failed'
                })
            }
            break

        case MESSAGE_TYPES.LOG_EVENT:
            const logPayload = (message as any).payload
            await logStorage.addLog({
                level: logPayload.level || 'info',
                source: logPayload.source || 'content',
                message: logPayload.message,
                details: logPayload.details
            })
            break

        case MESSAGE_TYPES.GET_LOGS:
            const logs = await logStorage.getLogs()
            sendResponse({ logs })
            break

        case MESSAGE_TYPES.CLEAR_LOGS:
            await logStorage.clearLogs()
            sendResponse({ success: true })
            break

        case MESSAGE_TYPES.DEBUGGER_CLICK:
            console.log('[PageAgent BG] Received DEBUGGER_CLICK from tab:', sender.tab?.id, 'payload:', (message as any).payload)
            if (sender.tab?.id) {
                const { x, y } = (message as any).payload
                await performDebuggerClick(sender.tab.id, x, y)
                sendResponse({ success: true })
            } else {
                console.error('[PageAgent BG] DEBUGGER_CLICK: No tab id in sender')
                sendResponse({ success: false, error: 'No tab id' })
            }
            break

        case MESSAGE_TYPES.DEBUGGER_TYPE:
            if (sender.tab?.id) {
                const { text } = (message as any).payload
                await performDebuggerType(sender.tab.id, text)
                sendResponse({ success: true })
            }
            break

        case MESSAGE_TYPES.DEBUGGER_PRESS_KEY:
            if (sender.tab?.id) {
                const { key } = (message as any).payload
                await performDebuggerPressKey(sender.tab.id, key)
                sendResponse({ success: true })
            }
            break

        default:
            console.log('[PageAgent BG] Unknown message type:', message.type)
    }
}

async function performDebuggerClick(tabId: number, x: number, y: number) {
    const target = { tabId };
    try {
        try {
            await chrome.debugger.attach(target, '1.3');
        } catch (e: any) {
            if (!e.message.includes('Already attached')) throw e;
        }

        const coords = { x: Math.round(x), y: Math.round(y) };
        console.log(`[PageAgent BG] Debugger clicking at:`, coords);

        // Movement often triggers hover effects required for clicks
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            ...coords
        });

        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mousePressed',
            ...coords,
            button: 'left',
            clickCount: 1
        });

        // Small human-like delay
        await new Promise(r => setTimeout(r, 50));

        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            ...coords,
            button: 'left',
            clickCount: 1
        });

        await chrome.debugger.detach(target);
    } catch (error) {
        console.error('[PageAgent BG] Debugger click error:', error);
        try { await chrome.debugger.detach(target); } catch (e) { }
    }
}

async function performDebuggerType(tabId: number, text: string) {
    const target = { tabId };
    try {
        try {
            await chrome.debugger.attach(target, '1.3');
        } catch (e: any) {
            if (!e.message.includes('Already attached')) throw e;
        }

        console.log(`[PageAgent BG] Debugger typing: "${text}"`);

        for (const char of text) {
            await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
                type: 'keyDown',
                text: char,
                unmodifiedText: char,
            });
            await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
                type: 'keyUp',
                text: char,
                unmodifiedText: char,
            });
            // Small delay between keys as in human typing
            await new Promise(r => setTimeout(r, 20));
        }

        await chrome.debugger.detach(target);
    } catch (error) {
        console.error('[PageAgent BG] Debugger type error:', error);
        try { await chrome.debugger.detach(target); } catch (e) { }
    }
}

async function performDebuggerPressKey(tabId: number, key: string) {
    const target = { tabId };
    try {
        try {
            await chrome.debugger.attach(target, '1.3');
        } catch (e: any) {
            if (!e.message.includes('Already attached')) throw e;
        }

        console.log(`[PageAgent BG] Debugger pressing key: "${key}"`);

        const keyDefinition = getKeyDefinition(key);

        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyDown',
            ...keyDefinition
        });

        await new Promise(r => setTimeout(r, 50));

        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            ...keyDefinition
        });

        await chrome.debugger.detach(target);
    } catch (error) {
        console.error('[PageAgent BG] Debugger press key error:', error);
        try { await chrome.debugger.detach(target); } catch (e) { }
    }
}

function getKeyDefinition(key: string): any {
    switch (key.toLowerCase()) {
        case 'enter':
            return {
                windowsVirtualKeyCode: 13,
                nativeVirtualKeyCode: 13,
                macCharCode: 13,
                unmodifiedText: '\r',
                text: '\r',
                key: 'Enter',
                code: 'Enter'
            };
        case 'backspace':
            return {
                windowsVirtualKeyCode: 8,
                nativeVirtualKeyCode: 8,
                macCharCode: 8,
                unmodifiedText: '\u0008',
                text: '\u0008',
                key: 'Backspace',
                code: 'Backspace'
            };
        case 'tab':
            return {
                windowsVirtualKeyCode: 9,
                nativeVirtualKeyCode: 9,
                macCharCode: 9,
                unmodifiedText: '\t',
                text: '\t',
                key: 'Tab',
                code: 'Tab'
            };
        case 'escape':
            return {
                windowsVirtualKeyCode: 27,
                nativeVirtualKeyCode: 27,
                macCharCode: 27,
                key: 'Escape',
                code: 'Escape'
            };
        // Add more keys as needed
        default:
            // Fallback for single characters
            if (key.length === 1) {
                return {
                    text: key,
                    unmodifiedText: key,
                    key: key,
                    code: `Key${key.toUpperCase()}`
                }
            }
            return { text: key };
    }
}

// Listen for tab removal to clean up
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await storage.removeTask(tabId)
})

// Listen for extension installation
// Listen for extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
    // Always clear active tasks on reload/update to prevent zombie states
    // This addresses the issue where tasks appear "still running" after extension reload
    await chrome.storage.local.remove('activeTasks')
    console.log('[PageAgent] Cleared active tasks due to extension event:', details.reason)

    if (details.reason === 'install') {
        console.log('[PageAgent] Extension installed')
        // Open options page on first install
        chrome.runtime.openOptionsPage()
    } else if (details.reason === 'update') {
        console.log('[PageAgent] Extension updated to version', chrome.runtime.getManifest().version)
    }
})

// Handle keyboard shortcuts
chrome.commands?.onCommand.addListener(async (command) => {
    if (command === 'activate-agent') {
        // Open popup or activate agent
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.id) {
            await chrome.action.openPopup()
        }
    }
})

console.log('[PageAgent] Background service worker started')
