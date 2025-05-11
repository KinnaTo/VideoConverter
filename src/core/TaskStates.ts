import { join } from 'node:path';
import os from 'node:os';
import type { TaskState, TaskContext } from './TaskState';
import type { Task, TaskError } from '@/types/task';
import Downloader from '@/task/downloader';
import Converter from '@/task/converter';
import Uploader from '@/task/uploader';
import fs from 'node:fs';
import logger from '@/utils/logger';
import { TaskStatus } from '@/types/task';
import type { MinioConfig } from '@/types/task';
import axios from 'axios';

// 创建临时目录常量
const TMP_DIR = join(os.tmpdir(), 'videoconverter');

// 确保临时目录存在
if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

/**
 * 等待状态 - 下载阶段入口
 */
export class WaitingState implements TaskState {
    async process(task: Task, context: TaskContext): Promise<TaskState | null> {
        task.status = TaskStatus.WAITING;
        logger.info(`WaitingState: Task ${task.id} is now in WAITING state, transitioning to DownloadingState`);

        // 创建下载状态并立即处理
        const downloadingState = new DownloadingState();
        logger.info(`WaitingState: Directly processing task ${task.id} with DownloadingState`);
        return await downloadingState.process(task, context);
    }

    getName(): string {
        return 'waiting';
    }
}

/**
 * 下载状态
 */
