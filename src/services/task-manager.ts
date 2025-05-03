import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { type ProgressType, type Task, type TaskError, type TaskProgress, type TaskResult, TaskStatus } from '../types/task';
import api from '../utils/api';
import { DownloadManager } from '../utils/download-manager';
import logger from '../utils/logger';
import { initMinio, uploadFile } from '../utils/minio';
import { TranscodeManager } from '../utils/transcode-manager';

interface TranscodeResult {
    outputPath: string;
    duration: number;
    bitrate: number;
    size: number;
    resolution: {
        width: number;
        height: number;
    };
    minioInfo: {
        bucket: string;
        objectName: string;
        endpoint: string;
    };
}

class TaskManager {
    private tasks: Map<string, Task> = new Map();
    private uploadingTasks: Set<string> = new Set();
    private currentProcessingTask: string | null = null;
    private isProcessing = false;
    private tempDir: string;

    constructor() {
        this.tempDir = path.join(os.tmpdir(), 'video-processor');
        fs.ensureDirSync(this.tempDir);
    }

    private async updateProgress(taskId: string, progressData: TaskProgress) {
        try {
            logger.debug(`[任务 ${taskId}] 发送进度更新: ${JSON.stringify(progressData)}`);
            await api.post(`/runner/${taskId}/progress`, { data: progressData });
        } catch (err: any) {
            logger.error(`[任务 ${taskId}] 更新进度失败: ${err.message}`);
            if (err.response?.data) {
                logger.error(`[任务 ${taskId}] 错误详情: ${JSON.stringify(err.response.data)}`);
            }
        }
    }

    private validateTaskProgress(progress: TaskProgress): boolean {
        // 验证必填字段
        if (!progress.type || typeof progress.progress !== 'number') {
            logger.warn(`无效的任务进度数据: 缺少必填字段 ${JSON.stringify(progress)}`);
            return false;
        }

        // 验证进度范围
        if (progress.progress < 0 || progress.progress > 100) {
            logger.warn(`无效的进度值: ${progress.progress}`);
            return false;
        }

        // 验证类型
        if (!['upload', 'download'].includes(progress.type)) {
            logger.warn(`无效的进度类型: ${progress.type}`);
            return false;
        }

        return true;
    }

    async updateTaskStatus(taskId: string, status: TaskStatus, progress = 0, error?: string, result?: TaskResult) {
        const task = this.tasks.get(taskId);
        if (!task) {
            logger.warn(`尝试更新不存在的任务状态: ${taskId}`);
            return;
        }

        task.status = status;
        task.progress = progress;
        if (error) task.error = error;
        if (result) task.result = result;

        // 根据状态确定进度类型
        let progressType: ProgressType;
        switch (status) {
            case TaskStatus.DOWNLOADING:
                progressType = 'download';
                break;
            case TaskStatus.UPLOADING:
                progressType = 'upload';
                break;
            default:
                // 对于其他状态，我们不发送进度更新
                return;
        }

        const progressData: TaskProgress = {
            type: progressType,
            progress,
            transferred: result?.size || 0,
            total: result?.size || 0,
            speed: 0, // 这个需要从实际的下载/上传过程中获取
            eta: 0, // 这个需要从实际的下载/上传过程中获取
        };

        // 验证数据
        if (!this.validateTaskProgress(progressData)) {
            logger.error(`任务进度数据验证失败: ${JSON.stringify(progressData)}`);
            return;
        }

        await this.updateProgress(taskId, progressData);
    }

    async addTask(task: Task) {
        // 如果当前正在处理任务，拒绝新任务
        if (this.isProcessing) {
            logger.warn(`[任务 ${task.id}] 系统正在处理其他任务，拒绝接受新任务`);
            throw new Error('系统正在处理其他任务，请稍后重试');
        }

        logger.info(`[任务 ${task.id}] 收到新任务: ${JSON.stringify(task)}`);
        this.tasks.set(task.id, task);

        try {
            // 先接受任务
            logger.info(`[任务 ${task.id}] 接受任务`);
            await api.post(`/runner/${task.id}/start`);

            // 开始处理任务
            logger.info(`[任务 ${task.id}] 开始处理任务`);
            await this.processNextTask();
        } catch (error: any) {
            logger.error(`[任务 ${task.id}] 接受任务失败: ${error.message}`);
            if (error.response?.data) {
                logger.error(`[任务 ${task.id}] 错误详情: ${JSON.stringify(error.response.data)}`);
            }
            // 从任务列表中移除
            this.tasks.delete(task.id);
        }
    }

