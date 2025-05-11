import { EventEmitter } from 'node:events';
import type { Task } from '@/types/task';
import { TaskStatus } from '@/types/task';
import logger from '@/utils/logger';

/**
 * 任务阶段枚举
 */
export enum TaskStage {
    DOWNLOAD = 'download',
    CONVERT = 'convert',
    UPLOAD = 'upload'
}

/**
 * 任务队列管理类
 */
export class TaskQueue extends EventEmitter {
    // 各阶段的任务队列
    private downloadQueue: Task[] = [];
    private convertQueue: Task[] = [];
    private uploadQueue: Task[] = [];

    // 各阶段的并发限制
    private maxDownloadConcurrent: number;
    private maxConvertConcurrent: number;
    private maxUploadConcurrent: number;

    // 各阶段正在处理的任务集合
    private processingDownload: Set<string> = new Set();
    private processingConvert: Set<string> = new Set();
    private processingUpload: Set<string> = new Set();

    constructor(
        maxDownloadConcurrent: number = 2,
        maxConvertConcurrent: number = 1,
        maxUploadConcurrent: number = 2
    ) {
        super();
        this.maxDownloadConcurrent = maxDownloadConcurrent;
        this.maxConvertConcurrent = maxConvertConcurrent;
        this.maxUploadConcurrent = maxUploadConcurrent;
    }

    /**
     * 添加任务到下载队列
     * @param task 任务对象
     */
    add(task: Task): void {
        // 检查任务是否已在任何队列中
        if (this.isTaskInAnyQueue(task.id)) {
            logger.warn(`Task ${task.id} is already in queue, skipping`);
            return;
        }

        // 新任务默认添加到下载队列
        this.downloadQueue.push(task);
        logger.info(`Task ${task.id} added to download queue`);
        this.emit('added', { task, stage: TaskStage.DOWNLOAD });
        this.emit('updated', this.getStats());
    }

    /**
     * 检查任务是否在任何队列中
     */
    private isTaskInAnyQueue(taskId: string): boolean {
        return this.downloadQueue.some(t => t.id === taskId) ||
            this.convertQueue.some(t => t.id === taskId) ||
            this.uploadQueue.some(t => t.id === taskId) ||
            this.processingDownload.has(taskId) ||
            this.processingConvert.has(taskId) ||
            this.processingUpload.has(taskId);
    }

    /**
     * 获取下一个可执行的下载任务
     */
    async nextDownload(): Promise<Task | null> {
        if (this.downloadQueue.length === 0 || this.processingDownload.size >= this.maxDownloadConcurrent) {
            return null;
        }

        // 按优先级排序
        this.sortQueueByPriority(this.downloadQueue);

        const task = this.downloadQueue.shift() || null;
        if (task) {
            this.processingDownload.add(task.id);
            logger.info(`Task ${task.id} started downloading`);
            this.emit('started', { task, stage: TaskStage.DOWNLOAD });
            this.emit('updated', this.getStats());
        }

        return task;
    }

    /**
     * 获取下一个可执行的转码任务
     */
    async nextConvert(): Promise<Task | null> {
        if (this.convertQueue.length === 0 || this.processingConvert.size >= this.maxConvertConcurrent) {
            return null;
        }

        // 按优先级排序
        this.sortQueueByPriority(this.convertQueue);

        const task = this.convertQueue.shift() || null;
        if (task) {
            this.processingConvert.add(task.id);
            logger.info(`Task ${task.id} started converting`);
            this.emit('started', { task, stage: TaskStage.CONVERT });
            this.emit('updated', this.getStats());
        }

        return task;
    }

    /**
     * 获取下一个可执行的上传任务
     */
    async nextUpload(): Promise<Task | null> {
        if (this.uploadQueue.length === 0 || this.processingUpload.size >= this.maxUploadConcurrent) {
            return null;
        }

        // 按优先级排序
        this.sortQueueByPriority(this.uploadQueue);

        const task = this.uploadQueue.shift() || null;
        if (task) {
            this.processingUpload.add(task.id);
            logger.info(`Task ${task.id} started uploading`);
            this.emit('started', { task, stage: TaskStage.UPLOAD });
            this.emit('updated', this.getStats());
        }

        return task;
    }

