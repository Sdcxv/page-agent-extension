import { type Step, UIState } from './UIState'
import { I18n, type SupportedLanguage } from './i18n'
import { truncate } from './utils'

import styles from './Panel.module.css'

/**
 * Panel configuration
 */
export interface PanelConfig {
	language?: SupportedLanguage
	onExecuteTask: (task: string) => void
	onStop: () => void
	onPauseToggle: () => boolean // returns new paused state
	getPaused: () => boolean
}

/**
 * Semantic update types - Panel handles i18n internally
 */
export type PanelUpdate =
	| { type: 'thinking'; text?: string } // text is optional, defaults to i18n thinking text
	| { type: 'input'; task: string }
	| { type: 'question'; question: string }
	| { type: 'userAnswer'; input: string }
	| { type: 'retry'; current: number; max: number }
	| { type: 'error'; message: string }
	| { type: 'output'; text: string }
	| { type: 'completed' }
	| { type: 'toolExecuting'; toolName: string; args: any }
	| { type: 'toolCompleted'; toolName: string; args: any; result?: string; duration?: number }

/**
 * Agent control panel
 */
export class Panel {
	#wrapper: HTMLElement
	#indicator: HTMLElement
	#statusText: HTMLElement
	#historySection: HTMLElement
	#expandButton: HTMLElement
	#pauseButton: HTMLElement
	#stopButton: HTMLElement
	#inputSection: HTMLElement
	#taskInput: HTMLInputElement

	#state = new UIState()
	#isExpanded = false
	#config: PanelConfig
	#i18n: I18n
	#userAnswerResolver: ((input: string) => void) | null = null
	#isWaitingForUserAnswer: boolean = false
	#headerUpdateTimer: ReturnType<typeof setInterval> | null = null
	#pendingHeaderText: string | null = null
	#isAnimating = false
	#disposed = false

	get wrapper(): HTMLElement {
		return this.#wrapper
	}

	constructor(config: PanelConfig) {
		this.#config = config
		this.#i18n = new I18n(config.language ?? 'en-US')
		this.#wrapper = this.#createWrapper()
		this.#indicator = this.#wrapper.querySelector(`.${styles.indicator}`)!
		this.#statusText = this.#wrapper.querySelector(`.${styles.statusText}`)!
		this.#historySection = this.#wrapper.querySelector(`.${styles.historySection}`)!
		this.#expandButton = this.#wrapper.querySelector(`.${styles.expandButton}`)!
		this.#pauseButton = this.#wrapper.querySelector(`.${styles.pauseButton}`)!
		this.#stopButton = this.#wrapper.querySelector(`.${styles.stopButton}`)!
		this.#inputSection = this.#wrapper.querySelector(`.${styles.inputSectionWrapper}`)!
		this.#taskInput = this.#wrapper.querySelector(`.${styles.taskInput}`)!

		this.#setupEventListeners()
		this.#startHeaderUpdateLoop()

		this.#showInputArea()

		// Append to body if available, otherwise documentElement
		this.#safeAppend(this.#wrapper)
	}

	#safeAppend(element: HTMLElement) {
		const tryAppend = () => {
			const target = document.body || document.documentElement
			if (target) {
				target.appendChild(element)
				return true
			}
			return false
		}

