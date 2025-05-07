import api from '@/utils/api';
import Downloader from './downloader';
import Converter from './converter';
import Uploader from './uploader';
import type { MinioConfig } from '@/types/task';
import os from 'os';
import path from 'path';

interface Task {
    id: string;
    url: string;
    // 其他任务相关字段
}

export default class TaskManager {
    private downloadQueue: Task[] = [];
    private convertingTask: Task | null = null;
    private uploadingTask: Task | null = null;
    private isDownloading = false;
    private isConverting = false;
    private isUploading = false;
    private running = false;
    private workDir: string;

    constructor(workDir?: string) {
        this.workDir = workDir || os.tmpdir();
    }

    async start() {
        this.running = true;
        while (this.running) {
            // 下载阶段，最多允许1个正在下载，1个已下载待转换
            if (!this.isDownloading && this.downloadQueue.length < 2) {
                const task = await this.getTask();
                if (task) this.downloadTask(task);
            }

            // 转换阶段
            if (!this.isConverting && this.downloadQueue.length > 0) {
                const task = this.downloadQueue.shift();
                if (task) this.convertTask(task);
            }

            // 上传阶段
            if (!this.isUploading && this.uploadingTask) {
                this.uploadTask(this.uploadingTask);
            }

            await this.sleep(500);
        }
    }

    async getTask(): Promise<Task | null> {
        try {
            const res = await api.get('/runner/getTask');


        } catch (error) {
            console.error('获取任务失败', error);
        }
        return null;
    }

    async downloadTask(task: Task) {
        this.isDownloading = true;
        // TODO: 下载路径和进度回调
        const downloadPath = path.join(this.workDir, `${task.id}`);
        const downloader = new Downloader(task.url, downloadPath);
        await downloader.download(info => {
            api.post(`/runner/${task.id}/download`, { downloadInfo: info });
        });
        await api.post(`/runner/${task.id}/download`, { downloadInfo: downloader.downloadInfo });
        this.downloadQueue.push(task);
        this.isDownloading = false;
    }

    async convertTask(task: Task) {
        this.isConverting = true;
        // TODO: 调用Converter进行转换
        const downloadPath = path.join(this.workDir, `${task.id}`);
        const outputPath = path.join(this.workDir, `${task.id}.mp4`);
        const converter = new Converter(downloadPath, outputPath);
        await converter.convert(info => {
            api.post(`/runner/${task.id}/convert`, { convertInfo: info });
        });
        await api.post(`/runner/${task.id}/convert`, { convertInfo: converter.convertInfo });
        this.uploadingTask = task;
        this.isConverting = false;
    }

    async uploadTask(task: Task) {
        this.isUploading = true;
        // 获取minio配置
        const { data: minioConfig } = await api.get('/runner/minio');
        const uploader = new Uploader(minioConfig as MinioConfig);
        const outputPath = path.join(this.workDir, `${task.id}.mp4`);
        await uploader.upload(outputPath, task.id, 'mp4', info => {
            api.post(`/runner/${task.id}/upload`, { uploadInfo: info });
        });
        await api.post(`/runner/${task.id}/upload`, { uploadInfo: uploader.uploadInfo });
        this.isUploading = false;
    }

    async processTask(task: Task) {
        try {
            // 1. 标记任务开始
            await api.post(`/runner/${task.id}/start`);

            // 2. 下载
            const downloadPath = path.join(this.workDir, `${task.id}`);
            const downloader = new Downloader(task.url, downloadPath);
            await downloader.download(info => {
                api.post(`/runner/${task.id}/download`, { downloadInfo: info });
            });
            await api.post(`/runner/${task.id}/download`, { downloadInfo: downloader.downloadInfo });

            // 3. 转换
            const outputPath = path.join(this.workDir, `${task.id}.mp4`);
            const converter = new Converter(downloadPath, outputPath);
            await converter.convert(info => {
                api.post(`/runner/${task.id}/convert`, { convertInfo: info });
            });
            await api.post(`/runner/${task.id}/convert`, { convertInfo: converter.convertInfo });

            // 4. 获取minio配置
            const { data: minioConfig } = await api.get('/runner/minio');
            const uploader = new Uploader(minioConfig as MinioConfig);

            // 5. 上传
            await uploader.upload(outputPath, task.id, 'mp4', info => {
                api.post(`/runner/${task.id}/upload`, { uploadInfo: info });
            });
            await api.post(`/runner/${task.id}/upload`, { uploadInfo: uploader.uploadInfo });

            // 6. 标记完成
            await api.post(`/runner/${task.id}/complete`, {
                result: {
                    status: 'success',
                    path: uploader.uploadInfo?.targetUrl,
                }
            });
        } catch (error) {
            await api.post(`/runner/${task.id}/fail`, { error: String(error) });
        }
    }

    sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}