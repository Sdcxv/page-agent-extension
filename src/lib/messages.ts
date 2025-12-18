// Message types for communication between extension components

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

    // Configuration
    CONFIG_UPDATED: 'CONFIG_UPDATED',
    GET_CONFIG: 'GET_CONFIG',

    // Status
    GET_STATUS: 'GET_STATUS',
    STATUS_RESPONSE: 'STATUS_RESPONSE',
    PING: 'PING',
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
