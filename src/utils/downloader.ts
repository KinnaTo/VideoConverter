import { createWriteStream, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import logger from './logger';
import axios from 'axios';

export interface DownloadProgress {
    transferred: number;
    total: number;
    speed: number;
    progress: number;
    eta: number;
}

export class Downloader {
    private totalSize = 0;
    private downloadedSize = 0;
    private isDownloading = false;
    private abortController: AbortController | null = null;
    private lastUpdateTime = 0;
    private lastDownloadedSize = 0;
    private speedSamples: number[] = [];

    constructor(
        private url: string,
        private outputPath: string,
        private onProgress?: (progress: DownloadProgress) => void,
    ) {
        this.abortController = new AbortController();
    }

    private calculateSpeed(): number {
        const now = Date.now();
        const timeDiff = (now - this.lastUpdateTime) / 1000;
        const sizeDiff = this.downloadedSize - this.lastDownloadedSize;
        if (timeDiff > 0) {
            const currentSpeed = sizeDiff / timeDiff;
            this.speedSamples.push(currentSpeed);
            if (this.speedSamples.length > 5) {
                this.speedSamples.shift();
            }
            const avgSpeed = this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length;
            this.lastUpdateTime = now;
            this.lastDownloadedSize = this.downloadedSize;
            return avgSpeed;
        }
        return 0;
    }

    public async start(): Promise<void> {
        if (this.isDownloading) {
            throw new Error('Download already in progress');
        }
        this.isDownloading = true;
        logger.info(`开始下载: ${this.url} 到 ${this.outputPath}`);
        try {
            // 检查已下载部分
            let downloaded = 0;
            if (existsSync(this.outputPath)) {
                downloaded = statSync(this.outputPath).size;
            } else {
                // 确保目录存在
                await mkdir(dirname(this.outputPath), { recursive: true });
            }

            // 获取总大小
            const headResp = await axios.head(this.url);
            this.totalSize = Number.parseInt(headResp.headers['content-length'], 10);
            if (Number.isNaN(this.totalSize)) {
                throw new Error('无法获取文件大小');
            }
            this.downloadedSize = downloaded;
            this.lastUpdateTime = Date.now();
            this.lastDownloadedSize = downloaded;
            this.speedSamples = [];

            if (this.downloadedSize >= this.totalSize) {
                logger.info('文件已下载完成');
                this.isDownloading = false;
                return;
            }

            // 断点续传
            const response = await axios({
                method: 'GET',
                url: this.url,
                responseType: 'stream',
                headers: {
                    Range: `bytes=${this.downloadedSize}-`,
                },
                signal: this.abortController?.signal,
                timeout: 30000,
                decompress: true,
            });

            const writeStream = createWriteStream(this.outputPath, { flags: 'a' });
            response.data.on('data', (chunk: Buffer) => {
                this.downloadedSize += chunk.length;
                let percent = Number(((this.downloadedSize / this.totalSize) * 100).toFixed(2));
                percent = Math.max(0, Math.min(100, percent));
                const speed = this.calculateSpeed();
                const eta = speed > 0 ? Math.ceil((this.totalSize - this.downloadedSize) / speed) : 0;
                const progress: DownloadProgress = {
                    transferred: this.downloadedSize,
                    total: this.totalSize,
                    speed,
                    progress: percent,
                    eta,
                };
                this.onProgress?.(progress);
            });
            await new Promise<void>((resolve, reject) => {
                response.data.pipe(writeStream);
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
                response.data.on('error', reject);
            });
        } finally {
            this.isDownloading = false;
        }
    }

    public stop(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = new AbortController();
        }
    }
}
