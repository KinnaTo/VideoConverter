import type { TaskStatus } from './task';

export interface Machine {
    id: string;
    name: string;
    token: string;
    status: 'online' | 'offline' | 'error';
    lastHeartbeat?: Date;
}

export interface Task {
    id: string;
    queueId: string;
    status: TaskStatus;
    priority: number;
    source: string;
    createTime: Date;
    updateTime: Date;
}

export interface Queue {
    id: string;
    name: string;
    priority: number;
}

export interface RunnerConfig {
    machineId: string;
    token: string;
    apiUrl: string;
    downloadDir: string;
    heartbeatInterval: number; // 毫秒
    taskCheckInterval: number; // 毫秒
}
