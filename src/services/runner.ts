import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import type { Machine, Queue, RunnerConfig, Task as RunnerTask } from '@/types/runner';
import type { Task as ProcessorTask } from '@/types/task';
import logger from '@/utils/logger';
import { getSystemInfo } from '@/utils/system-info';
import type { MinioConfig } from '@/types/task';
import { TaskProcessor } from '@/core/TaskState';
import { TaskQueue, TaskStage } from '@/core/TaskQueue';
import api from '@/utils/api';
import { TaskStatus } from '@/types/task';
import type { AxiosInstance } from 'axios';
import { formatErrorMessage } from '@/utils/error-handler';
import { TaskStateManager } from '@/core/TaskStateManager';

// 创建临时目录常量
const TMP_DIR = join(os.tmpdir(), 'videoconverter');

// 使用TaskStateManager替代原有的TaskStateData接口

/**
 * 将Runner的Task类型转换为Processor的Task类型
 */
function adaptTask(runnerTask: RunnerTask): ProcessorTask {
    return {
        id: runnerTask.id,
        status: runnerTask.status || TaskStatus.WAITING, // 确保有状态值
        source: runnerTask.source,
        // 添加默认的转换参数
        convertParams: {
            codec: 'h264_nvenc',
            audioCodec: 'aac',
            preset: 'fast',
            resolution: '1080p'
        }
    };
}

export class RunnerService {
    private config: RunnerConfig;
    private machine?: Machine;
    private heartbeatTimer?: NodeJS.Timer;
    private taskCheckTimer?: NodeJS.Timer;
    private apiClient: AxiosInstance;
    private minioConfig?: MinioConfig;

    // 任务处理组件
    private taskQueue: TaskQueue;
    private downloadProcessor: TaskProcessor;
    private convertProcessor: TaskProcessor;
    private uploadProcessor: TaskProcessor;
    private running = false;

    // 任务状态管理器 - 用于在不同阶段之间传递数据
    private taskStates: TaskStateManager;

    constructor(config: RunnerConfig) {
        this.config = config;
        this.apiClient = api; // 使用传入的api客户端

        // 初始化任务队列 - 设置各阶段的并发数
        this.taskQueue = new TaskQueue(1, 1, 1); // 下载1个并发，转码1个并发，上传1个并发

        // 初始化各阶段的处理器
        this.downloadProcessor = new TaskProcessor(TMP_DIR, this.apiClient, TaskStage.DOWNLOAD);
        this.convertProcessor = new TaskProcessor(TMP_DIR, this.apiClient, TaskStage.CONVERT);
        this.uploadProcessor = new TaskProcessor(TMP_DIR, this.apiClient, TaskStage.UPLOAD);

        // 初始化任务状态管理器
        this.taskStates = new TaskStateManager();

        // 设置事件监听
        this.setupEventListeners();

        // 记录使用的临时目录
        logger.info(`Using temporary directory: ${TMP_DIR}`);
    }

    /**
     * 设置事件监听
     */
    private setupEventListeners() {
        // 设置下载处理器事件
        this.setupProcessorEvents(
            this.downloadProcessor,
            TaskStage.DOWNLOAD,
            (task: ProcessorTask) => {
                // 保存下载文件路径到状态缓存
                const downloadedFilePath = this.getTaskFilePath(task, 'downloadedFilePath', 'downloadInfo?.filePath');
                if (downloadedFilePath) {
                    this.taskStates.set(task.id, { downloadedFilePath });
                    logger.info(`Saved download path for task ${task.id}: ${downloadedFilePath}`);
                } else {
                    logger.error(`No download path found for task ${task.id} - this will cause problems in convert stage`);
                }
                this.taskQueue.completeDownload(task);
            }
        );

        // 设置转换处理器事件
        this.setupProcessorEvents(
            this.convertProcessor,
            TaskStage.CONVERT,
            (task: ProcessorTask) => {
                // 保存转换文件路径到状态缓存
                const convertedFilePath = (task as any).convertedFilePath;
                if (convertedFilePath) {
                    this.taskStates.set(task.id, { convertedFilePath });
                    logger.info(`Saved converted path for task ${task.id}: ${convertedFilePath}`);
                } else {
                    logger.warn(`No converted path found for task ${task.id}`);
                }
                this.taskQueue.completeConvert(task);
            }
        );

        // 设置上传处理器事件
        this.setupProcessorEvents(
            this.uploadProcessor,
            TaskStage.UPLOAD,
            (task: ProcessorTask) => {
                this.taskQueue.completeUpload(task);
                // 清理任务状态缓存
                this.taskStates.delete(task.id);
                logger.info(`Cleared state cache for task ${task.id}`);
            }
        );

        // 任务队列状态变更事件
        this.taskQueue.on('updated', (stats) => {
            logger.debug(`Queue stats: Download (waiting: ${stats.download.waiting}, processing: ${stats.download.processing}), Convert (waiting: ${stats.convert.waiting}, processing: ${stats.convert.processing}), Upload (waiting: ${stats.upload.waiting}, processing: ${stats.upload.processing})`);
        });
    }

