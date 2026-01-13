/**
 * 统一错误处理系统
 * 为 PageAgent 提供结构化的错误类型和用户友好的错误消息
 */

/**
 * 错误代码枚举
 */
export enum AgentErrorCode {
    // 网络相关
    NETWORK_ERROR = 'NETWORK_ERROR',
    TIMEOUT = 'TIMEOUT',

    // LLM 相关
    LLM_API_ERROR = 'LLM_API_ERROR',
    LLM_INVALID_RESPONSE = 'LLM_INVALID_RESPONSE',
    LLM_RATE_LIMIT = 'LLM_RATE_LIMIT',
    LLM_AUTH_ERROR = 'LLM_AUTH_ERROR',
    LLM_MODEL_NOT_FOUND = 'LLM_MODEL_NOT_FOUND',

    // 工具执行相关
    TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
    TOOL_EXECUTION_ERROR = 'TOOL_EXECUTION_ERROR',
    TOOL_TIMEOUT = 'TOOL_TIMEOUT',

    // 配置相关
    CONFIG_INVALID = 'CONFIG_INVALID',
    CONFIG_MISSING = 'CONFIG_MISSING',

    // 任务相关
    TASK_ABORTED = 'TASK_ABORTED',
    TASK_MAX_STEPS = 'TASK_MAX_STEPS',

    // 页面相关
    PAGE_NOT_READY = 'PAGE_NOT_READY',
    ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND',

    // 通用
    UNKNOWN = 'UNKNOWN',
}

/**
 * 错误恢复建议
 */
const ERROR_RECOVERY_SUGGESTIONS: Record<AgentErrorCode, string> = {
    [AgentErrorCode.NETWORK_ERROR]: '请检查网络连接，然后重试',
    [AgentErrorCode.TIMEOUT]: '请求超时，请稍后重试',
    [AgentErrorCode.LLM_API_ERROR]: '请检查 API 服务状态，或尝试更换模型',
    [AgentErrorCode.LLM_INVALID_RESPONSE]: 'AI 返回了无效响应，请重试或更换模型',
    [AgentErrorCode.LLM_RATE_LIMIT]: 'API 请求频率超限，请稍后重试',
    [AgentErrorCode.LLM_AUTH_ERROR]: 'API Key 无效或已过期，请在设置中更新',
    [AgentErrorCode.LLM_MODEL_NOT_FOUND]: '指定的模型不存在，请在设置中选择有效模型',
    [AgentErrorCode.TOOL_NOT_FOUND]: '内部错误：工具未找到，请刷新页面重试',
    [AgentErrorCode.TOOL_EXECUTION_ERROR]: '操作执行失败，可能是页面结构变化，请重试',
    [AgentErrorCode.TOOL_TIMEOUT]: '操作超时，页面可能响应缓慢，请重试',
    [AgentErrorCode.CONFIG_INVALID]: '配置无效，请检查设置页面',
    [AgentErrorCode.CONFIG_MISSING]: '缺少必要配置，请先完成设置',
    [AgentErrorCode.TASK_ABORTED]: '任务已被用户中止',
    [AgentErrorCode.TASK_MAX_STEPS]: '任务步骤超过上限，请简化任务描述',
    [AgentErrorCode.PAGE_NOT_READY]: '页面尚未加载完成，请稍候',
    [AgentErrorCode.ELEMENT_NOT_FOUND]: '未找到目标元素，页面可能已发生变化',
    [AgentErrorCode.UNKNOWN]: '发生未知错误，请查看日志获取详情',
}

/**
 * 用户友好的错误消息
 */
const USER_FRIENDLY_MESSAGES: Record<AgentErrorCode, string> = {
    [AgentErrorCode.NETWORK_ERROR]: '网络连接失败',
    [AgentErrorCode.TIMEOUT]: '请求超时',
    [AgentErrorCode.LLM_API_ERROR]: 'AI 服务暂时不可用',
    [AgentErrorCode.LLM_INVALID_RESPONSE]: 'AI 响应解析失败',
    [AgentErrorCode.LLM_RATE_LIMIT]: 'AI 服务请求过于频繁',
    [AgentErrorCode.LLM_AUTH_ERROR]: 'API 认证失败',
    [AgentErrorCode.LLM_MODEL_NOT_FOUND]: '模型不存在',
    [AgentErrorCode.TOOL_NOT_FOUND]: '工具未找到',
    [AgentErrorCode.TOOL_EXECUTION_ERROR]: '操作执行失败',
    [AgentErrorCode.TOOL_TIMEOUT]: '操作超时',
    [AgentErrorCode.CONFIG_INVALID]: '配置无效',
    [AgentErrorCode.CONFIG_MISSING]: '配置缺失',
    [AgentErrorCode.TASK_ABORTED]: '任务已中止',
    [AgentErrorCode.TASK_MAX_STEPS]: '任务步骤超限',
    [AgentErrorCode.PAGE_NOT_READY]: '页面未就绪',
    [AgentErrorCode.ELEMENT_NOT_FOUND]: '元素未找到',
    [AgentErrorCode.UNKNOWN]: '未知错误',
}

