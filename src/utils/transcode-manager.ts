import path from 'node:path';
import * as ffmpeg from 'fluent-ffmpeg';
import fs from 'fs-extra';
import logger from './logger';

interface TranscodeOptions {
    width: number;
    height: number;
    maxBitrate: number;
    maxFileSize: number;
}

interface TranscodeResult {
    duration: number;
    bitrate: number;
}

export class TranscodeManager {
    private process: ffmpeg.FfmpegCommand | null = null;
    private isCancelled = false;

    constructor(
        private inputPath: string,
        private outputPath: string,
        private options: TranscodeOptions = {
            width: 1920,
            height: 1080,
            maxBitrate: 1500000, // 1.5Mbps
            maxFileSize: 3.8 * 1024 * 1024 * 1024, // 3.8GB
        },
        private onProgress?: (progress: number) => void,
    ) { }

    private async getVideoDuration(): Promise<number> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(this.inputPath, (err: Error | null, metadata: ffmpeg.FfprobeData) => {
                if (err) reject(err);
                else resolve(metadata.format.duration || 0);
            });
        });
    }

    private async calculateBitrate(): Promise<number> {
        const duration = await this.getVideoDuration();
        // 预估文件大小 = 比特率 * 时长 / 8 (转换为字节)
        // 解方程：maxFileSize = bitrate * duration / 8
        const maxBitrate = Math.floor((this.options.maxFileSize * 8) / duration);
        return Math.min(maxBitrate, this.options.maxBitrate);
    }

    public async start(): Promise<TranscodeResult> {
        if (this.process) {
            throw new Error('转码已在进行中');
        }

        const bitrate = await this.calculateBitrate();
        const duration = await this.getVideoDuration();
        logger.info(`计算得到的目标码率: ${bitrate / 1000}Kbps`);

        return new Promise((resolve, reject) => {
            this.process = ffmpeg(this.inputPath)
                .outputOptions([
                    '-c:v h264_nvenc', // 使用NVENC编码器
                    '-preset p7', // 最高质量预设
                    '-tune hq', // 高质量调优
                    '-rc:v vbr', // 可变比特率
                    `-b:v ${bitrate}`, // 目标比特率
                    `-maxrate ${bitrate * 1.5}`, // 最大比特率
                    `-bufsize ${bitrate * 2}`, // 缓冲区大小
                    '-profile:v high', // 高规格
                    '-level:v 4.1',
                    '-c:a aac', // 音频编码器
                    '-b:a 128k', // 音频比特率
                    '-movflags +faststart', // 快速启动
                    '-y', // 覆盖输出文件
                ])
                .size(`${this.options.width}x${this.options.height}`)
                .on('progress', (progress: { percent: number }) => {
                    if (!this.isCancelled) {
                        this.onProgress?.(Math.floor(progress.percent));
                    }
                })
                .on('end', () => {
                    this.process = null;
                    resolve({ duration, bitrate });
                })
                .on('error', (err: Error) => {
                    this.process = null;
                    reject(err);
                });

            // 开始转码
            this.process.save(this.outputPath);
        });
    }

    public stop(): void {
        if (this.process) {
            this.isCancelled = true;
            this.process.kill('SIGKILL');
            this.process = null;
        }
    }
}
