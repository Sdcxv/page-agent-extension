import type { LLMConfig } from '../llms'
import type { PageControllerConfig } from '../../page-controller/PageController'
import type { SupportedLanguage } from '../../ui'

import type { AgentHistory, ExecutionResult, PageAgent } from '../PageAgent'
import type { PageAgentTool } from '../tools'

export type { LLMConfig }

export interface AgentConfig {
	// theme?: 'light' | 'dark'
	language?: SupportedLanguage

	/**
	 * Custom tools to extend PageAgent capabilities
	 * @experimental
	 * @note You can also override or remove internal tools by using the same name.
	 * @see [tools](../tools/index.ts)
	 *
	 * @example
	 * // override internal tool
	 * import { tool } from 'page-agent'
	 * const customTools = {
	 * ask_user: tool({
	 * 	description:
	 * 		'Ask the user or parent model a question and wait for their answer. Use this if you need more information or clarification.',
	 * 	inputSchema: zod.object({
	 * 		question: zod.string(),
	 * 	}),
	 * 	execute: async function (this: PageAgent, input) {
	 * 		const answer = await do_some_thing(input.question)
	 * 		return "✅ Received user answer: " + answer
	 * 	},
	 * })
	 * }
	 *
	 * @example
	 * // remove internal tool
	 * const customTools = {
	 * 	ask_user: null // never ask user questions
	 * }
	 */
	customTools?: Record<string, PageAgentTool | null>

	/**
	 * Instructions to guide the agent's behavior
	 */
	instructions?: {
		/**
		 * Global system-level instructions, applied to all tasks
		 */
		system?: string

		/**
		 * Dynamic page-level instructions callback
		 * Called before each step to get instructions for the current page
		 * @param url - Current page URL (window.location.href)
		 * @returns Instructions string, or undefined/null to skip
		 */
		getPageInstructions?: (url: string) => string | undefined | null
	}

	// lifecycle hooks
	// @todo: use event instead of hooks
	// @todo: remove `this` binding, pass agent as explicit parameter instead

	onBeforeStep?: (this: PageAgent, stepCnt: number) => Promise<void> | void
	onAfterStep?: (this: PageAgent, stepCnt: number, history: AgentHistory[]) => Promise<void> | void
	onBeforeTask?: (this: PageAgent) => Promise<void> | void
	onAfterTask?: (this: PageAgent, result: ExecutionResult) => Promise<void> | void

	/**
	 * @note this hook can block the disposal process
	 * @note when dispose caused by page unload, reason will be 'PAGE_UNLOADING'. this method CANNOT block unloading. async operations may be cut.
	 * @todo remove `this` binding, pass agent as explicit parameter instead
	 */
	onDispose?: (this: PageAgent, reason?: string) => void

	// page behavior hooks

	/**
	 * @experimental
	 * Enable the experimental script execution tool that allows executing generated JavaScript code on the page.
	 * @note Can cause unpredictable side effects.
	 * @note May bypass some safe guards and data-masking mechanisms.
	 */
	experimentalScriptExecutionTool?: boolean

	/**
	 * Transform page content before sending to LLM.
	 * Called after DOM extraction and simplification, before LLM invocation.
	 * Use cases: inspect extraction results, modify page info, mask sensitive data.
	 *
	 * @param content - Simplified page content that will be sent to LLM
	 * @returns Transformed content
	 *
	 * @example
	 * // Mask phone numbers
	 * transformPageContent: async (content) => {
	 *   return content.replace(/1[3-9]\d{9}/g, '***********')
	 * }
	 */
	transformPageContent?: (content: string) => Promise<string> | string

	/**
	 * TODO: @unimplemented
	 * hook when action causes a new page to be opened
	 * @note PageAgent will try to detect new pages and decide if it's caused by an action. But not very reliable.
	 * @todo remove `this` binding, pass agent as explicit parameter instead
	 */
	onNewPageOpen?: (this: PageAgent, url: string) => Promise<void> | void

	/**
	 * TODO: @unimplemented
	 * try to navigate to a new page instead of opening a new tab/window.
	 * @note will unload the current page when a action tries to open a new page. so that things keep in the same tab/window.
	 */
	experimentalPreventNewPage?: boolean

	// ======= Extension-specific configs =======

	/**
	 * Initial history to resume a task from a previous state.
	 * @extension-only
	 */
	initialHistory?: AgentHistory[]

	/**
	 * Callback to report status updates to the extension UI.
	 * @extension-only
	 */
	onStatusChange?: (this: PageAgent, status: string) => void
}

export type PageAgentConfig = LLMConfig & AgentConfig & PageControllerConfig
