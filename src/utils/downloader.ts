import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import logger from './logger';

interface DownloadChunk {
    start: number;
    end: number;
    downloaded: number;
    completed: boolean;
}

interface DownloadState {
    url: string;
    fileSize: number;
    chunks: DownloadChunk[];
    tempDir: string;
    attempts: number;
}

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_CONCURRENT_CHUNKS = 3; // 同时下载的分片数
const MAX_RETRIES = 3; // 最大重试次数
const RETRY_DELAY = 1000; // 重试延迟（毫秒）

export async function download(url: string, outputPath: string, onProgress?: (progress: number) => void): Promise<void> {
    try {
        // 创建临时目录
        const tempDir = join(dirname(outputPath), '.temp', Buffer.from(url).toString('base64').slice(0, 32));
        await mkdir(tempDir, { recursive: true });

        // 尝试加载已有的下载状态
        const statePath = join(tempDir, 'state.json');
        let state: DownloadState | undefined;

        if (existsSync(statePath)) {
            try {
                const stateData = await readFile(statePath, 'utf-8');
                const loadedState = JSON.parse(stateData) as DownloadState;
                if (loadedState.url === url) {
                    state = loadedState;
                }
            } catch (error) {
                logger.warn(`Failed to load download state: ${error}`);
            }
        }

        // 如果没有状态或状态无效，创建新的状态
        if (!state) {
            const response = await fetch(url, { method: 'HEAD' });
            if (!response.ok) {
                throw new Error(`Failed to get file size: ${response.statusText}`);
            }

            const fileSize = Number.parseInt(response.headers.get('content-length') || '0', 10);
            if (!fileSize) {
                throw new Error('Invalid file size');
            }

            // 计算分片
            const chunks: DownloadChunk[] = [];
            for (let start = 0; start < fileSize; start += CHUNK_SIZE) {
                const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
                chunks.push({
                    start,
                    end,
                    downloaded: 0,
                    completed: false,
                });
            }

            state = {
                url,
                fileSize,
                chunks,
                tempDir,
                attempts: 0,
            };
        }

        // 保存状态
        await saveState(state, statePath);

        // 开始下载
        let isDownloading = true;
        const updateProgressInterval = setInterval(() => {
            if (isDownloading && state) {
                const progress = calculateProgress(state);
                onProgress?.(progress);
            }
        }, 1000);

        try {
            await downloadChunks(state, onProgress);

            // 合并文件
            await mergeChunks(state, outputPath);

            // 清理临时文件
            // await rm(tempDir, { recursive: true, force: true });

            logger.info(`Download completed: ${outputPath}`);
        } finally {
            isDownloading = false;
            clearInterval(updateProgressInterval);
        }
    } catch (error) {
        logger.error(`Download failed: ${error}`);
        throw error;
    }
}

async function downloadChunks(state: DownloadState, onProgress?: (progress: number) => void): Promise<void> {
    const { chunks } = state;
    const incompletedChunks = chunks.filter((chunk) => !chunk.completed);

    // 分批下载
    for (let i = 0; i < incompletedChunks.length; i += MAX_CONCURRENT_CHUNKS) {
        const batch = incompletedChunks.slice(i, i + MAX_CONCURRENT_CHUNKS);
        await Promise.all(batch.map((chunk) => downloadChunk(state, chunk)));

        // 更新进度
        const progress = calculateProgress(state);
        onProgress?.(progress);

        // 保存状态
        await saveState(state, join(state.tempDir, 'state.json'));
    }
}

async function downloadChunk(state: DownloadState, chunk: DownloadChunk): Promise<void> {
    const chunkPath = join(state.tempDir, `chunk_${chunk.start}`);
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
        try {
            // 如果分片文件已存在且大小正确，跳过下载
            if (existsSync(chunkPath)) {
                const stats = statSync(chunkPath);
                if (stats.size === chunk.end - chunk.start + 1) {
                    chunk.downloaded = stats.size;
                    chunk.completed = true;
                    return;
                }
            }

            const response = await fetch(state.url, {
                headers: {
                    Range: `bytes=${chunk.start + chunk.downloaded}-${chunk.end}`,
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            if (!response.body) {
                throw new Error('No response body');
            }

            const fileStream = createWriteStream(chunkPath, { flags: 'a' });
            const reader = response.body.getReader();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    chunk.downloaded += value.length;
                    await new Promise<void>((resolve, reject) => {
                        fileStream.write(value, (error: Error | null | undefined) => {
                            if (error) reject(error);
                            else resolve();
                        });
                    });
                }
            } finally {
                reader.releaseLock();
                await new Promise<void>((resolve, reject) => {
                    fileStream.end((error: Error | null | undefined) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });
            }

            chunk.completed = true;
            return;
        } catch (error) {
            attempts++;
            logger.warn(`Chunk download failed (attempt ${attempts}): ${error}`);
            if (attempts < MAX_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
            } else {
                throw error;
            }
        }
    }
}

async function mergeChunks(state: DownloadState, outputPath: string): Promise<void> {
    const { chunks } = state;
    const outputStream = createWriteStream(outputPath);

    try {
        for (const chunk of chunks) {
            const chunkPath = join(state.tempDir, `chunk_${chunk.start}`);
            const chunkData = await readFile(chunkPath);
            await new Promise<void>((resolve, reject) => {
                outputStream.write(chunkData, (error: Error | null | undefined) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        }
    } finally {
        await new Promise<void>((resolve, reject) => {
            outputStream.end((error: Error | null | undefined) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }
}

async function saveState(state: DownloadState, statePath: string): Promise<void> {
    await writeFile(statePath, JSON.stringify(state, null, 2));
}

function calculateProgress(state: DownloadState): number {
    const totalDownloaded = state.chunks.reduce((sum, chunk) => sum + chunk.downloaded, 0);
    return Math.round((totalDownloaded / state.fileSize) * 100);
}
