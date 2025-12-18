// Page Agent Popup Logic

import { MESSAGE_TYPES, createMessage, type ExecuteTaskMessage, type TaskProgressMessage, type TaskCompletedMessage } from '../lib/messages'
import { isUsingDefaultConfig } from '../lib/storage'

// DOM Elements
const elements = {
    // Header
    settingsBtn: document.getElementById('settingsBtn') as HTMLButtonElement,

    // Status
    statusBanner: document.getElementById('statusBanner') as HTMLDivElement,
    statusIcon: document.getElementById('statusIcon') as HTMLSpanElement,
    statusText: document.getElementById('statusText') as HTMLSpanElement,

    // Task
    taskInput: document.getElementById('taskInput') as HTMLTextAreaElement,
    executeBtn: document.getElementById('executeBtn') as HTMLButtonElement,
    stopBtn: document.getElementById('stopBtn') as HTMLButtonElement,

    // Progress
    progressSection: document.getElementById('progressSection') as HTMLDivElement,
    progressStep: document.getElementById('progressStep') as HTMLSpanElement,
    progressFill: document.getElementById('progressFill') as HTMLDivElement,
    pauseBtn: document.getElementById('pauseBtn') as HTMLButtonElement,
    nextGoal: document.getElementById('nextGoal') as HTMLSpanElement,

    // Result
    resultSection: document.getElementById('resultSection') as HTMLDivElement,
    resultIcon: document.getElementById('resultIcon') as HTMLSpanElement,
    resultTitle: document.getElementById('resultTitle') as HTMLSpanElement,
    resultContent: document.getElementById('resultContent') as HTMLDivElement,

    // Quick actions
    clearHistoryBtn: document.getElementById('clearHistoryBtn') as HTMLButtonElement,
    refreshBtn: document.getElementById('refreshBtn') as HTMLButtonElement,

    // Footer
    configStatus: document.getElementById('configStatus') as HTMLSpanElement,
    modeToggle: document.getElementById('modeToggle') as HTMLButtonElement,
}

let isRunning = false
let isPaused = false
let currentTabId: number | null = null

// Initialize
async function init() {
    await checkConfigStatus()
    await getCurrentTab()
    setupEventListeners()
    loadSavedTask()
    await queryBackgroundStatus()
}

// Query background for existing task on current tab
async function queryBackgroundStatus() {
    if (!currentTabId) return

    try {
        const response = await chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_STATUS,
            payload: { tabId: currentTabId }
        })

        if (response?.active && response.task) {
            console.log('[Popup] Resuming UI for active task:', response.task)
            isRunning = true
            elements.taskInput.value = response.task.task
            updateStatus('正在执行 (已恢复)...', 'running')
            showProgress()
            elements.executeBtn.classList.add('hidden')
            elements.stopBtn.classList.remove('hidden')

            // If we have history, show progress based on it
            if (response.task.history?.length > 0) {
                const history = response.task.history
                const lastStep = history[history.length - 1]
                updateProgress({
                    step: history.length,
                    maxSteps: 20,
                    brain: {
                        nextGoal: lastStep.brain?.next_goal || '继续执行...'
                    }
                } as any)
            }
        } else {
            console.log('[Popup] No active task for this tab')
            isRunning = false
            updateStatus('准备就绪', 'ready')
            hideProgress()
            elements.executeBtn.classList.remove('hidden')
            elements.stopBtn.classList.add('hidden')
        }
    } catch (err) {
        console.error('[Popup] Failed to query background status:', err)
    }
}

// Check if using default or custom config
async function checkConfigStatus() {
    const { getConfig } = await import('../lib/storage')
    const config = await getConfig()
    const isDefault = await isUsingDefaultConfig()

    if (isDefault) {
        elements.configStatus.textContent = '使用默认配置'
    } else {
        elements.configStatus.classList.add('custom')
        elements.configStatus.innerHTML = '<span class="config-dot"></span>自定义配置'
    }

    const mode = config.ui.interactionMode || 'debugger'
    const modeIcon = elements.modeToggle.querySelector('.mode-icon') as HTMLElement
    const modeText = elements.modeToggle.querySelector('.mode-text') as HTMLElement

    if (mode === 'debugger') {
        elements.modeToggle.className = 'mode-toggle debugger'
        modeIcon.textContent = '⚡'
        modeText.textContent = '增强模式'
        elements.modeToggle.title = '当前：增强模式 (利用 CDP 实现物理点击)'
    } else {
        elements.modeToggle.className = 'mode-toggle simulated'
        modeIcon.textContent = '🛡️'
        modeText.textContent = '兼容模式'
        elements.modeToggle.title = '当前：兼容模式 (传统模拟点击)'
    }
}

