/**
 * Internal tools for PageAgent.
 * @note Adapted from browser-use
 */
import zod, { type z } from 'zod'

import type { PageAgent } from '../PageAgent'
import { waitFor } from '../utils'

/**
 * Internal tool definition that has access to PageAgent `this` context
 */
export interface PageAgentTool<TParams = any> {
	// name: string
	description: string
	inputSchema: z.ZodType<TParams>
	execute: (this: PageAgent, args: TParams) => Promise<string>
}

export function tool<TParams>(options: PageAgentTool<TParams>): PageAgentTool<TParams> {
	return options
}

/**
 * Internal tools for PageAgent.
 * Note: Using any to allow different parameter types for each tool
 */
export const tools = new Map<string, PageAgentTool>()

tools.set(
	'done',
	tool({
		description: '完成任务。success=true表示成功，text填写结果摘要。',
		inputSchema: zod.object({
			text: zod.string(),
			success: zod.boolean().default(true),
		}),
		execute: async function (this: PageAgent, input) {
			// @note main loop will handle this one
			// this.onDone(input.text, input.success)
			return Promise.resolve('Task completed')
		},
	})
)

tools.set(
	'wait',
	tool({
		description: '等待页面加载，默认1秒，最多10秒。仅在页面未加载完时使用。',
		inputSchema: zod.object({
			seconds: zod.number().min(1).max(10).default(1),
		}),
		execute: async function (this: PageAgent, input) {
			const lastTimeUpdate = await this.pageController.getLastUpdateTime()
			const actualWaitTime = Math.max(0, input.seconds - (Date.now() - lastTimeUpdate) / 1000)
			console.log(`actualWaitTime: ${actualWaitTime} seconds`)
			await waitFor(actualWaitTime)
			return `✅ Waited for ${input.seconds} seconds.`
		},
	})
)

tools.set(
	'ask_user',
	tool({
		description: '向用户提问并等待回答。需要更多信息时使用。',
		inputSchema: zod.object({
			question: zod.string(),
		}),
		execute: async function (this: PageAgent, input) {
			const answer = await this.panel.askUser(input.question)
			return `✅ Received user answer: ${answer}`
		},
	})
)

tools.set(
	'click_element_by_index',
	tool({
		description: '点击指定索引的元素',
		inputSchema: zod.object({
			index: zod.number().int().min(0),
		}),
		execute: async function (this: PageAgent, input) {
			const result = await this.pageController.clickElement(input.index)
			return result.message
		},
	})
)

tools.set(
	'input_text',
	tool({
		description: '在输入框中输入文本（先点击再输入）',
		inputSchema: zod.object({
			index: zod.number().int().min(0),
			text: zod.string(),
		}),
		execute: async function (this: PageAgent, input) {
			const result = await this.pageController.inputText(input.index, input.text)
			return result.message
		},
	})
)

tools.set(
	'select_dropdown_option',
	tool({
		description: '选择下拉菜单选项，text为选项文本',
		inputSchema: zod.object({
			index: zod.number().int().min(0),
			text: zod.string(),
		}),
		execute: async function (this: PageAgent, input) {
			const result = await this.pageController.selectOption(input.index, input.text)
			return result.message
		},
	})
)

/**
 * @note Reference from browser-use
 */
tools.set(
	'scroll',
	tool({
		description: '滚动页面。down=true向下，num_pages=页数(0.5半页)，index可指定元素内滚动',
		inputSchema: zod.object({
			down: zod.boolean().default(true),
			num_pages: zod.number().min(0).max(10).optional().default(0.1),
			pixels: zod.number().int().min(0).optional(),
			index: zod.number().int().min(0).optional(),
		}),
		execute: async function (this: PageAgent, input) {
			const result = await this.pageController.scroll({
				down: input.down ?? true,
				numPages: input.num_pages ?? 0.1,
				pixels: input.pixels,
				index: input.index,
			})
			return result.message
		},
	})
)

tools.set(
	'scroll_horizontally',
	tool({
		description: '水平滚动。right=true向右，pixels=像素数',
		inputSchema: zod.object({
			right: zod.boolean().default(true),
			pixels: zod.number().int().min(0),
			index: zod.number().int().min(0).optional(),
		}),
		execute: async function (this: PageAgent, input) {
			const result = await this.pageController.scrollHorizontally({
				right: input.right ?? true,
				pixels: input.pixels,
				index: input.index,
			})
			return result.message
		},
	})
)

tools.set(
	'execute_javascript',
	tool({
		description: '执行JavaScript代码（谨慎使用）',
		inputSchema: zod.object({
			script: zod.string(),
		}),
		execute: async function (this: PageAgent, input) {
			const result = await this.pageController.executeJavascript(input.script)
			return result.message
		},
	})
)

tools.set(
	'press_keys',
	tool({
		description: '按键盘按键，如Enter、Backspace、Tab、Escape等',
		inputSchema: zod.object({
			keys: zod.array(zod.string()).min(1),
		}),
		execute: async function (this: PageAgent, input) {
			const result = await this.pageController.pressKeys(input.keys)
			return result.message
		},
	})
)

// @todo get_dropdown_options
// @todo select_dropdown_option
// @todo send_keys
// @todo upload_file
// @todo go_back
// @todo extract_structured_data