    private async processNextTask() {
        if (this.currentProcessingTask || this.isProcessing) {
            logger.debug(`当前正在处理任务: ${this.currentProcessingTask}, 跳过`);
            return;
        }

        for (const [taskId, task] of this.tasks.entries()) {
            if (task.status === TaskStatus.WAITING) {
                logger.info(`[任务 ${taskId}] 开始处理`);
                this.currentProcessingTask = taskId;
                this.isProcessing = true;
                await this.processTask(task);
                break;
            }
        }
    }

    private async processTask(task: Task) {
        logger.info(
            `[任务 ${task.id}] 开始处理任务，任务信息: ${JSON.stringify({
                id: task.id,
                status: task.status,
                source: task.source,
            })}`,
        );

        const downloadPath = path.join(this.tempDir, `${task.id}_source.mp4`);
        const transcodePath = path.join(this.tempDir, `${task.id}_transcoded.mp4`);
        let transcodeResult: TranscodeResult | null = null;

        try {
            // 下载文件
            if (!task.source) {
                throw new Error('任务缺少source');
            }

            logger.info(`[任务 ${task.id}] 开始下载文件: ${task.source}`);
            await this.updateTaskStatus(task.id, TaskStatus.DOWNLOADING);
            const downloader = new DownloadManager(task.source, downloadPath, (progress) => {
                const progressData: TaskProgress = {
                    type: 'download',
                    progress: progress.progress,
                    transferred: progress.transferred,
                    total: progress.total,
                    speed: progress.speed,
                    eta: progress.eta,
                };
                this.updateProgress(task.id, progressData);
            });

            logger.info(`[任务 ${task.id}] 创建下载管理器，准备开始下载`);
            await downloader.start();
            logger.info(`[任务 ${task.id}] 下载完成`);

            // 转码文件
            await this.updateTaskStatus(task.id, TaskStatus.RUNNING);
            const transcoder = new TranscodeManager(downloadPath, transcodePath, undefined, (progress) =>
                this.updateTaskStatus(task.id, TaskStatus.RUNNING, progress),
            );
            const { bitrate, duration } = await transcoder.start();

            // 获取转码后的文件信息
            const stats = await fs.stat(transcodePath);
            transcodeResult = {
                outputPath: transcodePath,
                duration,
                bitrate,
                size: stats.size,
                resolution: {
                    width: 1920,
                    height: 1080,
                },
                minioInfo: {
                    bucket: '',
                    objectName: `${task.id}.mp4`,
                    endpoint: '',
                },
            };

            // 在真正需要上传时才获取MinIO配置
            logger.info(`[任务 ${task.id}] 获取MinIO配置`);
            const minioConfigResponse = await api.get('/runner/minio');
            logger.debug(`[任务 ${task.id}] MinIO配置响应: ${JSON.stringify(minioConfigResponse.data)}`);
            const minioConfig = minioConfigResponse.data;

            if (!minioConfig.endpoint || !minioConfig.accessKey || !minioConfig.secretKey || !minioConfig.bucket) {
                throw new Error(`MinIO配置不完整: ${JSON.stringify(minioConfig)}`);
            }

            // 确保endpoint是有效的URL
            if (!minioConfig.endpoint.startsWith('http://') && !minioConfig.endpoint.startsWith('https://')) {
                minioConfig.endpoint = `http://${minioConfig.endpoint}`;
            }

            // 初始化MinIO配置
            logger.info(`[任务 ${task.id}] 初始化MinIO客户端，endpoint: ${minioConfig.endpoint}`);
            await initMinio(minioConfig);

            // 更新transcodeResult的minioInfo
            transcodeResult.minioInfo = {
                bucket: minioConfig.bucket,
                objectName: `${task.id}.mp4`,
                endpoint: minioConfig.endpoint,
            };

            // 开始后台上传
            await this.startBackgroundUpload(task, transcodePath, transcodeResult);

            // 清理临时文件
            await fs.remove(downloadPath);
            await fs.remove(transcodePath);

            // 处理完成后，重置状态
            this.currentProcessingTask = null;
            this.isProcessing = false;
            await this.processNextTask();
        } catch (error: any) {
            const errorDetails = {
                message: error.message,
                code: error.code,
                command: error.command,
                path: error.path,
                transcodeResult: transcodeResult || undefined,
                tempFiles: {
                    downloadPath: (await fs.pathExists(downloadPath)) ? downloadPath : undefined,
                    transcodePath: (await fs.pathExists(transcodePath)) ? transcodePath : undefined,
                },
            };

            logger.error(`[任务 ${task.id}] 处理失败: ${JSON.stringify(errorDetails)}`);
            await this.updateTaskStatus(task.id, TaskStatus.FAILED, 0, JSON.stringify(errorDetails));

            // 清理临时文件
            await fs.remove(downloadPath);
            await fs.remove(transcodePath);

            // 发生错误时也要重置状态
            this.currentProcessingTask = null;
            this.isProcessing = false;
            await this.processNextTask();
        }
    }

