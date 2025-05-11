import { TaskProcessor } from '@/core/TaskState';
import { TaskQueue } from '@/core/TaskQueue';
import api from '@/utils/api';
import type { Task } from '@/types/task';
import { TaskStatus } from '@/types/task';
import os from 'os';
import path from 'path';
import logger from '@/utils/logger';

// 创建临时目录常量
const TMP_DIR = path.join(os.tmpdir(), 'videoconverter');

export default class TaskManager {
    private taskQueue: TaskQueue;
    private taskProcessor: TaskProcessor;
    private running = false;
    private taskCheckTimer?: NodeJS.Timer;

    constructor(workDir?: string) {
        const workDirectory = workDir || TMP_DIR;

        // 初始化任务队列和处理器
        this.taskQueue = new TaskQueue(1); // 最多同时处理1个任务
        this.taskProcessor = new TaskProcessor(workDirectory, api);

        // 设置事件监听
        this.setupEventListeners();

        logger.info(`TaskManager initialized with work directory: ${workDirectory}`);
    }

    /**
     * 设置事件监听
     */
    private setupEventListeners() {
        // 任务完成事件
        this.taskProcessor.on('complete', (task: Task) => {
            logger.info(`Task ${task.id} completed successfully`);
            this.taskQueue.complete(task.id);
        });

        // 任务错误事件
        this.taskProcessor.on('error', ({ task, error }: { task: Task, error: Error }) => {
            logger.error(`Task ${task.id} failed: ${error.message}`);
            this.taskQueue.fail(task.id, error);
        });

        // 任务状态变更事件
        this.taskProcessor.on('stateChange', (state: string) => {
            logger.info(`Task state changed to: ${state}`);
        });

        // 任务进度事件
        this.taskProcessor.on('progress', ({ stage, info }: { stage: string, info: any }) => {
            logger.debug(`${stage} progress: ${info.progress?.toFixed(2)}%`);
        });
    }

    async start() {
        this.running = true;

        // 设置任务检查定时器
        this.taskCheckTimer = setInterval(() => {
            this.checkAndFetchNewTask();
        }, 5000);

        logger.info('TaskManager started');

        // 开始处理任务循环
        this.processTaskLoop();
    }

    async stop() {
        this.running = false;
        if (this.taskCheckTimer) {
            clearInterval(this.taskCheckTimer);
        }
        logger.info('TaskManager stopped');
    }

    private async processTaskLoop() {
        while (this.running) {
            try {
                // 从队列中获取下一个任务
                const task = await this.taskQueue.next();
                if (task) {
                    // 使用任务处理器处理任务
                    await this.taskProcessor.process(task);
                }
            } catch (error) {
                logger.error(`Task processing error: ${error instanceof Error ? error.message : String(error)}`);
            }

            // 避免CPU过度使用
            await this.sleep(500);
        }
    }

    private async checkAndFetchNewTask() {
        // 如果队列已满或没有空闲容量，则不获取新任务
        if (!this.taskQueue.hasCapacity()) {
            return;
        }

        try {
            // 获取新任务
            const task = await this.getTask();
            if (task) {
                this.taskQueue.add(task);
                logger.info(`Added task ${task.id} to queue`);
            }
        } catch (error) {
            logger.error(`Failed to check task: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async getTask(): Promise<Task | null> {
        try {
            const res = await api.get('/runner/getTask');
            const task = res?.data?.task;

            if (task) {
                // 确保任务有状态值
                return {
                    ...task,
                    status: task.status || TaskStatus.WAITING
                };
            }
        } catch (error) {
            logger.error('获取任务失败', error);
        }
        return null;
    }

    // 这个方法保留用于直接处理单个任务，但内部使用TaskProcessor
    async processTask(task: Task) {
        try {
            await this.taskProcessor.process(task);
        } catch (error) {
            logger.error(`Failed to process task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}