/**
 * 统一的 Agent 错误类
 */
export class AgentError extends Error {
    /** 错误代码 */
    code: AgentErrorCode
    /** 原始错误 */
    cause?: Error
    /** 是否可恢复 */
    recoverable: boolean
    /** 恢复建议 */
    recoverySuggestion: string
    /** 用户友好的消息 */
    userMessage: string
    /** 额外的上下文信息 */
    context?: Record<string, any>

    constructor(
        code: AgentErrorCode,
        message?: string,
        options?: {
            cause?: Error
            recoverable?: boolean
            context?: Record<string, any>
        }
    ) {
        const userMessage = USER_FRIENDLY_MESSAGES[code] || message || '未知错误'
        super(message || userMessage)

        this.name = 'AgentError'
        this.code = code
        this.cause = options?.cause
        this.recoverable = options?.recoverable ?? true
        this.recoverySuggestion = ERROR_RECOVERY_SUGGESTIONS[code] || '请重试'
        this.userMessage = userMessage
        this.context = options?.context

        // 保留原始堆栈
        if (options?.cause?.stack) {
            this.stack = `${this.stack}\nCaused by: ${options.cause.stack}`
        }
    }

    /**
     * 转换为日志友好的对象
     */
    toLogObject() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            userMessage: this.userMessage,
            recoverySuggestion: this.recoverySuggestion,
            recoverable: this.recoverable,
            context: this.context,
            stack: this.stack,
            causeStack: this.cause?.stack,
        }
    }

    /**
     * 从普通错误创建 AgentError
     */
    static fromError(error: Error, context?: Record<string, any>): AgentError {
        // 如果已经是 AgentError，直接返回
        if (error instanceof AgentError) {
            if (context) {
                error.context = { ...error.context, ...context }
            }
            return error
        }

        // 根据错误消息推断错误类型
        const code = inferErrorCode(error)
        return new AgentError(code, error.message, {
            cause: error,
            context,
        })
    }
}

/**
 * 根据错误消息推断错误代码
 */
function inferErrorCode(error: Error): AgentErrorCode {
    const message = error.message.toLowerCase()

    // 网络相关
    if (message.includes('network') || message.includes('fetch')) {
        return AgentErrorCode.NETWORK_ERROR
    }
    if (message.includes('timeout') || message.includes('timed out')) {
        return AgentErrorCode.TIMEOUT
    }

    // LLM 相关
    if (message.includes('401') || message.includes('unauthorized') || message.includes('invalid api key')) {
        return AgentErrorCode.LLM_AUTH_ERROR
    }
    if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
        return AgentErrorCode.LLM_RATE_LIMIT
    }
    if (message.includes('404') || message.includes('model not found') || message.includes('does not exist')) {
        return AgentErrorCode.LLM_MODEL_NOT_FOUND
    }
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('internal server')) {
        return AgentErrorCode.LLM_API_ERROR
    }

    // 任务相关
    if (message.includes('abort')) {
        return AgentErrorCode.TASK_ABORTED
    }
    if (message.includes('max') && message.includes('step')) {
        return AgentErrorCode.TASK_MAX_STEPS
    }

    // 元素相关
    if (message.includes('element') && (message.includes('not found') || message.includes('not exist'))) {
        return AgentErrorCode.ELEMENT_NOT_FOUND
    }

    return AgentErrorCode.UNKNOWN
}

/**
 * LLM 相关错误
 */
export class LLMError extends AgentError {
    constructor(
        code: AgentErrorCode.LLM_API_ERROR | AgentErrorCode.LLM_INVALID_RESPONSE | AgentErrorCode.LLM_RATE_LIMIT | AgentErrorCode.LLM_AUTH_ERROR | AgentErrorCode.LLM_MODEL_NOT_FOUND,
        message?: string,
        options?: { cause?: Error; context?: Record<string, any> }
    ) {
        super(code, message, { ...options, recoverable: code !== AgentErrorCode.LLM_AUTH_ERROR })
        this.name = 'LLMError'
    }
}

/**
 * 工具执行错误
 */
export class ToolExecutionError extends AgentError {
    toolName: string

    constructor(
        toolName: string,
        message?: string,
        options?: { cause?: Error; context?: Record<string, any> }
    ) {
        super(AgentErrorCode.TOOL_EXECUTION_ERROR, message, options)
        this.name = 'ToolExecutionError'
        this.toolName = toolName
    }
}

/**
 * 配置错误
 */
export class ConfigError extends AgentError {
    constructor(
        code: AgentErrorCode.CONFIG_INVALID | AgentErrorCode.CONFIG_MISSING,
        message?: string,
        options?: { cause?: Error; context?: Record<string, any> }
    ) {
        super(code, message, { ...options, recoverable: false })
        this.name = 'ConfigError'
    }
}
