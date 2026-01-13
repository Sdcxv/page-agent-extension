// Message types for communication between extension components

/**
 * 任务状态枚举
 */
export enum TaskStatus {
    IDLE = 'idle',           // 空闲
    STARTING = 'starting',   // 启动中
    THINKING = 'thinking',   // AI推理中
    EXECUTING = 'executing', // 执行工具中
    PAUSED = 'paused',       // 已暂停
    COMPLETED = 'completed', // 已完成
    FAILED = 'failed',       // 已失败
    STOPPING = 'stopping',   // 停止中
}

export const MESSAGE_TYPES = {
    // From popup to content script
    EXECUTE_TASK: 'EXECUTE_TASK',
    STOP_TASK: 'STOP_TASK',
    PAUSE_TASK: 'PAUSE_TASK',
    RESUME_TASK: 'RESUME_TASK',

    // From content script to popup
    TASK_STARTED: 'TASK_STARTED',
    TASK_PROGRESS: 'TASK_PROGRESS',
    TASK_COMPLETED: 'TASK_COMPLETED',
    TASK_ERROR: 'TASK_ERROR',
    TASK_THINKING: 'TASK_THINKING',
    TASK_STATUS_CHANGE: 'TASK_STATUS_CHANGE', // 新增：状态变更通知

    // Task lifecycle
    TASK_STOPPED: 'TASK_STOPPED',  // 新增：任务已停止确认

    // Configuration
    CONFIG_UPDATED: 'CONFIG_UPDATED',
    GET_CONFIG: 'GET_CONFIG',

    // Debugger interactions
    DEBUGGER_CLICK: 'DEBUGGER_CLICK',
    DEBUGGER_TYPE: 'DEBUGGER_TYPE',
    DEBUGGER_PRESS_KEY: 'DEBUGGER_PRESS_KEY',

    // Status
    GET_STATUS: 'GET_STATUS',
    STATUS_RESPONSE: 'STATUS_RESPONSE',
    PING: 'PING',
    TASK_HEARTBEAT: 'TASK_HEARTBEAT',
    PROXY_FETCH: 'PROXY_FETCH',
    LOG_EVENT: 'LOG_EVENT',
    GET_LOGS: 'GET_LOGS',
    CLEAR_LOGS: 'CLEAR_LOGS',
} as const

export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES]

export interface BaseMessage {
    type: MessageType
    timestamp: number
}

export interface ExecuteTaskMessage extends BaseMessage {
    type: typeof MESSAGE_TYPES.EXECUTE_TASK
    task: string
}

export interface StopTaskMessage extends BaseMessage {
    type: typeof MESSAGE_TYPES.STOP_TASK
}

export interface TaskProgressMessage extends BaseMessage {
    type: typeof MESSAGE_TYPES.TASK_PROGRESS
    step: number
    maxSteps: number
    status: string
    brain?: {
        evaluation: string
        memory: string
        nextGoal: string
    }
}

export interface TaskCompletedMessage extends BaseMessage {
    type: typeof MESSAGE_TYPES.TASK_COMPLETED
    success: boolean
    result: string
}

export interface TaskErrorMessage extends BaseMessage {
    type: typeof MESSAGE_TYPES.TASK_ERROR
    error: string
}

export type ExtensionMessage =
    | ExecuteTaskMessage
    | StopTaskMessage
    | TaskProgressMessage
    | TaskCompletedMessage
    | TaskErrorMessage
    | BaseMessage

export function createMessage<T extends ExtensionMessage>(message: Omit<T, 'timestamp'>): T {
    return {
        ...message,
        timestamp: Date.now(),
    } as T
}