    /**
     * 为处理器设置通用事件监听
     */
    private setupProcessorEvents(
        processor: TaskProcessor,
        stage: TaskStage,
        completeHandler: (task: ProcessorTask) => void
    ) {
        // 完成事件
        processor.on('complete', (task: ProcessorTask) => {
            logger.info(`Task ${task.id} completed ${stage} stage`);
            this.logTaskState(task, stage, 'complete');
            completeHandler(task);
        });

        // 错误事件
        processor.on('error', ({ task, error }: { task: ProcessorTask, error: Error }) => {
            logger.error(`Task ${task.id} failed in ${stage} stage: ${error.message}`);
            this.taskQueue.fail(task.id, stage, error);
            // 清理任务状态缓存
            this.taskStates.delete(task.id);
        });

        // 状态变更事件
        processor.on('stateChange', (state: string) => {
            logger.info(`${this.getStageName(stage)} task state changed to: ${state}`);
        });

        // 进度事件
        processor.on('progress', ({ stage: stageType, info }: { stage: string, info: any }) => {
            logger.debug(`${this.getStageName(stage)} progress: ${info.progress?.toFixed(2)}%`);
        });
    }

    /**
     * 获取阶段名称
     */
    private getStageName(stage: TaskStage): string {
        switch (stage) {
            case TaskStage.DOWNLOAD: return 'download';
            case TaskStage.CONVERT: return 'convert';
            case TaskStage.UPLOAD: return 'upload';
            default: return 'unknown';
        }
    }

    /**
     * 记录任务状态
     */
    private logTaskState(task: ProcessorTask, stage: TaskStage, event: string) {
        const stateInfo: Record<string, any> = {
            id: task.id,
            status: task.status,
            hasDownloadInfo: !!task.downloadInfo,
        };

        // 根据阶段添加不同的状态信息
        if (stage === TaskStage.DOWNLOAD || stage === TaskStage.CONVERT) {
            stateInfo.hasDownloadPath = !!(task as any).downloadedFilePath;
            stateInfo.downloadPath = (task as any).downloadedFilePath;
            stateInfo.downloadInfoPath = task.downloadInfo?.filePath;
        }

        if (stage === TaskStage.CONVERT || stage === TaskStage.UPLOAD) {
            stateInfo.hasConvertedPath = !!(task as any).convertedFilePath;
            stateInfo.convertedPath = (task as any).convertedFilePath;
        }

        logger.info(`Task object in ${this.getStageName(stage)} ${event} event: ${JSON.stringify(stateInfo)}`);
    }

    /**
     * 从任务对象中获取文件路径
     */
    private getTaskFilePath(task: ProcessorTask, directPath: string, nestedPath?: string): string | undefined {
        // 尝试直接从任务对象获取
        let filePath = (task as any)[directPath];
        logger.info(`Direct path from task object (${directPath}): ${filePath || 'undefined'}`);

        // 如果直接属性不存在，尝试从嵌套路径获取
        if (!filePath && nestedPath) {
            // 解析嵌套路径，例如 "downloadInfo?.filePath"
            const parts = nestedPath.split('?.');
            let value: any = task;
            for (const part of parts) {
                if (value === undefined || value === null) break;
                value = value[part];
            }

            if (value) {
                filePath = value;
                logger.info(`Using file path from nested path (${nestedPath}): ${filePath}`);
            }
        }

        return filePath;
    }

