import { TaskStatus } from '../types/task';
import { Downloader } from '../utils/downloader';
import { TranscodeManager } from '../utils/transcode-manager';
import type { Task } from '../types/task';
import { RunnerService } from './runner';
import logger from '../utils/logger';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export class TaskManager {
    private tasks = new Map<string, Task>();
    private isProcessing = false;
    private tempDir = join(process.cwd(), 'temp');

    constructor(private runnerService: RunnerService) {
        this.ensureTempDir();
    }

    private async ensureTempDir() {
        if (!existsSync(this.tempDir)) {
            await mkdir(this.tempDir, { recursive: true });
        }
    }

    public async startProcessing() {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;
        await this.processNextTask();
    }

    public stopProcessing() {
        this.isProcessing = false;
    }

    private async processNextTask() {
        while (this.isProcessing) {
            try {
                logger.info('尝试获取新任务...');
                const task = await this.runnerService.getTask();

                if (!task) {
                    logger.info('当前无可用任务.');
                    await new Promise(resolve => setTimeout(resolve, 10000));
                    continue;
                }

                await this.processTask(task);
            } catch (error) {
                logger.error('处理任务时出错:', error);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
    }

    private async processTask(task: Task) {
        logger.info(`[任务 ${task.id}] 开始处理任务，任务信息: ${JSON.stringify(task)}`);

        try {
            // 启动任务
            await this.runnerService.startTask(task.id);
            this.tasks.set(task.id, task);

            // 下载文件
            const downloadPath = join(this.tempDir, `${task.id}_download`);
            const downloader = new Downloader(task.source, downloadPath);
            logger.info(`[任务 ${task.id}] 开始下载文件: ${task.source}`);
            const downloadResult = await downloader.start();

            // 转码
            const transcodePath = join(this.tempDir, `${task.id}_transcode.mp4`);
            const transcoder = new TranscodeManager(downloadPath, transcodePath);
            logger.info(`[任务 ${task.id}] 开始转码文件`);
            const transcodeResult = await transcoder.start();

            // 上传
            const uploader = new Uploader();
            logger.info(`[任务 ${task.id}] 开始上传文件`);
            const uploadResult = await uploader.upload(transcodePath);

            // 完成任务
            await this.runnerService.completeTask(task.id, {
                downloadInfo: downloadResult,
                convertInfo: transcodeResult,
                uploadInfo: uploadResult
            });

            logger.info(`[任务 ${task.id}] 处理完成`);
        } catch (error: any) {
            logger.error(`[任务 ${task.id}] 处理失败:`, error);
            if (error.serverError) {
                logger.error(`[任务 ${task.id}] 服务端错误详情:`, JSON.stringify(error.serverError));
            }

            try {
                await this.runnerService.failTask(task.id, error);
            } catch (reportError: any) {
                logger.error(`[任务 ${task.id}] 报告失败状态时出错:`, reportError.message);
                if (reportError.response?.data) {
                    logger.error(`[任务 ${task.id}] 报告失败状态错误详情:`, JSON.stringify(reportError.response.data));
                }
            }
        } finally {
            // 清理临时文件
            try {
                const downloadPath = join(this.tempDir, `${task.id}_download`);
                const transcodePath = join(this.tempDir, `${task.id}_transcode.mp4`);
                await rm(downloadPath, { force: true });
                await rm(transcodePath, { force: true });
            } catch (error) {
                logger.error(`[任务 ${task.id}] 清理临时文件失败:`, error);
            }

            this.tasks.delete(task.id);
        }
    }
}
