/**
 * OpenAI Client implementation
 * @note This client is only for demonstrating how to implement a LLM client.
 * @note Use OpenAILenientClient instead.
 */
import { InvokeError, InvokeErrorType } from './errors'
import type { InvokeOptions, InvokeResult, LLMClient, LLMConfig, Message, Tool } from './types'
import { modelPatch, zodToOpenAITool } from './utils'

/**
 * @deprecated Use OpenAILenientClient instead.
 */
export class OpenAIClient implements LLMClient {
	config: LLMConfig

	constructor(config: LLMConfig) {
		this.config = config
	}

	async invoke(
		messages: Message[],
		tools: Record<string, Tool>,
		abortSignal?: AbortSignal,
		options?: InvokeOptions
	): Promise<InvokeResult> {
		// 1. Convert tools to OpenAI format
		const openaiTools = Object.entries(tools).map(([name, tool]) => zodToOpenAITool(name, tool))

		// 2. Prepare request options
		const url = `${this.config.baseURL}/chat/completions`
		const body = JSON.stringify(
			modelPatch({
				model: this.config.model,
				temperature: this.config.temperature,
				messages,

				tools: openaiTools,
				// Require tool call: specific tool if provided, otherwise any tool
				tool_choice: options?.toolChoiceName
					? { type: 'function', function: { name: options.toolChoiceName } }
					: 'required',

				// model specific params

				// reasoning_effort: 'minimal',
				// verbosity: 'low',
				parallel_tool_calls: false,
			})
		)
		const headers = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${this.config.apiKey}`,
		}

		// 3. Call API via Proxy (Background Script) to avoid CORS/CSP issues
		let proxyResponse: any
		try {
			const { MESSAGE_TYPES } = await import('../../messages')

			proxyResponse = await chrome.runtime.sendMessage({
				type: MESSAGE_TYPES.PROXY_FETCH,
				payload: {
					url,
					options: {
						method: 'POST',
						headers,
						body
					}
				}
			})
		} catch (error: unknown) {
			const errorMessage = (error as Error)?.message || String(error)

			// Handle implementation updates causing context invalidation
			if (errorMessage.includes('Extension context invalidated')) {
				throw new InvokeError(
					InvokeErrorType.NETWORK_ERROR,
					'Extension updated/reloaded. Please refresh the page to reconnect.',
					error
				)
			}

			// Network error or extension messaging error
			throw new InvokeError(InvokeErrorType.NETWORK_ERROR, 'Network request failed (Proxy)', error)
		}

		// 4. Handle HTTP errors from Proxy Response
		if (!proxyResponse || !proxyResponse.ok) {
			const errorData = proxyResponse?.data
			const errorMessage = proxyResponse?.error || errorData?.error?.message || proxyResponse?.statusText || 'Unknown error'
			const status = proxyResponse?.status || 0

			if (status === 401 || status === 403) {
				throw new InvokeError(
					InvokeErrorType.AUTH_ERROR,
					`Authentication failed: ${errorMessage}`,
					errorData
				)
			}
			if (status === 429) {
				throw new InvokeError(
					InvokeErrorType.RATE_LIMIT,
					`Rate limit exceeded: ${errorMessage}`,
					errorData
				)
			}
			if (status >= 500) {
				throw new InvokeError(
					InvokeErrorType.SERVER_ERROR,
					`Server error: ${errorMessage}`,
					errorData
				)
			}
			throw new InvokeError(
				InvokeErrorType.UNKNOWN,
				`HTTP ${status}: ${errorMessage}`,
				errorData
			)
		}

		const data = proxyResponse.data

		// 4. Check finish_reason
		const choice = data.choices?.[0]
		if (!choice) {
			throw new InvokeError(InvokeErrorType.UNKNOWN, 'No choices in response', data)
		}

		switch (choice.finish_reason) {
			case 'tool_calls':
			case 'function_call': // gemini
			case 'stop': // some models use this even with tool calls
				// ✅ Normal - will try to parse
				break
			case 'length':
				// ⚠️ Token limit reached
				throw new InvokeError(
					InvokeErrorType.CONTEXT_LENGTH,
					'Response truncated: max tokens reached',
					data
				)
			case 'content_filter':
				// ❌ Content filtered
				throw new InvokeError(
					InvokeErrorType.CONTENT_FILTER,
					'Content filtered by safety system',
					data
				)
			default:
				throw new InvokeError(
					InvokeErrorType.UNKNOWN,
					`Unexpected finish_reason: ${choice.finish_reason}`,
					data
				)
		}

		// Apply normalizeResponse if provided (for fixing format issues automatically)
		const normalizedData = options?.normalizeResponse ? options.normalizeResponse(data) : data
		const normalizedChoice = normalizedData.choices?.[0]


		// 5. Parse tool call
		const toolCall = normalizedChoice.message?.tool_calls?.[0]
		if (!toolCall) {
			throw new InvokeError(InvokeErrorType.NO_TOOL_CALL, 'No tool call found in response', data)
		}

		const toolName = toolCall.function.name
		const tool = tools[toolName]
		if (!tool) {
			throw new InvokeError(InvokeErrorType.UNKNOWN, `Tool ${toolName} not found`, data)
		}

		// 6. Parse and validate arguments
		let toolArgs: unknown
		try {
			toolArgs = JSON.parse(toolCall.function.arguments)
		} catch (e) {
			throw new InvokeError(InvokeErrorType.INVALID_TOOL_ARGS, 'Invalid JSON in tool arguments', e)
		}

		// Validate against zod schema
		const validation = tool.inputSchema.safeParse(toolArgs)
		if (!validation.success) {
			throw new InvokeError(
				InvokeErrorType.INVALID_TOOL_ARGS,
				`Tool arguments validation failed: ${validation.error.message}`,
				validation.error
			)
		}

		// 7. Execute tool
		let toolResult: unknown
		try {
			toolResult = await tool.execute(validation.data)
		} catch (e) {
			throw new InvokeError(
				InvokeErrorType.TOOL_EXECUTION_ERROR,
				`Tool execution failed: ${(e as Error).message}`,
				e
			)
		}

		// 8. Return result (including cache tokens)
		return {
			toolCall: {
				// id: toolCall.id,
				name: toolName,
				args: validation.data as Record<string, unknown>,
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
