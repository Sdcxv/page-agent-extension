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
}

// Check if using default or custom config
async function checkConfigStatus() {
    const isDefault = await isUsingDefaultConfig()
    if (isDefault) {
        elements.configStatus.textContent = '使用默认配置'
    } else {
        elements.configStatus.classList.add('custom')
        elements.configStatus.innerHTML = '<span class="config-dot"></span>自定义配置'
    }
}

// Get current active tab
async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    currentTabId = tab?.id || null

    // Check if we can run on this tab
    if (tab?.url?.startsWith('chrome://') || tab?.url?.startsWith('chrome-extension://') || tab?.url?.includes('chrome.google.com/webstore')) {
        console.warn('[Popup] Restricted page detected:', tab.url)
        // We might want to show a warning in the UI
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

    // Save task input on change
    elements.taskInput.addEventListener('input', () => {
        localStorage.setItem('lastTask', elements.taskInput.value)
    })

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener(handleMessage)
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
        // Check connectivity first
        console.log('[Popup] Checking connectivity with tab:', currentTabId)
        try {
            const pong = await chrome.tabs.sendMessage(currentTabId, { type: 'PING' })
            console.log('[Popup] Received PING response:', pong)
        } catch (e) {
            console.error('[Popup] Connectivity check failed:', e)
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
        if (errorMessage.includes('Could not establish connection')) {
            errorMessage = '连接失败：请刷新页面后重试'
        } else if (errorMessage.includes('Cannot run on this page')) {
            errorMessage = '无法在该页面运行：请尝试其他网页'
        }

        updateStatus('执行失败', 'error')

        // Show detailed error in result section
        elements.resultSection.classList.remove('hidden')
        elements.resultIcon.textContent = '❌'
        elements.resultTitle.textContent = '启动失败'
        elements.resultContent.innerHTML = `
            <p>${errorMessage}</p>
            <p style="margin-top: 8px; font-size: 0.9em; color: #666;">
                建议：<br>
                1. 刷新当前网页<br>
                2. 确保页面已加载完成<br>
                3. 检查是否在受支持的网页上运行
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
            updateProgress(message as TaskProgressMessage)
            break

        case MESSAGE_TYPES.TASK_COMPLETED:
            handleTaskCompleted(message as TaskCompletedMessage)
            break

        case MESSAGE_TYPES.TASK_ERROR:
            handleTaskError(message)
            break
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
