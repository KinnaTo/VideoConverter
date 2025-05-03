export enum TaskStatus {
    PENDING = 'PENDING',
    RUNNING = 'RUNNING',
    FINISHED = 'FINISHED',
    FAILED = 'FAILED',
}

export interface Machine {
    id: string;
    name: string;
    token: string;
    firstHeartbeat?: Date;
    heartbeat?: Date;
    status: string;
}

export interface Task {
    id: string;
    queueId: string;
    status: TaskStatus;
    priority: number;
    result?: any;
    error?: string;
    progress?: number;
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date;
    finishedAt?: Date;
    runnerId?: string;
}

export interface Queue {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface RunnerConfig {
    apiUrl: string;
    token: string;
    machineId: string;
    heartbeatInterval: number;
    taskCheckInterval: number;
    downloadDir: string;
}
