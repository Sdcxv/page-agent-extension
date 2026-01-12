/**
 * OpenAI Client implementation
 */
import type { MacroToolInput } from '../PageAgent'
import { InvokeError, InvokeErrorType } from './errors'
import type { InvokeResult, LLMClient, Message, OpenAIClientConfig, Tool } from './types'
import { lenientParseMacroToolCall, modelPatch, zodToOpenAITool } from './utils'

export class OpenAIClient implements LLMClient {
	config: OpenAIClientConfig

	constructor(config: OpenAIClientConfig) {
		this.config = config
	}

	async invoke(
		messages: Message[],
		tools: { AgentOutput: Tool<MacroToolInput> },
		abortSignal?: AbortSignal
	): Promise<InvokeResult> {
		// 1. Convert tools to OpenAI format
		const openaiTools = Object.entries(tools).map(([name, tool]) => zodToOpenAITool(name, tool))

		// 2. Call API
		const requestBody = modelPatch({
			model: this.config.model,
			temperature: this.config.temperature,
			max_tokens: this.config.maxTokens,
			messages,

			tools: openaiTools,
			tool_choice: 'required',

			// model specific params

			// reasoning_effort: 'minimal',
			// verbosity: 'low',
			parallel_tool_calls: false,
		})

		const url = `${this.config.baseURL}/chat/completions`
		const options = {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.config.apiKey}`,
			},
			body: JSON.stringify(requestBody),
		}

		let responseData: any
		let isOk: boolean
		let status: number
		let statusText: string

		// Use background proxy if in extension to bypass CSP
		const isExtension = typeof chrome !== 'undefined' && chrome.runtime?.sendMessage
		if (isExtension) {
			console.log('[OpenAILenientClient] Using background proxy for fetch')
			try {
				const proxyResult = await new Promise<any>((resolve, reject) => {
					chrome.runtime.sendMessage({
						type: 'PROXY_FETCH',
						payload: { url, options }
					}, (result) => {
						if (chrome.runtime.lastError) {
							reject(chrome.runtime.lastError)
						} else {
							resolve(result)
						}
					})
				})

				if (!proxyResult.ok && proxyResult.error) {
					throw new Error(proxyResult.error)
				}

				isOk = proxyResult.ok
				status = proxyResult.status
				statusText = proxyResult.statusText
				responseData = proxyResult.data
			} catch (error: any) {
				throw new InvokeError(InvokeErrorType.NETWORK_ERROR, `Proxy fetch failed: ${error.message}`, error)
			}
		} else {
			// Normal fetch
			let response: Response
			try {
				response = await fetch(url, options)
				isOk = response.ok
				status = response.status
				statusText = response.statusText
				responseData = await response.json().catch(() => ({}))
			} catch (error: unknown) {
				throw new InvokeError(InvokeErrorType.NETWORK_ERROR, 'Network request failed', error)
			}
		}

		// 3. Handle HTTP errors
		if (!isOk) {
			console.error('[OpenAILenientClient] API Error:', {
				status,
				statusText,
				responseData
			})
			const errorMessage = responseData?.error?.message || statusText

			if (status === 401 || status === 403) {
				throw new InvokeError(
					InvokeErrorType.AUTH_ERROR,
					`Authentication failed: ${errorMessage}`,
					responseData
				)
			}
			if (status === 429) {
				throw new InvokeError(
					InvokeErrorType.RATE_LIMIT,
					`Rate limit exceeded: ${errorMessage}`,
					responseData
				)
			}
			if (status >= 500) {
				throw new InvokeError(
					InvokeErrorType.SERVER_ERROR,
					`Server error: ${errorMessage}`,
					responseData
				)
			}
			throw new InvokeError(
				InvokeErrorType.UNKNOWN,
				`HTTP ${status}: ${errorMessage}`,
				responseData
			)
		}

		// parse response
		const data = responseData
		const tool = tools.AgentOutput
		const macroToolInput = lenientParseMacroToolCall(data, tool.inputSchema as any)

		// Execute tool
		let toolResult: unknown
		try {
			toolResult = await tool.execute(macroToolInput)
		} catch (e) {
			throw new InvokeError(
				InvokeErrorType.TOOL_EXECUTION_ERROR,
				`Tool execution failed: ${(e as Error).message}`,
				e
			)
		}

		// Return result (including cache tokens)
		return {
			toolCall: {
				// id: toolCall.id,
				name: 'AgentOutput',
				args: macroToolInput,
			},
			toolResult,
			usage: {
				promptTokens: data.usage?.prompt_tokens ?? 0,
				completionTokens: data.usage?.completion_tokens ?? 0,
				totalTokens: data.usage?.total_tokens ?? 0,
				cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens,
				reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
			},
			rawResponse: data,
		}
	}
}
