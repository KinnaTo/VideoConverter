import path from 'node:path';
import axios from 'axios';
import fs from 'fs-extra';
import pRetry from 'p-retry';
import type { TaskProgress } from '../types/task';
import logger from './logger';

interface DownloadChunk {
    start: number;
    end: number;
    downloaded: number;
    tempFile: string;
}

interface DownloadProgress extends TaskProgress {
    transferred: number;
    total: number;
    speed: number;
    eta: number;
}

export class DownloadManager {
    private chunks: DownloadChunk[] = [];
    private totalSize = 0;
    private downloadedSize = 0;
    private isDownloading = false;
    private abortController: AbortController | null = null;
    private lastUpdateTime = 0;
    private lastDownloadedSize = 0;
    private speedSamples: number[] = [];
    private readonly CHUNK_SIZE = 5 * 1024 * 1024; // 5MB per chunk
    private readonly MAX_CONCURRENT_CHUNKS = 8; // 最大并发下载数

    constructor(
        private url: string,
        private outputPath: string,
        private onProgress?: (progress: DownloadProgress) => void,
        private numChunks = 8, // 默认8个分片
    ) {
        this.abortController = new AbortController();
    }

    private async getFileSize(): Promise<number> {
        const response = await axios.head(this.url);
        const size = Number.parseInt(response.headers['content-length'], 10);
        if (Number.isNaN(size)) {
            throw new Error('无法获取文件大小');
        }
        return size;
    }

    private async initChunks() {
        this.totalSize = await this.getFileSize();

        // 根据文件大小动态调整分片数量
        const recommendedChunks = Math.ceil(this.totalSize / this.CHUNK_SIZE);
        this.numChunks = Math.min(Math.max(recommendedChunks, this.numChunks), 32); // 最多32个分片

        const chunkSize = Math.ceil(this.totalSize / this.numChunks);

        for (let i = 0; i < this.numChunks; i++) {
            const start = i * chunkSize;
            const end = i === this.numChunks - 1 ? this.totalSize - 1 : start + chunkSize - 1;
            const tempFile = path.join(path.dirname(this.outputPath), `${path.basename(this.outputPath)}.part${i}`);

            // 检查是否存在未完成的下载
            let downloaded = 0;
            if (await fs.pathExists(tempFile)) {
                const stat = await fs.stat(tempFile);
                downloaded = stat.size;
                this.downloadedSize += downloaded;
            }

            this.chunks.push({
                start,
                end,
                downloaded,
                tempFile,
            });
        }
    }

    private calculateSpeed(): number {
        const now = Date.now();
        const timeDiff = (now - this.lastUpdateTime) / 1000; // 转换为秒
        const sizeDiff = this.downloadedSize - this.lastDownloadedSize;

        if (timeDiff > 0) {
            const currentSpeed = sizeDiff / timeDiff;
            this.speedSamples.push(currentSpeed);

            // 保持最近5个样本
            if (this.speedSamples.length > 5) {
                this.speedSamples.shift();
            }

            // 计算平均速度
            const avgSpeed = this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length;

            this.lastUpdateTime = now;
            this.lastDownloadedSize = this.downloadedSize;

            return avgSpeed;
        }

        return 0;
    }

    private calculateEta(speed: number): number {
        if (speed <= 0) return 0;
        const remainingBytes = this.totalSize - this.downloadedSize;
        return Math.ceil(remainingBytes / speed);
    }

    private async downloadChunk(chunk: DownloadChunk): Promise<void> {
        return pRetry(
            async () => {
                const response = await axios({
                    method: 'GET',
                    url: this.url,
                    headers: {
                        Range: `bytes=${chunk.start + chunk.downloaded}-${chunk.end}`,
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    },
                    responseType: 'stream',
                    signal: this.abortController?.signal,
                    timeout: 30000, // 30秒超时
                    maxContentLength: Number.POSITIVE_INFINITY,
                    maxBodyLength: Number.POSITIVE_INFINITY,
                    decompress: true, // 启用压缩
                });

                const writeStream = fs.createWriteStream(chunk.tempFile, {
                    flags: 'a',
                    highWaterMark: 1024 * 1024, // 1MB buffer
                });
                let chunkDownloaded = chunk.downloaded;

                return new Promise<void>((resolve, reject) => {
                    response.data.on('data', (chunk: Buffer) => {
                        chunkDownloaded += chunk.length;
                        this.downloadedSize += chunk.length;

                        const speed = this.calculateSpeed();
                        const progress: DownloadProgress = {
                            type: 'download',
                            progress: Number(((this.downloadedSize / this.totalSize) * 100).toFixed(2)),
                            transferred: this.downloadedSize,
                            total: this.totalSize,
                            speed,
                            eta: this.calculateEta(speed),
                        };

                        this.onProgress?.(progress);
                    });

                    response.data.pipe(writeStream);

                    writeStream.on('finish', () => {
                        chunk.downloaded = chunkDownloaded;
                        resolve();
                    });

                    writeStream.on('error', reject);
                    response.data.on('error', reject);
                });
            },
            {
                retries: 5, // 增加重试次数
                onFailedAttempt: (error: Error) => {
                    logger.warn(`下载分片失败，重试中... 错误: ${error.message}`);
                },
            },
        );
    }

    private async mergeChunks(): Promise<void> {
        const writeStream = fs.createWriteStream(this.outputPath);

        for (const chunk of this.chunks) {
            if (await fs.pathExists(chunk.tempFile)) {
                await fs.createReadStream(chunk.tempFile).pipe(writeStream);
                await fs.remove(chunk.tempFile);
            }
        }
    }

    public async start(): Promise<void> {
        if (this.isDownloading) {
            throw new Error('下载已在进行中');
        }

        this.isDownloading = true;
        await this.initChunks();

        try {
            // 使用Promise.all和分组来控制并发数
            const chunksGroups = [];
            for (let i = 0; i < this.chunks.length; i += this.MAX_CONCURRENT_CHUNKS) {
                chunksGroups.push(this.chunks.slice(i, i + this.MAX_CONCURRENT_CHUNKS));
            }

            for (const group of chunksGroups) {
                await Promise.all(group.map((chunk) => this.downloadChunk(chunk)));
            }

            await this.mergeChunks();
        } finally {
            this.isDownloading = false;
            this.chunks = [];
            this.downloadedSize = 0;
        }
    }

    public stop(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = new AbortController();
        }
    }
}