    async start() {
        try {
            // 创建临时目录
            await mkdir(TMP_DIR, { recursive: true });

            // 获取MinIO配置
            try {
                const response = await this.apiClient.get('/runner/minio');
                this.minioConfig = response.data;
                logger.info('Successfully loaded MinIO config');
            } catch (error) {
                logger.warn('Failed to get initial MinIO config, will retry later');
            }

            // 注册机器
            await this.register();

            // 启动心跳
            this.startHeartbeat();

            // 启动任务处理
            this.running = true;
            this.startTaskProcessing();

            logger.info(`Runner started with ID: ${this.config.machineId}`);
        } catch (error) {
            logger.error(`Failed to start runner: ${formatErrorMessage(error)}`);
            throw error;
        }
    }

    async stop() {
        this.running = false;
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
            const { systemInfo: deviceInfo, encoder } = await getSystemInfo();
            logger.info(`Registering with machineId: ${this.config.machineId}, encoder: ${encoder}`);

            const response = await this.apiClient.post('/runner/online', {
                machine: {
                    id: this.config.machineId,
                    name: 'Video Converter',
                    deviceInfo,
                    encoder,
                },
            });

            if (response?.data?.runner) {
                this.machine = response.data.runner;
                logger.info(`Registered as machine: ${this.machine?.id} with encoder type: ${encoder}`);
            } else {
                throw new Error('Failed to register: No runner data in response');
            }
        } catch (error: any) {
            logger.error(`Failed to register: ${formatErrorMessage(error)}`);
            if (error.response) {
                logger.error(`Response status: ${error.response.status}`);
                logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
            }
            throw new Error('Failed to register');
        }
    }

    private startHeartbeat() {
        this.heartbeatTimer = setInterval(async () => {
            try {
                const { systemInfo: deviceInfo, encoder } = await getSystemInfo();
                await this.apiClient.post('/runner/heartbeat', {
                    deviceInfo,
                    encoder
                });
                logger.info('Heartbeat sent');
            } catch (error) {
                logger.error(`Heartbeat failed: ${formatErrorMessage(error)}`);
            }
        }, this.config.heartbeatInterval);
    }

    private async startTaskProcessing() {
        // 设置任务检查定时器
        this.taskCheckTimer = setInterval(() => {
            this.checkAndFetchNewTask();
        }, 5000);

        // 启动多阶段并行处理循环
        while (this.running) {
            try {
                // 并行处理各个阶段的任务
                await Promise.all([
                    this.processDownloadTasks(),
                    this.processConvertTasks(),
                    this.processUploadTasks()
                ]);
            } catch (error) {
                logger.error(`Task processing error: ${formatErrorMessage(error)}`);
            }

            // 避免CPU过度使用
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    private async processDownloadTasks() {
        const task = await this.taskQueue.nextDownload();
        if (task) {
            try {
                // 使用下载处理器处理任务
                await this.downloadProcessor.process(task);
            } catch (error) {
                logger.error(`Download processing error: ${formatErrorMessage(error)}`);
                this.handleTaskError(task, TaskStage.DOWNLOAD, error);
            }
        }
    }

    private async processConvertTasks() {
        const task = await this.taskQueue.nextConvert();
        if (task) {
            try {
                logger.info(`Processing convert task: ${task.id}`);

                // 从状态缓存中恢复任务状态
                await this.restoreTaskState(task, 'downloadedFilePath', 'No download path found in cache');

                // 使用转码处理器处理任务
                await this.convertProcessor.process(task);
            } catch (error) {
                logger.error(`Convert processing error: ${formatErrorMessage(error)}`);
                this.handleTaskError(task, TaskStage.CONVERT, error);
            }
        }
    }

    private async processUploadTasks() {
        const task = await this.taskQueue.nextUpload();
        if (task) {
            try {
                // 从状态缓存中恢复任务状态
                await this.restoreTaskState(task, 'convertedFilePath', 'No converted path found in cache');

                // 使用上传处理器处理任务
                await this.uploadProcessor.process(task);
            } catch (error) {
                logger.error(`Upload processing error: ${formatErrorMessage(error)}`);
                this.handleTaskError(task, TaskStage.UPLOAD, error);
            }
        }
    }

    /**
     * 从状态缓存中恢复任务状态
     */
    private async restoreTaskState(task: ProcessorTask, stateKey: string, errorMessage: string): Promise<void> {
        const stateData = this.taskStates.get(task.id);
        logger.info(`State cache for task ${task.id}: ${JSON.stringify(stateData || {})}`);

        if (stateData?.[stateKey]) {
            // 将状态数据添加到任务对象
            (task as any)[stateKey] = stateData[stateKey];
            logger.info(`Restored ${stateKey} for task ${task.id}: ${stateData[stateKey]}`);

            // 如果是下载文件路径，同时更新downloadInfo
            if (stateKey === 'downloadedFilePath') {
                this.updateDownloadInfo(task, stateData[stateKey]);
            }
        } else {
            // 如果状态缓存中没有找到所需数据，记录错误并抛出异常
            const errorMsg = `${errorMessage} for task ${task.id}`;
            logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    }

    /**
     * 更新任务的downloadInfo
     */
    private updateDownloadInfo(task: ProcessorTask, filePath: string): void {
        if (!task.downloadInfo) {
            task.downloadInfo = {
                startTime: new Date().toISOString(),
                sourceUrl: task.source,
                filePath: filePath
            };
        } else if (!task.downloadInfo.filePath) {
            task.downloadInfo.filePath = filePath;
        }

        logger.info(`Task object after path restoration: ${JSON.stringify({
            id: task.id,
            status: task.status,
            hasDownloadedFilePath: !!(task as any).downloadedFilePath,
            downloadedFilePath: (task as any).downloadedFilePath,
            hasDownloadInfo: !!task.downloadInfo,
            downloadInfoFilePath: task.downloadInfo?.filePath
        })}`);
    }

    /**
     * 处理任务错误
     */
    private handleTaskError(task: ProcessorTask, stage: TaskStage, error: unknown): void {
        // 确保任务失败被正确处理
        const errorObj = error instanceof Error ? error : new Error(String(error));
        this.taskQueue.fail(task.id, stage, errorObj);
        // 清理任务状态缓存
        this.taskStates.delete(task.id);
    }

    private async checkAndFetchNewTask() {
        // 如果下载队列没有空闲容量，则不获取新任务
        if (!this.taskQueue.hasDownloadCapacity()) {
            return;
        }

        try {
            // 直接获取任务，而不是先获取队列
            const response = await this.apiClient.get('/runner/getTask');
            const task = response?.data?.task;

            if (task) {
                // 检查任务状态，只处理等待中的任务
                if (task.status !== TaskStatus.WAITING) {
                    logger.warn(`Skipping task ${task.id} because it is not in WAITING state (current state: ${task.status})`);
                    return;
                }

                try {
                    // 先调用start接口，将任务与当前机器绑定
                    logger.info(`Starting task ${task.id}...`);
                    const startResponse = await this.apiClient.post(`/runner/${task.id}/start`);

                    if (!startResponse.data.success) {
                        logger.error(`Failed to start task ${task.id}: ${JSON.stringify(startResponse.data)}`);
                        return;
                    }

                    logger.info(`Task ${task.id} successfully bound to this machine`);

                    // 将任务添加到队列，使用适配器转换类型
                    const processableTask = adaptTask(task);

                    // 再次确认任务状态是否为等待中
                    if (processableTask.status !== TaskStatus.WAITING) {
                        logger.warn(`Task ${task.id} status changed to ${processableTask.status} after adaptation, skipping`);
                        return;
                    }

                    // 初始化任务状态缓存
                    this.taskStates.set(task.id, {});
                    logger.info(`Initialized state cache for task ${task.id}`);

                    // 添加到下载队列
                    this.taskQueue.add(processableTask);
                } catch (startError: any) {
                    logger.error(`Failed to start task ${task.id}: ${formatErrorMessage(startError)}`);

                    // 记录详细的错误信息
                    if (startError.response) {
                        logger.error(`Response status: ${startError.response.status}`);
                        logger.error(`Response data: ${JSON.stringify(startError.response.data)}`);
                    }
                }
            }
        } catch (error) {
            logger.error(`Failed to check task: ${formatErrorMessage(error)}`);
        }
    }

    getMinioConfig(): MinioConfig | undefined {
        return this.minioConfig;
    }

    async updateMinioConfig(): Promise<void> {
        try {
            const response = await this.apiClient.get('/runner/minio');
            this.minioConfig = response.data;
            logger.info('Successfully updated MinIO config');
        } catch (error) {
            logger.error('Failed to update MinIO config');
            throw error;
        }
    }
} 