    /**
     * 按优先级排序队列
     */
    private sortQueueByPriority(queue: Task[]): void {
        queue.sort((a, b) => {
            const priorityA = (a as any).priority || 0;
            const priorityB = (b as any).priority || 0;
            return priorityB - priorityA;
        });
    }

    /**
     * 完成下载阶段，移动到转码队列
     */
    completeDownload(task: Task): void {
        if (this.processingDownload.has(task.id)) {
            this.processingDownload.delete(task.id);
            // 将任务添加到转码队列
            this.convertQueue.push(task);
            logger.info(`Task ${task.id} completed downloading, moved to convert queue`);
            this.emit('stageCompleted', { task, stage: TaskStage.DOWNLOAD });
            this.emit('updated', this.getStats());
        }
    }

    /**
     * 完成转码阶段，移动到上传队列
     */
    completeConvert(task: Task): void {
        if (this.processingConvert.has(task.id)) {
            this.processingConvert.delete(task.id);
            // 将任务添加到上传队列
            this.uploadQueue.push(task);
            logger.info(`Task ${task.id} completed converting, moved to upload queue`);
            this.emit('stageCompleted', { task, stage: TaskStage.CONVERT });
            this.emit('updated', this.getStats());
        }
    }

    /**
     * 完成上传阶段，任务全部完成
     */
    completeUpload(task: Task): void {
        if (this.processingUpload.has(task.id)) {
            this.processingUpload.delete(task.id);
            logger.info(`Task ${task.id} completed uploading, all stages finished`);
            this.emit('completed', task);
            this.emit('updated', this.getStats());
        }
    }

    /**
     * 任务失败处理
     */
    fail(taskId: string, stage: TaskStage, error: Error): void {
        // 根据阶段从对应的处理集合中移除
        if (stage === TaskStage.DOWNLOAD && this.processingDownload.has(taskId)) {
            this.processingDownload.delete(taskId);
        } else if (stage === TaskStage.CONVERT && this.processingConvert.has(taskId)) {
            this.processingConvert.delete(taskId);
        } else if (stage === TaskStage.UPLOAD && this.processingUpload.has(taskId)) {
            this.processingUpload.delete(taskId);
        }

        logger.error(`Task ${taskId} failed in ${stage} stage: ${error.message}`);
        this.emit('failed', { taskId, stage, error });
        this.emit('updated', this.getStats());
    }

    /**
     * 获取队列统计信息
     */
    getStats(): { download: { waiting: number, processing: number }, convert: { waiting: number, processing: number }, upload: { waiting: number, processing: number } } {
        return {
            download: {
                waiting: this.downloadQueue.length,
                processing: this.processingDownload.size
            },
            convert: {
                waiting: this.convertQueue.length,
                processing: this.processingConvert.size
            },
            upload: {
                waiting: this.uploadQueue.length,
                processing: this.processingUpload.size
            }
        };
    }

    /**
     * 检查各阶段是否有空闲槽位
     */
    hasCapacity(stage: TaskStage): boolean {
        switch (stage) {
            case TaskStage.DOWNLOAD:
                return this.processingDownload.size < this.maxDownloadConcurrent;
            case TaskStage.CONVERT:
                return this.processingConvert.size < this.maxConvertConcurrent;
            case TaskStage.UPLOAD:
                return this.processingUpload.size < this.maxUploadConcurrent;
            default:
                return false;
        }
    }

    /**
     * 检查是否有空闲下载槽位
     */
    hasDownloadCapacity(): boolean {
        return this.hasCapacity(TaskStage.DOWNLOAD);
    }

    /**
     * 清空所有队列
     */
    clear(): void {
        this.downloadQueue = [];
        this.convertQueue = [];
        this.uploadQueue = [];
        this.processingDownload.clear();
        this.processingConvert.clear();
        this.processingUpload.clear();
        this.emit('cleared');
        this.emit('updated', this.getStats());
    }
} 