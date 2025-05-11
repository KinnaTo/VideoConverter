import axios from 'axios';
import fs from 'fs';
import path from 'path';
import type { DownloadInfo } from '../types/task';
import fsExtra from 'fs-extra';
import logger from '@/utils/logger';

export default class Downloader {
    private url: string;
    private path: string;
    private dir: string;

    public downloadInfo: DownloadInfo | null = null;

    constructor(url: string, dir: string) {
        this.url = url;
        this.dir = dir;

        // 确保目录存在
        fsExtra.ensureDirSync(dir);

        // 从URL中提取文件名，如果没有则使用随机名称
        const fileName = this.getFileNameFromUrl(url);
        this.path = path.join(dir, fileName);

        logger.info(`Downloader initialized for URL: ${url}, output path: ${this.path}`);
    }

    // 从URL中提取文件名
    private getFileNameFromUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            let fileName = path.basename(pathname);

            // 如果没有文件名或文件名没有扩展名，使用默认文件名
            if (!fileName || !path.extname(fileName)) {
                fileName = `video${Date.now()}.mp4`;
            }

            return fileName;
        } catch (error) {
            // 如果URL解析失败，使用默认文件名
            logger.warn(`Failed to parse URL for filename: ${url}, using default name`);
            return `video${Date.now()}.mp4`;
        }
    }

    async download(onProgress?: (info: DownloadInfo) => void) {
        try {
            // 先测试URL是否可访问
            logger.info(`Testing URL accessibility: ${this.url}`);
            const testResponse = await axios.head(this.url).catch((error) => {
                logger.error(`Failed to test URL: ${error.message}`);
                if (error.response) {
                    logger.error(`Response status: ${error.response.status}`);
                    logger.error(`Response headers: ${JSON.stringify(error.response.headers)}`);
                }
                if (error.request) {
                    logger.error(`Request failed: ${error.request}`);
                }
                throw new Error(`URL not accessible: ${error.message}`);
            });

            // 获取文件大小
            const totalSize = Number(testResponse.headers['content-length']) || 0;
            let downloaded = 0;
            let lastTime = Date.now();
            let lastDownloaded = 0;
            const startTime = Date.now();

            logger.info(`Starting download of ${this.url}, total size: ${totalSize} bytes`);
            logger.info(`Download target path: ${this.path}`);

            this.downloadInfo = {
                startTime: new Date(startTime).toISOString(),
                sourceUrl: this.url,
                fileSize: totalSize,
                totalSize,
                currentSize: 0,
                progress: 0,
                currentSpeed: 0,
                eta: 0,
                endTime: '',
                averageSpeed: 0,
            };

            const response = await axios.get(this.url, {
                responseType: 'stream',
                timeout: 30000, // 30秒超时
                maxRedirects: 5,
                validateStatus: (status) => status === 200 // 只接受200状态码
            }).catch((error) => {
                logger.error(`Download request failed: ${error.message}`);
                if (error.response) {
                    logger.error(`Response status: ${error.response.status}`);
                    logger.error(`Response headers: ${JSON.stringify(error.response.headers)}`);
                }
                if (error.request) {
                    logger.error(`Request failed: ${error.request}`);
                }
                throw new Error(`Failed to download: ${error.message}`);
            });

            // 确保输出目录存在
            fsExtra.ensureDirSync(path.dirname(this.path));
            logger.info(`Ensured output directory exists: ${path.dirname(this.path)}`);

            // 如果文件已存在，先删除它
            if (fs.existsSync(this.path)) {
                fs.unlinkSync(this.path);
                logger.info(`Removed existing file: ${this.path}`);
            }

            const writer = fs.createWriteStream(this.path);
            logger.info(`Created write stream for file: ${this.path}`);

            response.data.on('data', (chunk: Buffer) => {
                downloaded += chunk.length;
                const now = Date.now();
                const timeElapsed = (now - lastTime) / 1000; // 秒
                if (timeElapsed >= 1) {
                    const speed = (downloaded - lastDownloaded) / timeElapsed; // B/s
                    const progress = totalSize ? downloaded / totalSize : 0;
                    const eta = speed > 0 ? (totalSize - downloaded) / speed : 0;
                    this.downloadInfo = {
                        ...this.downloadInfo!,
                        currentSize: downloaded,
                        progress: progress * 100,
                        currentSpeed: speed,
                        eta,
                    };
                    if (onProgress && this.downloadInfo) onProgress(this.downloadInfo);
                    lastTime = now;
                    lastDownloaded = downloaded;
                }
            });

            response.data.on('error', (error: Error) => {
                logger.error(`Stream error: ${error.message}`);
                writer.end();
                throw error;
            });

            response.data.on('end', () => {
                const endTime = Date.now();
                const duration = (endTime - startTime) / 1000;
                const averageSpeed = duration > 0 ? downloaded / duration : 0;
                this.downloadInfo = {
                    ...this.downloadInfo!,
                    endTime: new Date(endTime).toISOString(),
                    currentSize: downloaded,
                    progress: 100,
                    currentSpeed: 0,
                    eta: 0,
                    averageSpeed,
                };
                if (onProgress && this.downloadInfo) onProgress(this.downloadInfo);
                logger.info(`Download completed: ${this.path}, size: ${downloaded} bytes`);
            });

            response.data.pipe(writer);

            await new Promise<void>((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', (err) => {
                    logger.error(`File write error: ${err.message}`);
                    reject(err);
                });
                // 添加超时处理
                setTimeout(() => {
                    reject(new Error('Download timeout after 5 minutes'));
                }, 5 * 60 * 1000);
            });

            // 检查文件是否存在且大小正确
            if (!fs.existsSync(this.path)) {
                throw new Error(`Downloaded file not found: ${this.path}`);
            }

            const stats = fs.statSync(this.path);
            if (totalSize > 0 && stats.size !== totalSize) {
                throw new Error(`File size mismatch: expected ${totalSize}, got ${stats.size}`);
            }

            logger.info(`Download successful, returning file path: ${this.path}`);

            // 确保downloadInfo中也包含文件路径
            if (this.downloadInfo) {
                this.downloadInfo.filePath = this.path;
                logger.info(`Added file path to downloadInfo: ${this.path}`);
            }

            return this.path;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Download error: ${errorMessage}`);
            if (error instanceof Error && error.stack) {
                logger.error(`Error stack: ${error.stack}`);
            }

            // 如果文件已部分下载，尝试删除它
            if (fs.existsSync(this.path)) {
                try {
                    fs.unlinkSync(this.path);
                    logger.info(`Removed incomplete download: ${this.path}`);
                } catch (unlinkError) {
                    logger.error(`Failed to remove incomplete download: ${unlinkError}`);
                }
            }

            throw error;
        }
    }

    // 获取下载的文件路径
    getFilePath(): string {
        return this.path;
    }
}