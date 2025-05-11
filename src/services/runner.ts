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

// 创建临时目录常量
const TMP_DIR = join(os.tmpdir(), 'videoconverter');

/**
 * 任务状态数据接口
 */
interface TaskStateData {
    downloadedFilePath?: string;
    convertedFilePath?: string;
}

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

    // 任务状态缓存 - 用于在不同阶段之间传递数据
    private taskStates: Map<string, TaskStateData> = new Map();

    constructor(config: RunnerConfig) {
        this.config = config;
        this.apiClient = api; // 使用传入的api客户端

        // 初始化任务队列 - 设置各阶段的并发数
        this.taskQueue = new TaskQueue(1, 1, 1); // 下载1个并发，转码1个并发，上传1个并发

        // 初始化各阶段的处理器
        this.downloadProcessor = new TaskProcessor(TMP_DIR, this.apiClient, TaskStage.DOWNLOAD);
        this.convertProcessor = new TaskProcessor(TMP_DIR, this.apiClient, TaskStage.CONVERT);
        this.uploadProcessor = new TaskProcessor(TMP_DIR, this.apiClient, TaskStage.UPLOAD);

        // 设置事件监听
        this.setupEventListeners();

        // 记录使用的临时目录
        logger.info(`Using temporary directory: ${TMP_DIR}`);
    }

    /**
     * 设置事件监听
     */
    private setupEventListeners() {
        // 下载阶段事件
        this.downloadProcessor.on('complete', (task: ProcessorTask) => {
            logger.info(`Task ${task.id} completed download stage`);
            logger.info(`Task object received in download complete event: ${JSON.stringify({
                id: task.id,
                status: task.status,
                hasDownloadInfo: !!task.downloadInfo,
                hasFilePath: !!task.downloadInfo?.filePath
            })}`);

            // 保存下载文件路径到状态缓存 - 增强路径获取逻辑
            let downloadedFilePath = (task as any).downloadedFilePath;
            logger.info(`Direct path from task object: ${downloadedFilePath || 'undefined'}`);

            // 如果直接属性不存在，尝试从downloadInfo中获取
            if (!downloadedFilePath && task.downloadInfo?.filePath) {
                downloadedFilePath = task.downloadInfo.filePath;
                logger.info(`Using file path from downloadInfo: ${downloadedFilePath}`);
            }

            if (downloadedFilePath) {
                this.taskStates.set(task.id, {
                    ...this.taskStates.get(task.id) || {},
                    downloadedFilePath
                });
                logger.info(`Saved download path for task ${task.id}: ${downloadedFilePath}`);
                logger.info(`Task state cache updated: ${JSON.stringify(this.taskStates.get(task.id))}`);
            } else {
                logger.error(`No download path found for task ${task.id} - this will cause problems in convert stage`);
            }

            this.taskQueue.completeDownload(task);
        });

        this.downloadProcessor.on('error', ({ task, error }: { task: ProcessorTask, error: Error }) => {
            logger.error(`Task ${task.id} failed in download stage: ${error.message}`);
            this.taskQueue.fail(task.id, TaskStage.DOWNLOAD, error);

            // 清理任务状态缓存
            this.taskStates.delete(task.id);
        });

        // 转码阶段事件
        this.convertProcessor.on('complete', (task: ProcessorTask) => {
            logger.info(`Task ${task.id} completed convert stage`);
            logger.info(`Task object received in convert complete event: ${JSON.stringify({
                id: task.id,
                status: task.status,
                hasConvertedFilePath: !!(task as any).convertedFilePath
            })}`);

            // 保存转换文件路径到状态缓存
            const convertedFilePath = (task as any).convertedFilePath;
            if (convertedFilePath) {
                this.taskStates.set(task.id, {
                    ...this.taskStates.get(task.id) || {},
                    convertedFilePath
                });
                logger.info(`Saved converted path for task ${task.id}: ${convertedFilePath}`);
                logger.info(`Task state cache updated: ${JSON.stringify(this.taskStates.get(task.id))}`);
            } else {
                logger.warn(`No converted path found for task ${task.id}`);
            }

            this.taskQueue.completeConvert(task);
        });

        this.convertProcessor.on('error', ({ task, error }: { task: ProcessorTask, error: Error }) => {
            logger.error(`Task ${task.id} failed in convert stage: ${error.message}`);
            this.taskQueue.fail(task.id, TaskStage.CONVERT, error);

            // 清理任务状态缓存
            this.taskStates.delete(task.id);
        });

        // 上传阶段事件
        this.uploadProcessor.on('complete', (task: ProcessorTask) => {
            logger.info(`Task ${task.id} completed upload stage`);
            this.taskQueue.completeUpload(task);

            // 清理任务状态缓存
            this.taskStates.delete(task.id);
            logger.info(`Cleared state cache for task ${task.id}`);
        });

        this.uploadProcessor.on('error', ({ task, error }: { task: ProcessorTask, error: Error }) => {
            logger.error(`Task ${task.id} failed in upload stage: ${error.message}`);
            this.taskQueue.fail(task.id, TaskStage.UPLOAD, error);

            // 清理任务状态缓存
            this.taskStates.delete(task.id);
            logger.info(`Cleared state cache for task ${task.id} due to error`);
        });

        // 任务队列状态变更事件
        this.taskQueue.on('updated', (stats) => {
            logger.debug(`Queue stats: Download (waiting: ${stats.download.waiting}, processing: ${stats.download.processing}), Convert (waiting: ${stats.convert.waiting}, processing: ${stats.convert.processing}), Upload (waiting: ${stats.upload.waiting}, processing: ${stats.upload.processing})`);
        });

        // 任务状态变更事件
        this.downloadProcessor.on('stateChange', (state: string) => {
            logger.info(`Download task state changed to: ${state}`);
        });

        this.convertProcessor.on('stateChange', (state: string) => {
            logger.info(`Convert task state changed to: ${state}`);
        });

        this.uploadProcessor.on('stateChange', (state: string) => {
            logger.info(`Upload task state changed to: ${state}`);
        });

        // 任务进度事件
        this.downloadProcessor.on('progress', ({ stage, info }: { stage: string, info: any }) => {
            logger.debug(`download progress: ${info.progress?.toFixed(2)}%`);
        });

        this.convertProcessor.on('progress', ({ stage, info }: { stage: string, info: any }) => {
            logger.debug(`convert progress: ${info.progress?.toFixed(2)}%`);
        });

        this.uploadProcessor.on('progress', ({ stage, info }: { stage: string, info: any }) => {
            logger.debug(`upload progress: ${info.progress?.toFixed(2)}%`);
        });
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
            logger.error(`Failed to start runner: ${error}`);
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
            logger.error(`Failed to register: ${error.message}`);
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
                logger.error(`Heartbeat failed: ${error}`);
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
                logger.error(`Task processing error: ${error}`);
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
                logger.error(`Download processing error: ${error}`);
            }
        }
    }

    private async processConvertTasks() {
        const task = await this.taskQueue.nextConvert();
        if (task) {
            try {
                logger.info(`Processing convert task: ${task.id}`);
                logger.info(`Task object before convert: ${JSON.stringify({
                    id: task.id,
                    status: task.status,
                    hasDownloadedFilePath: !!(task as any).downloadedFilePath,
                    hasDownloadInfo: !!task.downloadInfo,
                    hasFilePath: !!task.downloadInfo?.filePath
                })}`);

                // 从状态缓存中恢复任务状态
                const stateData = this.taskStates.get(task.id);
                logger.info(`State cache for task ${task.id}: ${JSON.stringify(stateData || {})}`);

                if (stateData?.downloadedFilePath) {
                    // 将下载文件路径添加到任务对象
                    (task as any).downloadedFilePath = stateData.downloadedFilePath;
                    logger.info(`Restored download path for task ${task.id}: ${stateData.downloadedFilePath}`);

                    // 同时更新downloadInfo，以防其他代码依赖它
                    if (!task.downloadInfo) {
                        task.downloadInfo = {
                            startTime: new Date().toISOString(),
                            sourceUrl: task.source,
                            filePath: stateData.downloadedFilePath
                        };
                    } else if (!task.downloadInfo.filePath) {
                        task.downloadInfo.filePath = stateData.downloadedFilePath;
                    }

                    logger.info(`Task object after path restoration: ${JSON.stringify({
                        id: task.id,
                        status: task.status,
                        hasDownloadedFilePath: !!(task as any).downloadedFilePath,
                        downloadedFilePath: (task as any).downloadedFilePath,
                        hasDownloadInfo: !!task.downloadInfo,
                        downloadInfoFilePath: task.downloadInfo?.filePath
                    })}`);
                } else {
                    // 如果状态缓存中没有找到下载文件路径，记录错误并抛出异常
                    const errorMsg = `No download path found in cache for task ${task.id}`;
                    logger.error(errorMsg);
                    throw new Error(errorMsg);
                }

                // 使用转码处理器处理任务
                await this.convertProcessor.process(task);
            } catch (error) {
                logger.error(`Convert processing error: ${error}`);
                // 确保任务失败被正确处理
                this.taskQueue.fail(task.id, TaskStage.CONVERT, error instanceof Error ? error : new Error(String(error)));
                // 清理任务状态缓存
                this.taskStates.delete(task.id);
            }
        }
    }

    private async processUploadTasks() {
        const task = await this.taskQueue.nextUpload();
        if (task) {
            try {
                // 从状态缓存中恢复任务状态
                const stateData = this.taskStates.get(task.id);
                if (stateData?.convertedFilePath) {
                    // 将转换文件路径添加到任务对象
                    (task as any).convertedFilePath = stateData.convertedFilePath;
                    logger.info(`Restored converted path for task ${task.id}: ${stateData.convertedFilePath}`);
                } else {
                    // 如果状态缓存中没有找到转换文件路径，记录错误并抛出异常
                    const errorMsg = `No converted path found in cache for task ${task.id}`;
                    logger.error(errorMsg);
                    throw new Error(errorMsg);
                }

                // 使用上传处理器处理任务
                await this.uploadProcessor.process(task);
            } catch (error) {
                logger.error(`Upload processing error: ${error}`);
                // 确保任务失败被正确处理
                this.taskQueue.fail(task.id, TaskStage.UPLOAD, error instanceof Error ? error : new Error(String(error)));
                // 清理任务状态缓存
                this.taskStates.delete(task.id);
            }
        }
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
                    logger.error(`Failed to start task ${task.id}: ${startError instanceof Error ? startError.message : String(startError)}`);

                    // 记录详细的错误信息
                    if (startError.response) {
                        logger.error(`Response status: ${startError.response.status}`);
                        logger.error(`Response data: ${JSON.stringify(startError.response.data)}`);
                    }
                }
            }
        } catch (error) {
            logger.error(`Failed to check task: ${error instanceof Error ? error.message : String(error)}`);
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