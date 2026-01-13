/**
 * Utility functions for LLM integration
 */
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

import { InvokeError, InvokeErrorType } from './errors'
import type { MacroToolInput, Tool } from './types'

/**
 * Convert Zod schema to OpenAI tool format
 */
export function zodToOpenAITool(name: string, tool: Tool) {
	return {
		type: 'function' as const,
		function: {
			name,
			description: tool.description,
			parameters: zodToJsonSchema(tool.inputSchema, { target: 'openApi3' }),
		},
	}
}

/**
 * Although some models cannot guarantee correct response. Common issues are fixable:
 * - Instead of returning a proper tool call. Return the tool call parameters in the message content.
 * - Returned tool calls or messages don't follow the nested MacroToolInput format.
 */
export function lenientParseMacroToolCall(
	responseData: any,
	inputSchema: z.ZodObject<MacroToolInput & Record<string, any>>
): MacroToolInput {
	// check
	const choice = responseData.choices?.[0]
	if (!choice) {
		throw new InvokeError(InvokeErrorType.UNKNOWN, 'No choices in response', responseData)
	}

	// check
	switch (choice.finish_reason) {
		case 'tool_calls':
		case 'function_call': // gemini
		case 'stop': // will try a robust parse
			// ✅ Normal
			break
		case 'length':
			// ⚠️ Token limit reached
			throw new InvokeError(
				InvokeErrorType.CONTEXT_LENGTH,
				'Response truncated: max tokens reached'
			)
		case 'content_filter':
			// ❌ Content filtered
			throw new InvokeError(InvokeErrorType.CONTENT_FILTER, 'Content filtered by safety system')
		default:
			throw new InvokeError(
				InvokeErrorType.UNKNOWN,
				`Unexpected finish_reason: ${choice.finish_reason}`
			)
	}

	// Extract action schema from MacroToolInput schema
	const actionSchema = inputSchema.shape.action
	if (!actionSchema) {
		throw new Error('inputSchema must have an "action" field')
	}

	// patch stopReason mis-format

	let arg: string | null = null

	// try to use tool call
	const toolCall = choice.message?.tool_calls?.[0]?.function
	arg = toolCall?.arguments ?? null

	if (arg && toolCall.name !== 'AgentOutput') {
		// TODO: check if toolCall.name is a valid action name
		// case: instead of AgentOutput, the model returned a action name as tool call
		console.log('lenientParseMacroToolCall: #1 fixing incorrect tool call')
		let tmpArg
		try {
			tmpArg = JSON.parse(arg)
		} catch (error) {
			throw new InvokeError(
				InvokeErrorType.INVALID_TOOL_ARGS,
				'Failed to parse tool arguments as JSON',
				error
			)
		}
		arg = JSON.stringify({ action: { [toolCall.name]: tmpArg } })
	}

	if (!arg) {
		// try to use message content as JSON
		arg = choice.message?.content.trim() || null
	}

	if (!arg) {
		throw new InvokeError(
			InvokeErrorType.NO_TOOL_CALL,
			'No tool call or content found in response',
			responseData
		)
	}

	// make sure is valid JSON

	let parsedArgs: any
	try {
		parsedArgs = JSON.parse(arg)
	} catch (error) {
		throw new InvokeError(
			InvokeErrorType.INVALID_TOOL_ARGS,
			'Failed to parse tool arguments as JSON',
			error
		)
	}

	// patch incomplete formats

	if (parsedArgs.action || parsedArgs.evaluation_previous_goal || parsedArgs.next_goal) {
		// case: nested MacroToolInput format (correct format)

		// some models may give a empty action (they may think reasoning and action should be separate)
		if (!parsedArgs.action) {
			console.log('lenientParseMacroToolCall: #2 fixing incorrect tool call')
			parsedArgs.action = {
				wait: { seconds: 1 },
			}
		}
	} else if (parsedArgs.type && parsedArgs.function) {
		// case: upper level function call format provided. only keep its arguments
		// TODO: check if function name is a valid action name
		if (parsedArgs.function.name !== 'AgentOutput')
			throw new InvokeError(
				InvokeErrorType.INVALID_TOOL_ARGS,
				`Expected function name "AgentOutput", got "${parsedArgs.function.name}"`,
				null
			)

		console.log('lenientParseMacroToolCall: #3 fixing incorrect tool call')
		parsedArgs = parsedArgs.function.arguments
	} else if (parsedArgs.name && parsedArgs.arguments) {
		// case: upper level function call format provided. only keep its arguments
		// TODO: check if function name is a valid action name
		if (parsedArgs.name !== 'AgentOutput')
			throw new InvokeError(
				InvokeErrorType.INVALID_TOOL_ARGS,
				`Expected function name "AgentOutput", got "${parsedArgs.name}"`,
				null
			)

		console.log('lenientParseMacroToolCall: #4 fixing incorrect tool call')
		parsedArgs = parsedArgs.arguments
	} else {
		// case: only action parameters provided, wrap into MacroToolInput
		// TODO: check if action name is valid
		console.log('lenientParseMacroToolCall: #5 fixing incorrect tool call')
		parsedArgs = { action: parsedArgs } as MacroToolInput
	}

	// make sure it's not wrapped as string
	if (typeof parsedArgs === 'string') {
		console.log('lenientParseMacroToolCall: #6 fixing incorrect tool call')
		try {
			parsedArgs = JSON.parse(parsedArgs)
		} catch (error) {
			throw new InvokeError(
				InvokeErrorType.INVALID_TOOL_ARGS,
				'Failed to parse nested tool arguments as JSON',
				error
			)
		}
	}

	const validation = inputSchema.safeParse(parsedArgs)
	if (validation.success) {
		return validation.data as unknown as MacroToolInput
	} else {
		const action = parsedArgs.action ?? {}
		const actionName = Object.keys(action)[0] || 'unknown'
		const actionArgs = JSON.stringify(action[actionName] || 'unknown')

		// TODO: check if action name is valid. give a readable error message

		throw new InvokeError(
			InvokeErrorType.INVALID_TOOL_ARGS,
			`Tool arguments validation failed: action "${actionName}" with args ${actionArgs}`,
			validation.error
		)
	}
}