export class DownloadingState implements TaskState {
    async process(task: Task, context: TaskContext): Promise<TaskState | null> {
        task.status = TaskStatus.DOWNLOADING;
        try {
            const api = context.getApiClient();

            // 为每个任务创建单独的目录
            const taskDir = join(TMP_DIR, task.id);
            logger.info(`Task ${task.id} downloading to directory: ${taskDir}`);

            // 创建下载器并开始下载
            const downloader = new Downloader(task.source, taskDir);
            logger.info(`Downloader created for task ${task.id}, source: ${task.source}`);

            // 下载文件并获取文件路径
            logger.info(`Starting download for task ${task.id}...`);
            const downloadedFilePath = await downloader.download(async (info) => {
                try {
                    // 转换进度信息为Record<string, unknown>格式
                    const progressInfo = {
                        ...info,
                        stage: 'download'
                    } as Record<string, unknown>;

                    context.emitProgress('download', progressInfo);
                    await api.post(`/runner/${task.id}/download`, {
                        downloadInfo: progressInfo
                    }, { skipRetry: true }).catch((error: unknown) => {
                        // 进度上报错误不影响下载
                        logger.warn(`Error in download progress callback: ${error instanceof Error ? error.message : String(error)}`);
                    });
                } catch (error: unknown) {
                    // 进度上报错误不影响下载
                    logger.warn(`Error in download progress callback: ${error instanceof Error ? error.message : String(error)}`);
                }
            });

            logger.info(`Download completed for task ${task.id}, received path: ${downloadedFilePath}`);

            // 检查下载是否成功
            if (!downloadedFilePath) {
                throw new Error(`No download path returned for task ${task.id}`);
            }

            if (!fs.existsSync(downloadedFilePath)) {
                throw new Error(`Downloaded file not found: ${downloadedFilePath}`);
            }

            logger.info(`File exists at path: ${downloadedFilePath}`);

            // 保存下载的文件路径到任务对象的动态属性
            (task as any).downloadedFilePath = downloadedFilePath;
            logger.info(`Set downloadedFilePath on task object: ${(task as any).downloadedFilePath}`);

            // 将路径信息添加到任务的downloadInfo中，确保在任何情况下都能获取到路径
            if (!task.downloadInfo) {
                task.downloadInfo = {
                    startTime: new Date().toISOString(),
                    sourceUrl: task.source,
                    filePath: downloadedFilePath // 添加文件路径
                };
                logger.info(`Created new downloadInfo with filePath: ${downloadedFilePath}`);
            } else {
                task.downloadInfo.filePath = downloadedFilePath; // 添加文件路径
                logger.info(`Added filePath to existing downloadInfo: ${downloadedFilePath}`);
            }

            logger.info(`Task ${task.id} downloaded to file: ${downloadedFilePath}`);
            logger.info(`Download path set on task object: ${(task as any).downloadedFilePath}`);
            logger.info(`Download path set in downloadInfo: ${task.downloadInfo.filePath}`);
            logger.info(`Task object state: ${JSON.stringify({
                id: task.id,
                status: task.status,
                hasDownloadInfo: !!task.downloadInfo,
                hasFilePath: !!task.downloadInfo?.filePath,
                downloadedFilePath: (task as any).downloadedFilePath
            })}`);

            // 通知服务器下载完成
            try {
                await api.post(`/runner/${task.id}/downloadComplete`, {
                    downloadedFilePath: downloadedFilePath // 在请求中也包含文件路径
                });
                logger.info(`Successfully notified download complete for task ${task.id}`);
            } catch (error) {
                logger.error(`Failed to notify download complete: ${error instanceof Error ? error.message : String(error)}`);
                // 不抛出错误,继续处理
            }

            // 下载阶段完成，返回null表示此阶段处理结束
            return null;
        } catch (error) {
            // 下载过程的错误,任务失败
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Task ${task.id} failed in downloading state: ${errorMessage}`);

            task.status = TaskStatus.FAILED;
            task.error = {
                message: errorMessage,
                code: 'DOWNLOAD_ERROR',
                tempFiles: {
                    downloadPath: (task as any).downloadedFilePath || task.downloadInfo?.filePath
                }
            };

            throw error;
        }
    }

    getName(): string {
        return 'downloading';
    }
}

/**
 * 转换状态 - 转码阶段入口
 */
export class ConvertingState implements TaskState {
    async process(task: Task, context: TaskContext): Promise<TaskState | null> {
        task.status = TaskStatus.CONVERTING;
        try {
            const api = context.getApiClient();

            // 使用下载状态保存的文件路径
            const downloadPath = (task as any).downloadedFilePath;
            const outputPath = join(TMP_DIR, `${task.id}_converted.mp4`);

            logger.info(`Task ${task.id} converting from ${downloadPath} to ${outputPath}`);

            // 检查下载的文件是否存在
            if (!fs.existsSync(downloadPath)) {
                throw new Error(`Downloaded file not found: ${downloadPath}`);
            }

            // 创建转换器并开始转换
            const converter = new Converter(downloadPath, outputPath);

            await converter.convert(async (info) => {
                try {
                    const progressInfo = {
                        ...info,
                        stage: 'convert'
                    } as Record<string, unknown>;

                    context.emitProgress('convert', progressInfo);
                    await api.post(`/runner/${task.id}/convert`, {
                        convertInfo: progressInfo
                    }).catch((error: unknown) => {
                        // 进度上报错误不影响转换，但需要记录详细信息
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        logger.error(`Failed to send convert progress: ${errorMessage}`);

                        // 检查是否是404错误（任务不存在）或403错误（任务不属于当前机器）
                        if (axios.isAxiosError(error) && error.response) {
                            const status = error.response.status;
                            const data = error.response.data;

                            if (status === 404) {
                                logger.error(`Task ${task.id} not found in database. This task may have been deleted.`);
                            } else if (status === 403) {
                                logger.error(`Task ${task.id} does not belong to this machine. It may have been reassigned.`);
                            }

                            logger.error(`Error details: ${JSON.stringify(data)}`);
                        }
                    });
                } catch (error: unknown) {
                    logger.error(`Error in convert progress callback: ${error instanceof Error ? error.message : String(error)}`);
                }
            });

            // 检查转换后的文件是否存在
            if (!fs.existsSync(outputPath)) {
                throw new Error(`Converted file not found: ${outputPath}`);
            }

            // 保存转换后的文件路径到任务上下文
            (task as any).convertedFilePath = outputPath;
            logger.info(`Task ${task.id} converted successfully to ${outputPath}`);

            // 转码阶段完成，返回null表示此阶段处理结束
            return null;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Task ${task.id} failed in converting state: ${errorMessage}`);

            task.status = TaskStatus.FAILED;
            task.error = {
                message: errorMessage,
                code: 'CONVERT_ERROR',
                tempFiles: {
                    downloadPath: (task as any).downloadedFilePath,
                    transcodePath: join(TMP_DIR, `${task.id}_converted.mp4`)
                }
            };

            throw error;
        }
    }

    getName(): string {
        return 'converting';
    }
}

/**
 * 上传状态 - 上传阶段入口
 */
