import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Machine, Queue, RunnerConfig, Task } from '@/types/runner';
import { download } from '@/utils/downloader';
import logger from '@/utils/logger';
import { getSystemInfo } from '@/utils/system-info';

interface ApiResponse<T> {
    queue?: T[];
    task?: T;
    machine?: T;
    error?: string;
}

export class RunnerService {
    private config: RunnerConfig;
    private machine?: Machine;
    private heartbeatTimer?: NodeJS.Timer;
    private taskCheckTimer?: NodeJS.Timer;
    private currentTask?: Task;
    private isProcessingTask = false;

    constructor(config: RunnerConfig) {
        this.config = config;
    }

    private async request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
        const url = new URL(path, this.config.apiUrl).toString();
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.token}`,
        };

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...headers,
                    ...options.headers,
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return (await response.json()) as ApiResponse<T>;
        } catch (error) {
            logger.error(`API request failed: ${error}`);
            throw error;
        }
    }

    async start() {
        try {
            // 创建下载目录
            await mkdir(this.config.downloadDir, { recursive: true });

            // 注册机器
            await this.register();

            // 启动心跳
            this.startHeartbeat();

            // 启动任务检查
            this.startTaskCheck();

            logger.info(`Runner started with ID: ${this.config.machineId}`);
        } catch (error) {
            logger.error(`Failed to start runner: ${error}`);
            throw error;
        }
    }

    async stop() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }
        if (this.taskCheckTimer) {
            clearInterval(this.taskCheckTimer);
        }
        logger.info('Runner stopped');
    }

    private async register() {
        try {
            const sysInfo = await getSystemInfo();
            const response: any = await this.request('/runner/online', {
                method: 'POST',
                body: JSON.stringify({
                    machine: {
                        id: this.config.machineId,
                        name: 'Video Converter',
                        systemInfo: sysInfo,
                    },
                }),
            });
            if (response?.machine) {
                this.machine = response.machine;
                logger.info(`Registered as machine: ${this.machine?.id}`);
            } else {
                throw new Error('Failed to register');
            }
        } catch (error) {
            logger.error(`Failed to register: ${error}`);
            throw error;
        }
    }

    private startHeartbeat() {
        this.heartbeatTimer = setInterval(async () => {
            try {
                const sysInfo = await getSystemInfo();
                await this.request('/runner/heartbeat', {
                    method: 'POST',
                    body: JSON.stringify({ systemInfo: sysInfo }),
                });
                logger.debug('Heartbeat sent');
            } catch (error) {
                logger.error(`Heartbeat failed: ${error}`);
            }
        }, this.config.heartbeatInterval);
    }

    private startTaskCheck() {
        this.taskCheckTimer = setInterval(async () => {
            if (this.isProcessingTask) {
                return;
            }
            try {
                await this.checkAndProcessTask();
            } catch (error) {
                logger.error(`Task check failed: ${error}`);
            }
        }, this.config.taskCheckInterval);
    }

    private async checkAndProcessTask() {
        try {
            // 获取所有队列
            const { queue } = await this.request<Queue>('/runner/listQueue');
            if (!queue || queue.length === 0) {
                return;
            }

            // 遍历队列查找任务
            for (const q of queue) {
                const { task } = await this.request<Task>(`/runner/${q.id}/getTask`);
                if (task) {
                    await this.processTask(task);
                    break;
                }
            }
        } catch (error) {
            logger.error(`Failed to check task: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async processTask(task: Task) {
        this.isProcessingTask = true;
        this.currentTask = task;

        try {
            // 标记任务开始
            await this.request(`/runner/${task.id}/start`, {
                method: 'POST',
            });

            // 下载视频
            const videoPath = join(this.config.downloadDir, `${task.id}.mp4`);
            await this.updateProgress(task.id, '开始下载视频...', 0);

            await download(task.result.url, videoPath, (progress) => {
                this.updateProgress(task.id, '下载中...', progress);
            });

            await this.updateProgress(task.id, '下载完成', 100);

            // TODO: 在这里添加视频转码逻辑

            // 标记任务完成
            await this.request(`/runner/${task.id}/complete`, {
                method: 'POST',
                body: JSON.stringify({
                    result: {
                        status: 'success',
                        path: videoPath,
                    },
                }),
            });
        } catch (error) {
            logger.error(`Task processing failed: ${error instanceof Error ? error.message : String(error)}`);
            await this.request(`/runner/${task.id}/fail`, {
                method: 'POST',
                body: JSON.stringify({
                    error: error instanceof Error ? error.message : String(error),
                }),
            });
        } finally {
            this.isProcessingTask = false;
            this.currentTask = undefined;
        }
    }

    private async updateProgress(taskId: string, message: string, progress: number) {
        try {
            await this.request(`/runner/${taskId}/progress`, {
                method: 'POST',
                body: JSON.stringify({
                    data: {
                        message,
                        progress,
                    },
                }),
            });
        } catch (error) {
            logger.error(`Failed to update progress: ${error}`);
        }
    }
}
