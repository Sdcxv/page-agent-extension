// Background Service Worker for Page Agent Extension

import { MESSAGE_TYPES, type ExtensionMessage, createMessage } from '../lib/messages'
import { getConfig, isUsingDefaultConfig } from '../lib/storage'

// Keep track of active tabs running tasks
interface TaskState {
    taskId: string;
    startTime: number;
    task: string;
    history: any[];
    status: string;
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
        // Keep only last 1000 logs
        const trimmed = logs.slice(-1000)
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
        if (state) {
            console.log('[PageAgent BG] Tab updated, instantly resuming task:', tabId);
            // Send resume message immediately when status is complete
            chrome.tabs.sendMessage(tabId, createMessage({
                type: MESSAGE_TYPES.EXECUTE_TASK,
                task: state.task,
                initialHistory: state.history
            } as any)).catch(err => {
                console.warn('[PageAgent BG] Immediate resume failed, might be too early:', err);
            });
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
                        status: 'started'
                    })
                } else {
                    console.log('[PageAgent BG] Task already known, skipping re-init:', payload.task)
                    existing.status = 'resumed'
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
        case MESSAGE_TYPES.TASK_ERROR:
            if (sender.tab?.id) {
                await storage.removeTask(sender.tab.id)
            }
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
            if (sender.tab?.id) {
                const { x, y } = (message as any).payload
                await performDebuggerClick(sender.tab.id, x, y)
                sendResponse({ success: true })
            }
            break

        case MESSAGE_TYPES.DEBUGGER_TYPE:
            if (sender.tab?.id) {
                const { text } = (message as any).payload
                await performDebuggerType(sender.tab.id, text)
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

// Listen for tab removal to clean up
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await storage.removeTask(tabId)
})

// Listen for extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
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