    private async startBackgroundUpload(task: Task, filePath: string, transcodeResult: TranscodeResult) {
        this.uploadingTasks.add(task.id);
        await this.updateTaskStatus(task.id, TaskStatus.UPLOADING);

        let lastProgress = 0;
        let lastUpdateTime = Date.now();
        let lastTransferred = 0;
        const stats = await fs.stat(filePath);
        const totalSize = stats.size;

        // 启动上传进度报告定时器
        const progressInterval = setInterval(async () => {
            if (!this.uploadingTasks.has(task.id)) {
                clearInterval(progressInterval);
                return;
            }

            const now = Date.now();
            const timeDiff = (now - lastUpdateTime) / 1000; // 转换为秒
            const currentProgress = Math.min(lastProgress + 10, 100);
            const transferred = Math.floor((currentProgress / 100) * totalSize);
            const speed = timeDiff > 0 ? (transferred - lastTransferred) / timeDiff : 0;
            const remainingBytes = totalSize - transferred;
            const eta = speed > 0 ? Math.ceil(remainingBytes / speed) : 0;

            const progressData: TaskProgress = {
                type: 'upload',
                progress: currentProgress,
                transferred,
                total: totalSize,
                speed,
                eta,
            };

            await this.updateProgress(task.id, progressData);

            lastProgress = currentProgress;
            lastUpdateTime = now;
            lastTransferred = transferred;
        }, 1000);

        try {
            // 读取文件并上传
            const fileContent = await fs.readFile(filePath);
            const uploadPath = await uploadFile(task.id, `${task.id}.mp4`, fileContent, {
                taskId: task.id,
                timestamp: new Date().toISOString(),
                duration: String(transcodeResult.duration),
                bitrate: String(transcodeResult.bitrate),
                size: String(transcodeResult.size),
                width: String(transcodeResult.resolution.width),
                height: String(transcodeResult.resolution.height),
            });

            const result = {
                ...transcodeResult,
                uploadPath,
                uploadTimestamp: new Date().toISOString(),
                metadata: {
                    taskId: task.id,
                    duration: transcodeResult.duration,
                    bitrate: transcodeResult.bitrate,
                    size: transcodeResult.size,
                    resolution: transcodeResult.resolution,
                },
            };

            clearInterval(progressInterval);
            this.uploadingTasks.delete(task.id);
            await this.updateTaskStatus(task.id, TaskStatus.FINISHED, 100, undefined, result);
        } catch (error: any) {
            const errorDetails = {
                message: error.message,
                code: error.code,
                transcodeResult,
                uploadError: true,
            };

            clearInterval(progressInterval);
            this.uploadingTasks.delete(task.id);
            await this.updateTaskStatus(task.id, TaskStatus.FAILED, 0, JSON.stringify(errorDetails));
        }
    }

    getTaskStatus(taskId: string): TaskStatus | null {
        return this.tasks.get(taskId)?.status || null;
    }
}

export const taskManager = new TaskManager();