export class UploadingState implements TaskState {
    async process(task: Task, context: TaskContext): Promise<TaskState | null> {
        try {
            task.status = TaskStatus.UPLOADING;

            // 获取MinIO配置
            const api = context.getApiClient();
            const config = await api.get('/runner/minio');
            const minioConfig: MinioConfig = config.data;

            // 创建上传器
            const uploader = new Uploader(minioConfig);

            // 获取转换后的文件路径
            const convertedFilePath = (task as any).convertedFilePath;

            // 上传文件
            const uploadInfo = await uploader.upload(
                convertedFilePath,
                task.id,
                'mp4',
                async (info) => {
                    try {
                        // 转换进度信息为Record<string, unknown>格式
                        const progressInfo = {
                            ...info,
                            stage: 'upload'
                        } as Record<string, unknown>;

                        context.emitProgress('upload', progressInfo);
                        await api.post(`/runner/${task.id}/upload`, {
                            uploadInfo: progressInfo
                        }).catch((error: unknown) => {
                            // 进度上报错误不影响上传，但需要记录详细信息
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            logger.error(`Error in upload progress callback: ${errorMessage}`);

                            // 检查是否是404错误（任务不存在）或403错误（任务不属于当前机器）
                            if (axios.isAxiosError(error) && error.response) {
                                const status = error.response.status;
                                const data = error.response.data;

                                if (status === 404) {
                                    logger.error(`Task ${task.id} not found in database. This task may have been deleted.`);
                                } else if (status === 403) {
                                    logger.error(`Task ${task.id} does not belong to this machine. It may have been reassigned.`);
                                }

                                logger.error(`Error details: ${JSON.stringify(data)}`);
                            }
                        });
                    } catch (error: unknown) {
                        logger.error(`Error in upload progress callback: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            );

            // 更新任务状态和上传信息
            task.status = TaskStatus.FINISHED;
            task.uploadInfo = uploadInfo;

            // 上传完成后直接进入完成状态
            return new CompleteState();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Task ${task.id} failed in uploading state: ${errorMessage}`);

            task.status = TaskStatus.FAILED;
            task.error = {
                message: errorMessage,
                code: 'UPLOAD_ERROR',
                tempFiles: {
                    downloadPath: (task as any).downloadedFilePath,
                    transcodePath: (task as any).convertedFilePath
                }
            };

            throw error;
        }
    }

    getName(): string {
        return 'uploading';
    }
}

/**
 * 完成状态
 */
export class CompleteState implements TaskState {
    async process(task: Task, context: TaskContext): Promise<TaskState | null> {
        try {
            // 标记任务完成
            const api = context.getApiClient();
            await api.post(`/runner/${task.id}/complete`, {
                result: {
                    status: 'success',
                    path: task.uploadInfo?.targetUrl,
                }
            });

            // 清理临时文件
            this.cleanupTempFiles(task);
            logger.info(`Task ${task.id} completed successfully`);

            // 返回null表示状态处理结束
            return null;
        } catch (error) {
            logger.error(`Task ${task.id} failed in complete state: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    // 清理临时文件
    private cleanupTempFiles(task: Task): void {
        try {
            // 删除任务目录
            const taskDir = join(TMP_DIR, task.id);
            if (fs.existsSync(taskDir)) {
                fs.rmSync(taskDir, { recursive: true, force: true });
                logger.info(`Cleaned up task directory: ${taskDir}`);
            }

            // 删除转换后的文件
            const convertedFilePath = (task as any).convertedFilePath;
            if (convertedFilePath && fs.existsSync(convertedFilePath)) {
                fs.unlinkSync(convertedFilePath);
                logger.info(`Cleaned up converted file: ${convertedFilePath}`);
            }
        } catch (error) {
            logger.error(`Failed to cleanup temp files: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getName(): string {
        return 'complete';
    }
}

/**
 * 失败状态
 */
export class FailedState implements TaskState {
    private error: Error;

    constructor(error: Error) {
        this.error = error;
    }

    async process(task: Task, context: TaskContext): Promise<TaskState | null> {
        try {
            // 标记任务失败
            const api = context.getApiClient();
            const errorMessage = this.error.message || String(this.error);

            logger.error(`Reporting task ${task.id} failure: ${errorMessage}`);

            await api.post(`/runner/${task.id}/fail`, {
                error: errorMessage
            });

            // 清理临时文件
            this.cleanupTempFiles(task);

            // 返回null表示状态处理结束
            return null;
        } catch (reportError) {
            logger.error(`Failed to report task error: ${reportError instanceof Error ? reportError.message : String(reportError)}`);
            return null;
        }
    }

    // 清理临时文件
    private cleanupTempFiles(task: Task): void {
        try {
            // 删除任务目录
            const taskDir = join(TMP_DIR, task.id);
            if (fs.existsSync(taskDir)) {
                fs.rmSync(taskDir, { recursive: true, force: true });
                logger.info(`Cleaned up task directory: ${taskDir}`);
            }

            // 删除转换后的文件
            const convertedFilePath = (task as any).convertedFilePath;
            if (convertedFilePath && fs.existsSync(convertedFilePath)) {
                fs.unlinkSync(convertedFilePath);
                logger.info(`Cleaned up converted file: ${convertedFilePath}`);
            }
        } catch (error) {
            logger.error(`Failed to cleanup temp files: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getName(): string {
        return 'failed';
    }
} 