// Get current active tab
async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    currentTabId = tab?.id || null

    // Check if we can run on this tab
    if (tab?.url?.startsWith('chrome://') || tab?.url?.startsWith('chrome-extension://') || tab?.url?.includes('chrome.google.com/webstore')) {
        console.warn('[Popup] Restricted page detected:', tab.url)
        updateStatus('受限页面 (无法运行)', 'warning')
        elements.executeBtn.disabled = true
        elements.executeBtn.title = '此页面受浏览器安全限制，无法运行插件'
    } else {
        elements.executeBtn.disabled = false
        elements.executeBtn.title = ''
    }
}

// Setup event listeners
function setupEventListeners() {
    // Settings button
    elements.settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage()
    })

    // Execute button
    elements.executeBtn.addEventListener('click', executeTask)

    // Stop button
    elements.stopBtn.addEventListener('click', stopTask)

    // Pause button
    elements.pauseBtn.addEventListener('click', togglePause)

    // Clear history
    elements.clearHistoryBtn.addEventListener('click', clearHistory)

    // Refresh
    elements.refreshBtn.addEventListener('click', refreshStatus)

    // Enter key to execute
    elements.taskInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            executeTask()
        }
    })

    // Mode toggle
    elements.modeToggle.addEventListener('click', toggleInteractionMode)

    // Save task input on change
    elements.taskInput.addEventListener('input', () => {
        localStorage.setItem('lastTask', elements.taskInput.value)
    })

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener(handleMessage)
}

// Toggle interaction mode
async function toggleInteractionMode() {
    const { getConfig, saveConfig } = await import('../lib/storage')
    const config = await getConfig()
    const newMode = config.ui.interactionMode === 'debugger' ? 'simulated' : 'debugger'

    config.ui.interactionMode = newMode
    await saveConfig(config)
    await checkConfigStatus()

    // If a task is running, notify content script (optional, but good for UX)
    if (isRunning && currentTabId) {
        chrome.tabs.sendMessage(currentTabId, {
            type: MESSAGE_TYPES.CONFIG_UPDATED,
            payload: { interactionMode: newMode }
        }).catch(() => { })
    }
}

// Load saved task from localStorage
function loadSavedTask() {
    const savedTask = localStorage.getItem('lastTask')
    if (savedTask) {
        elements.taskInput.value = savedTask
    }
}

// Execute task
async function executeTask() {
    const task = elements.taskInput.value.trim()
    if (!task) {
        updateStatus('请输入任务指令', 'error')
        return
    }

    if (!currentTabId) {
        updateStatus('无法获取当前页面', 'error')
        return
    }

    try {
        // Check if current page is restricted
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        const url = tab?.url || ''
        if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.includes('chrome.google.com/webstore')) {
            throw new Error('Cannot run on this page')
        }

        // Check connectivity with a simple retry
        console.log('[Popup] Checking connectivity with tab:', currentTabId)
        let connected = false
        for (let i = 0; i < 3; i++) {
            try {
                const response = await chrome.tabs.sendMessage(currentTabId, { type: 'PING' })
                if (response?.pong) {
                    connected = true
                    break
                }
            } catch (e) {
                console.warn(`[Popup] Connectivity attempt ${i + 1} failed:`, e)
                if (i < 2) await new Promise(r => setTimeout(r, 300))
            }
        }

        if (!connected) {
            throw new Error('Could not establish connection')
        }

        // Send message to content script
        console.log('[Popup] Sending EXECUTE_TASK message to tab:', currentTabId)
        await chrome.tabs.sendMessage(currentTabId, createMessage<ExecuteTaskMessage>({
            type: MESSAGE_TYPES.EXECUTE_TASK,
            task,
        }))
        console.log('[Popup] EXECUTE_TASK message sent successfully')

        // Update UI
        isRunning = true
        updateStatus('正在执行...', 'running')
        showProgress()
        elements.executeBtn.classList.add('hidden')
        elements.stopBtn.classList.remove('hidden')
        elements.resultSection.classList.add('hidden')
    } catch (error: any) {
        console.error('Failed to execute task:', error)

        let errorMessage = error.message || '未知错误'

        // Handle specific BFCache error from Chrome
        if (errorMessage.includes('back/forward cache')) {
            console.log('[Popup] Suppressing BFCache error as content script should resume automatically')
            updateStatus('正在同步状态...', 'running')
            return
        }

        if (errorMessage.includes('Could not establish connection')) {
            errorMessage = '连接失败：请尝试刷新页面。如果页面正在加载，请稍候再试。'
        } else if (errorMessage.includes('Cannot run on this page')) {
            errorMessage = '该页面受浏览器安全限制（如 Chrome 设置页或商店），Agent 无法在此运行。请尝试其他普通网页。'
        }

        updateStatus('启动失败', 'error')

        // Show detailed error in result section
        elements.resultSection.classList.remove('hidden')
        elements.resultIcon.textContent = '⚠️'
        elements.resultTitle.textContent = '启动失败'
        elements.resultContent.innerHTML = `
            <p>${errorMessage}</p>
            <p style="margin-top: 8px; font-size: 0.9em; color: #666;">
                常见原因：<br>
                1. 页面尚未完全加载（请刷新或等待）<br>
                2. 页面是浏览器内部页面（无法注入脚本）<br>
                3. 扩展程序刚刚更新（需要刷新页面重连）
            </p>
        `
    }
}