export function modelPatch(body: Record<string, any>) {
	const model: string = body.model || ''
	const modelName = normalizeModelName(model)

	// 1. Qwen 模型优化
	if (modelName.startsWith('qwen')) {
		console.log('Applying Qwen patch: use higher temperature for auto fixing')
		body.temperature = Math.max(body.temperature || 0, 1.0)
	}

	// 2. Anthropic models
	if (modelName.startsWith('claude')) {
		console.log('Applying Claude patch: disable thinking')
		body.thinking = { type: 'disabled' }

		// Convert tool_choice to Claude format
		if (body.tool_choice === 'required') {
			body.tool_choice = { type: 'any' }
		} else if (body.tool_choice?.function?.name) {
			body.tool_choice = { type: 'tool', name: body.tool_choice.function.name }
		}
		return body
	}

	// 3. Grok models
	if (modelName.includes('grok')) {
		console.log('Applying Grok patch: removing tool_choice')
		delete body.tool_choice
		body.thinking = { type: 'disabled', effort: 'minimal' }
		body.reasoning = { enabled: false, effort: 'low' }
		return body
	}

	// 4. Reasoning models (DeepSeek R1, OpenAI O-series) - No Tool Support on many providers
	if (
		modelName.includes('reasoner') ||
		modelName.includes('r1') ||
		modelName.includes('o1-') ||
		modelName.includes('o3-') ||
		(modelName.startsWith('o1') && !modelName.includes('mini'))
	) {
		console.log('Applying reasoning model patch: disabling tools and tool_choice')
		delete body.tools
		delete body.tool_choice
		return body
	}

	// 5. GPT models
	if (modelName.startsWith('gpt')) {
		console.log('Applying GPT patch: set verbosity to low')
		body.verbosity = 'low'

		if (modelName.startsWith('gpt52')) {
			body.reasoning_effort = 'none'
		} else if (modelName.startsWith('gpt51')) {
			body.reasoning_effort = 'none'
		} else if (modelName.startsWith('gpt5')) {
			body.reasoning_effort = 'low'
		}
		return body
	}

	// 6. Gemini models
	if (modelName.startsWith('gemini')) {
		console.log('Applying Gemini patch: set reasoning effort to minimal')
		body.reasoning_effort = 'minimal'
	}

	// 7. OpenRouter / Other providers - Common providers that prefer 'required' string
	if (
		model.includes('/') || // OpenRouter format
		modelName.includes('deepseek') ||
		modelName.includes('llama') ||
		modelName.includes('mistral') ||
		modelName.includes('mixtral')
	) {
		// Specific fix for OpenRouter providers that don't support tool_choice at all
		if (model.includes(':free') || model.includes('xiaomi/') || model.includes('hf/')) {
			console.log(`Applying specific patch for ${model}: removing tool_choice to avoid 404`)
			delete body.tool_choice
		} else {
			console.log(`Applying generic patch for model ${model}: setting tool_choice to 'required'`)
			body.tool_choice = 'required'
		}
	}

	return body
}

/**
 * Normalize model name for consistent matching
 * 
 * Different model providers may use different model IDs for the same model.
 * For example, openai's `gpt-5.2` may called:
 *   - `gpt-5.2-version`
 *   - `gpt-5_2-date`
 *   - `GPT-52-version-date`
 *   - `openai/gpt-5.2-chat`
 *
 * They should be treated as the same model. Normalize them to `gpt52`
 */
function normalizeModelName(modelName: string): string {
	let normalizedName = modelName.toLowerCase()

	// remove prefix before '/'
	if (normalizedName.includes('/')) {
		normalizedName = normalizedName.split('/')[1]
	}

	// remove '_'
	normalizedName = normalizedName.replace(/_/g, '')

	// remove '.'
	normalizedName = normalizedName.replace(/\./g, '')

	return normalizedName
}