		if (!tryAppend()) {
			const observer = new MutationObserver(() => {
				if (tryAppend()) observer.disconnect()
			})
			observer.observe(document, { childList: true, subtree: true })
		}
	}

	/**
	 * Ask for user input
	 */
	async askUser(question: string): Promise<string> {
		return new Promise((resolve) => {
			// Set `waiting for user answer` state
			this.#isWaitingForUserAnswer = true
			this.#userAnswerResolver = resolve

			// Update state to `running`
			this.#updateInternal({
				type: 'output',
				displayText: this.#i18n.t('ui.panel.question', { question }),
			}) // Expand history panel
			if (!this.#isExpanded) {
				this.#expand()
			}

			this.#showInputArea(this.#i18n.t('ui.panel.userAnswerPrompt'))
		})
	}

	// ========== Public control methods ==========

	show(): void {
		if (this.#disposed) return
		this.wrapper.style.display = 'block'
		void this.wrapper.offsetHeight
		this.wrapper.style.opacity = '1'
		this.wrapper.style.transform = 'translateX(-50%) translateY(0)'
	}

	hide(): void {
		if (this.#disposed) return
		this.wrapper.style.opacity = '0'
		this.wrapper.style.transform = 'translateX(-50%) translateY(20px)'
		this.wrapper.style.display = 'none'
	}

	reset(): void {
		if (this.#disposed) return
		this.#state.reset()
		this.#statusText.textContent = this.#i18n.t('ui.panel.ready')
		this.#updateStatusIndicator('thinking')
		this.#updateHistory()
		this.#collapse()
		// Reset pause state via callback
		if (this.#config.getPaused()) {
			this.#config.onPauseToggle()
		}
		this.#updatePauseButton()
		// Reset user input state
		this.#isWaitingForUserAnswer = false
		this.#userAnswerResolver = null
		// Show input area
		this.#showInputArea()
	}

	expand(): void {
		this.#expand()
	}

	collapse(): void {
		this.#collapse()
	}

	/**
	 * Restore panel state from history (used for navigation resumption)
	 */
	restore(history: any[], task: string): void {
		if (this.#disposed) return
		// Reset first
		this.reset()

		// Set initial task
		this.update({ type: 'input', task })

		// Replay history items into the UI state
		for (const record of history) {
			if (record.action) {
				this.update({
					type: 'toolCompleted',
					toolName: record.action.name,
					args: record.action.input,
					result: record.action.output
				})
			}
		}

		// Ensure it stays expanded to show history if there is any
		if (history.length > 0) {
			this.#expand()
		}
	}

	/**
	 * Update panel with semantic data - i18n handled internally
	 */
	update(data: PanelUpdate): void {
		const stepData = this.#toStepData(data)
		this.#updateInternal(stepData)
	}

	/**
	 * Dispose panel
	 */
	dispose(): void {
		this.#disposed = true
		this.#isWaitingForUserAnswer = false
		this.#stopHeaderUpdateLoop()
		this.wrapper.remove()
	}

	// ========== Private methods ==========

	/**
	 * Convert semantic update to step data with i18n
	 */
	#toStepData(data: PanelUpdate): Omit<Step, 'id' | 'stepNumber' | 'timestamp'> {
		switch (data.type) {
			case 'thinking':
				return { type: 'thinking', displayText: data.text ?? this.#i18n.t('ui.panel.thinking') }
			case 'input':
				return { type: 'input', displayText: data.task }
			case 'question':
				return {
					type: 'output',
					displayText: this.#i18n.t('ui.panel.question', { question: data.question }),
				}
			case 'userAnswer':
				return {
					type: 'input',
					displayText: this.#i18n.t('ui.panel.userAnswer', { input: data.input }),
				}
			case 'retry':
				return { type: 'retry', displayText: `retry-ing (${data.current} / ${data.max})` }
			case 'error':
				return { type: 'error', displayText: data.message }
			case 'output':
				return { type: 'output', displayText: data.text }
			case 'completed':
				return { type: 'completed', displayText: this.#i18n.t('ui.panel.taskCompleted') }
			case 'toolExecuting':
				return {
					type: 'tool_executing',
					toolName: data.toolName,
					toolArgs: data.args,
					displayText: this.#getToolExecutingText(data.toolName, data.args),
				}
			case 'toolCompleted': {
				const displayText = this.#getToolCompletedText(data.toolName, data.args)
				if (!displayText) return { type: 'tool_executing', displayText: '' } // will be filtered
				return {
					type: 'tool_executing',
					toolName: data.toolName,
					toolArgs: data.args,
					toolResult: data.result,
					displayText,
					duration: data.duration,
				}
			}
		}
	}

	#getToolExecutingText(toolName: string, args: any): string {
		switch (toolName) {
			case 'click_element_by_index':
				return this.#i18n.t('ui.tools.clicking', { index: args.index })
			case 'input_text':
				return this.#i18n.t('ui.tools.inputting', { index: args.index })
			case 'select_dropdown_option':
				return this.#i18n.t('ui.tools.selecting', { text: args.text })
			case 'scroll':
				return this.#i18n.t('ui.tools.scrolling')
			case 'wait':
				return this.#i18n.t('ui.tools.waiting', { seconds: args.seconds })
			case 'done':
				return this.#i18n.t('ui.tools.done')
			default:
				return this.#i18n.t('ui.tools.executing', { toolName })
		}
	}

	#getToolCompletedText(toolName: string, args: any): string | null {
		switch (toolName) {
			case 'click_element_by_index':
				return this.#i18n.t('ui.tools.clicked', { index: args.index })
			case 'input_text':
				return this.#i18n.t('ui.tools.inputted', { text: args.text })
			case 'select_dropdown_option':
				return this.#i18n.t('ui.tools.selected', { text: args.text })
			case 'scroll':
				return this.#i18n.t('ui.tools.scrolled')
			case 'wait':
				return this.#i18n.t('ui.tools.waited')
			case 'done':
				return null
			default:
				return null
		}
	}

	/**
	 * Update status (internal)
	 */
	#updateInternal(stepData: Omit<Step, 'id' | 'stepNumber' | 'timestamp'>): void {
		if (this.#disposed) return
		// Skip empty displayText (filtered toolCompleted for 'done')
		if (!stepData.displayText) return

		const step = this.#state.addStep(stepData)

		// Queue header text update (will be processed by periodic check)
		const headerText = truncate(step.displayText, 20)
		this.#pendingHeaderText = headerText

		this.#updateStatusIndicator(step.type)
		this.#updateHistory()

		// Auto-expand history after task completion
		if (step.type === 'completed' || step.type === 'error') {
			if (!this.#isExpanded) {
				this.#expand()
			}
		}

		// Control input area display based on status
		if (this.#shouldShowInputArea()) {
			this.#showInputArea()
		} else {
			this.#hideInputArea()
		}
	}

	/**
	 * Toggle pause state
	 */
	#togglePause(): void {
		const paused = this.#config.onPauseToggle()
		this.#updatePauseButton()

		// Update status display
		if (paused) {
			this.#statusText.textContent = this.#i18n.t('ui.panel.paused')
			this.#updateStatusIndicator('thinking')
		} else {
			this.#statusText.textContent = this.#i18n.t('ui.panel.continueExecution')
			this.#updateStatusIndicator('tool_executing')
		}
	}

	/**
	 * Update pause button state
	 */
	#updatePauseButton(): void {
		const paused = this.#config.getPaused()
		if (paused) {
			this.#pauseButton.textContent = '▶'
			this.#pauseButton.title = this.#i18n.t('ui.panel.continue')
			this.#pauseButton.classList.add(styles.paused)
		} else {
			this.#pauseButton.textContent = '⏸︎'
			this.#pauseButton.title = this.#i18n.t('ui.panel.pause')
			this.#pauseButton.classList.remove(styles.paused)
		}
	}

	/**
	 * Stop Agent
	 */
	#stopAgent(): void {
		// Update status display
		this.#updateInternal({
			type: 'error',
			displayText: this.#i18n.t('ui.panel.taskTerminated'),
		})

		this.#config.onStop()
	}

	/**
	 * Submit task
	 */
	#submitTask() {
		const input = this.#taskInput.value.trim()
		if (!input) return

		// Hide input area
		this.#hideInputArea()

		if (this.#isWaitingForUserAnswer) {
			// Handle user input mode
			this.#handleUserAnswer(input)
		} else {
			this.#config.onExecuteTask(input)
		}
	}

	/**
	 * Handle user answer
	 */
	#handleUserAnswer(input: string): void {
		// Add user input to history
		this.#updateInternal({
			type: 'input',
			displayText: this.#i18n.t('ui.panel.userAnswer', { input }),
		})

		// Reset state
		this.#isWaitingForUserAnswer = false

		// Call resolver to return user input
		if (this.#userAnswerResolver) {
			this.#userAnswerResolver(input)
			this.#userAnswerResolver = null
		}
	}

	/**
	 * Show input area
	 */
	#showInputArea(placeholder?: string): void {
		// Clear input field
		this.#taskInput.value = ''
		this.#taskInput.placeholder = placeholder || this.#i18n.t('ui.panel.taskInput')
		this.#inputSection.classList.remove(styles.hidden)
		// Focus on input field
		setTimeout(() => {
			this.#taskInput.focus()
		}, 100)
	}

	/**
	 * Hide input area
	 */
	#hideInputArea(): void {
		this.#inputSection.classList.add(styles.hidden)
	}

	/**
	 * Check if input area should be shown
	 */
	#shouldShowInputArea(): boolean {
		// Always show input area if waiting for user input
		if (this.#isWaitingForUserAnswer) return true

		const steps = this.#state.getAllSteps()
		if (steps.length === 0) {
			return true // Initial state
		}

		const lastStep = steps[steps.length - 1]
		return lastStep.type === 'completed' || lastStep.type === 'error'
	}

	#createWrapper(): HTMLElement {
		const wrapper = document.createElement('div')
		wrapper.id = 'page-agent-runtime_agent-panel'
		wrapper.className = `${styles.wrapper} ${styles.collapsed}`
		wrapper.setAttribute('data-browser-use-ignore', 'true')

		wrapper.innerHTML = `
			<div class="${styles.background}"></div>
			<div class="${styles.historySectionWrapper}">
				<div class="${styles.historySection}">
					${this.#createHistoryItem({
			id: 'placeholder',
			stepNumber: 0,
			timestamp: new Date(),
			type: 'thinking',
			displayText: this.#i18n.t('ui.panel.waitingPlaceholder'),
		})}
				</div>
			</div>
			<div class="${styles.header}">
				<div class="${styles.statusSection}">
					<div class="${styles.indicator} ${styles.thinking}"></div>
					<div class="${styles.statusText}">${this.#i18n.t('ui.panel.ready')}</div>
				</div>
				<div class="${styles.controls}">
					<button class="${styles.controlButton} ${styles.expandButton}" title="${this.#i18n.t('ui.panel.expand')}">
						▼
					</button>
					<button class="${styles.controlButton} ${styles.pauseButton}" title="${this.#i18n.t('ui.panel.pause')}">
						⏸︎
					</button>
					<button class="${styles.controlButton} ${styles.stopButton}" title="${this.#i18n.t('ui.panel.stop')}">
						X
					</button>
				</div>
			</div>
			<div class="${styles.inputSectionWrapper} ${styles.hidden}">
				<div class="${styles.inputSection}">
					<input 
						type="text" 
						class="${styles.taskInput}" 
						maxlength="200"
					/>
				</div>
			</div>
		`

		document.body.appendChild(wrapper)
		return wrapper
	}

	#setupEventListeners(): void {
		// Click header area to expand/collapse
		const header = this.wrapper.querySelector(`.${styles.header}`)!
		header.addEventListener('click', (e) => {
			// Don't trigger expand/collapse if clicking on buttons
			if ((e.target as HTMLElement).closest(`.${styles.controlButton}`)) {
				return
			}
			this.#toggle()
		})

		// Expand button
		this.#expandButton.addEventListener('click', (e) => {
			e.stopPropagation()
			this.#toggle()
		})

		// Pause/continue button
		this.#pauseButton.addEventListener('click', (e) => {
			e.stopPropagation()
			this.#togglePause()
		})

		// Stop button
		this.#stopButton.addEventListener('click', (e) => {
			e.stopPropagation()
			this.#stopAgent()
		})

		// Submit on Enter key in input field
		this.#taskInput.addEventListener('keydown', (e) => {
			if (e.isComposing) return // Ignore IME composition keys
			if (e.key === 'Enter') {
				e.preventDefault()
				this.#submitTask()
			}
		})

		// Prevent input area click event bubbling
		this.#inputSection.addEventListener('click', (e) => {
			e.stopPropagation()
		})
	}

	#toggle(): void {
		if (this.#isExpanded) {
			this.#collapse()
		} else {
			this.#expand()
		}
	}

	#expand(): void {
		this.#isExpanded = true
		this.wrapper.classList.remove(styles.collapsed)
		this.wrapper.classList.add(styles.expanded)
		this.#expandButton.textContent = '▲'
	}

	#collapse(): void {
		this.#isExpanded = false
		this.wrapper.classList.remove(styles.expanded)
		this.wrapper.classList.add(styles.collapsed)
		this.#expandButton.textContent = '▼'
	}

	/**
	 * Start periodic header update loop
	 */
	#startHeaderUpdateLoop(): void {
		// Check every 450ms (same as total animation duration)
		this.#headerUpdateTimer = setInterval(() => {
			this.#checkAndUpdateHeader()
		}, 450)
	}

	/**
	 * Stop periodic header update loop
	 */
	#stopHeaderUpdateLoop(): void {
		if (this.#headerUpdateTimer) {
			clearInterval(this.#headerUpdateTimer)
			this.#headerUpdateTimer = null
		}
	}

	/**
	 * Check if header needs update and trigger animation if not currently animating
	 */
	#checkAndUpdateHeader(): void {
		// If no pending text or currently animating, skip
		if (!this.#pendingHeaderText || this.#isAnimating) {
			return
		}

		// If text is already displayed, clear pending and skip
		if (this.#statusText.textContent === this.#pendingHeaderText) {
			this.#pendingHeaderText = null
			return
		}

		// Start animation
		const textToShow = this.#pendingHeaderText
		this.#pendingHeaderText = null
		this.#animateTextChange(textToShow)
	}

	/**
	 * Animate text change with fade out/in effect
	 */
	#animateTextChange(newText: string): void {
		this.#isAnimating = true

		// Fade out current text
		this.#statusText.classList.add(styles.fadeOut)

		setTimeout(() => {
			if (this.#disposed) return
			// Update text content
			this.#statusText.textContent = newText

			// Fade in new text
			this.#statusText.classList.remove(styles.fadeOut)
			this.#statusText.classList.add(styles.fadeIn)

			setTimeout(() => {
				if (this.#disposed) return
				this.#statusText.classList.remove(styles.fadeIn)
				this.#isAnimating = false
			}, 300)
		}, 150) // Half the duration of fade out animation
	}

	#updateStatusIndicator(type: Step['type']): void {
		// Clear all status classes
		this.#indicator.className = styles.indicator

		// Add corresponding status class
		this.#indicator.classList.add(styles[type])
	}

	#updateHistory(): void {
		const steps = this.#state.getAllSteps()

		this.#historySection.innerHTML = steps.map((step) => this.#createHistoryItem(step)).join('')

		// Scroll to bottom to show latest records
		this.#scrollToBottom()
	}

	#scrollToBottom(): void {
		// Execute in next event loop to ensure DOM update completion
		setTimeout(() => {
			if (this.#disposed) return
			this.#historySection.scrollTop = this.#historySection.scrollHeight
		}, 0)
	}

	#createHistoryItem(step: Step): string {
		const time = step.timestamp.toLocaleTimeString('zh-CN', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		})

		let typeClass = ''
		let statusIcon = ''

		// Set styles and icons based on step type
		if (step.type === 'completed') {
			// Check if this is a result from done tool
			if (step.toolName === 'done') {
				// Judge success or failure based on result
				const failureKeyword = this.#i18n.t('ui.tools.resultFailure')
				const errorKeyword = this.#i18n.t('ui.tools.resultError')
				const isSuccess =
					!step.toolResult ||
					(!step.toolResult.includes(failureKeyword) && !step.toolResult.includes(errorKeyword))
				typeClass = isSuccess ? styles.doneSuccess : styles.doneError
				statusIcon = isSuccess ? '🎉' : '❌'
			} else {
				typeClass = styles.completed
				statusIcon = '✅'
			}
		} else if (step.type === 'error') {
			typeClass = styles.error
			statusIcon = '❌'
		} else if (step.type === 'tool_executing') {
			statusIcon = '⚙️'
		} else if (step.type === 'output') {
			typeClass = styles.output
			statusIcon = '🤖'
		} else if (step.type === 'input') {
			typeClass = styles.input
			statusIcon = '🎯'
		} else if (step.type === 'retry') {
			typeClass = styles.retry
			statusIcon = '🔄'
		} else {
			statusIcon = '🧠'
		}

		const durationText = step.duration ? ` · ${step.duration}ms` : ''
		const stepLabel = this.#i18n.t('ui.panel.step', {
			number: step.stepNumber.toString(),
			time,
			duration: durationText || '', // Explicitly pass empty string to replace template
		})

		return `
			<div class="${styles.historyItem} ${typeClass}">
				<div class="${styles.historyContent}">
					<span class="${styles.statusIcon}">${statusIcon}</span>
					<span>${step.displayText}</span>
				</div>
				<div class="${styles.historyMeta}">
					${stepLabel}
				</div>
			</div>
		`
	}
}
