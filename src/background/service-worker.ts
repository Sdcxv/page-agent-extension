// Background Service Worker for Page Agent Extension

import { MESSAGE_TYPES, type ExtensionMessage, createMessage } from '../lib/messages'
import { getConfig, isUsingDefaultConfig } from '../lib/storage'

// Keep track of active tabs running tasks
const activeTasks = new Map<number, { taskId: string; startTime: number }>()

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    console.log('[PageAgent BG] Received message:', message.type, 'from:', sender.tab ? `tab ${sender.tab.id}` : 'popup/options')
    handleMessage(message, sender, sendResponse)
    return true // Keep the message channel open for async response
})

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
                activeTasks.set(sender.tab.id, {
                    taskId: crypto.randomUUID(),
                    startTime: Date.now(),
                })
            }
            break

        case MESSAGE_TYPES.TASK_COMPLETED:
        case MESSAGE_TYPES.TASK_ERROR:
            if (sender.tab?.id) {
                activeTasks.delete(sender.tab.id)
            }
            break

        case MESSAGE_TYPES.GET_STATUS:
            const tabId = sender.tab?.id
            if (tabId && activeTasks.has(tabId)) {
                sendResponse({ active: true, task: activeTasks.get(tabId) })
            } else {
                sendResponse({ active: false })
            }
            break

        default:
            console.log('[PageAgent BG] Unknown message type:', message.type)
    }
}

// Listen for tab removal to clean up
chrome.tabs.onRemoved.addListener((tabId) => {
    if (activeTasks.has(tabId)) {
        activeTasks.delete(tabId)
    }
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