// Stop task
async function stopTask() {
    if (!currentTabId) return

    try {
        await chrome.tabs.sendMessage(currentTabId, createMessage({
            type: MESSAGE_TYPES.STOP_TASK,
        }))

        isRunning = false
        updateStatus('已停止', 'error')
        hideProgress()
        elements.executeBtn.classList.remove('hidden')
        elements.stopBtn.classList.add('hidden')
    } catch (error) {
        console.error('Failed to stop task:', error)
    }
}

// Toggle pause
async function togglePause() {
    if (!currentTabId) return

    isPaused = !isPaused

    try {
        await chrome.tabs.sendMessage(currentTabId, createMessage({
            type: isPaused ? MESSAGE_TYPES.PAUSE_TASK : MESSAGE_TYPES.RESUME_TASK,
        }))

        elements.pauseBtn.textContent = isPaused ? '▶️' : '⏸️'
        updateStatus(isPaused ? '已暂停' : '继续执行...', isPaused ? 'warning' : 'running')
    } catch (error) {
        console.error('Failed to toggle pause:', error)
    }
}

// Handle messages from content script
function handleMessage(message: any) {
    switch (message.type) {
        case MESSAGE_TYPES.TASK_PROGRESS:
            ensureRunningState()
            updateProgress(message as TaskProgressMessage)
            break

        case MESSAGE_TYPES.TASK_COMPLETED:
            handleTaskCompleted(message as TaskCompletedMessage)
            break

        case MESSAGE_TYPES.TASK_ERROR:
            handleTaskError(message)
            break

        case (MESSAGE_TYPES as any).TASK_THINKING:
            ensureRunningState()
            updateStatus(message.status, 'running')
            break
    }
}

/**
 * Ensures the UI reflects a running state. 
 * Useful for recovering from transient "Start Failed" UI errors 
 * when the script is actually running.
 */
function ensureRunningState() {
    if (!isRunning) {
        isRunning = true
        showProgress()
        elements.executeBtn.classList.add('hidden')
        elements.stopBtn.classList.remove('hidden')
        elements.resultSection.classList.add('hidden')
    }
}

// Update progress
function updateProgress(message: TaskProgressMessage) {
    const progress = (message.step / message.maxSteps) * 100
    elements.progressStep.textContent = `步骤 ${message.step}/${message.maxSteps}`
    elements.progressFill.style.width = `${progress}%`

    if (message.brain?.nextGoal) {
        elements.nextGoal.textContent = message.brain.nextGoal
    }
}

// Handle task completed
function handleTaskCompleted(message: TaskCompletedMessage) {
    isRunning = false
    hideProgress()

    elements.resultSection.classList.remove('hidden')
    elements.resultIcon.textContent = message.success ? '✅' : '❌'
    elements.resultTitle.textContent = message.success ? '任务完成' : '任务失败'
    elements.resultContent.textContent = message.result

    updateStatus(message.success ? '执行成功' : '执行失败', message.success ? 'success' : 'error')
    elements.executeBtn.classList.remove('hidden')
    elements.stopBtn.classList.add('hidden')
}

// Handle task error
function handleTaskError(message: any) {
    isRunning = false
    hideProgress()

    updateStatus('执行出错', 'error')
    elements.resultSection.classList.remove('hidden')
    elements.resultIcon.textContent = '⚠️'
    elements.resultTitle.textContent = '执行错误'
    elements.resultContent.textContent = message.error || '未知错误'

    elements.executeBtn.classList.remove('hidden')
    elements.stopBtn.classList.add('hidden')
}

// Update status banner
function updateStatus(text: string, type: 'ready' | 'running' | 'success' | 'error' | 'warning' = 'ready') {
    elements.statusBanner.className = 'status-banner'
    if (type !== 'ready') {
        elements.statusBanner.classList.add(type)
    }

    const icons: Record<string, string> = {
        ready: '✨',
        running: '⏳',
        success: '✅',
        error: '❌',
        warning: '⚠️',
    }

    elements.statusIcon.textContent = icons[type]
    elements.statusText.textContent = text
}

// Show progress section
function showProgress() {
    elements.progressSection.classList.remove('hidden')
    elements.progressFill.style.width = '0%'
    elements.progressStep.textContent = '步骤 0/20'
    elements.nextGoal.textContent = '分析页面...'
}

// Hide progress section
function hideProgress() {
    elements.progressSection.classList.add('hidden')
}

// Clear history
function clearHistory() {
    localStorage.removeItem('lastTask')
    elements.taskInput.value = ''
    elements.resultSection.classList.add('hidden')
    updateStatus('已清除', 'success')
    setTimeout(() => updateStatus('准备就绪', 'ready'), 1500)
}

// Refresh status
async function refreshStatus() {
    await getCurrentTab()
    updateStatus('已刷新', 'success')
    setTimeout(() => updateStatus('准备就绪', 'ready'), 1500)
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init)
