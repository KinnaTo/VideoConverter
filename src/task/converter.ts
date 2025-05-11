import type { ConvertInfo } from '@/types/task';
import ffmpeg from 'fluent-ffmpeg';
import fsExtra from 'fs-extra';
import path from 'path';
import fs from 'fs';
import logger from '@/utils/logger';

export default class Converter {
    private inputPath: string;
    private outputPath: string;

    public convertInfo: ConvertInfo | null = null;

    constructor(inputPath: string, outputPath: string) {
        this.inputPath = inputPath;
        this.outputPath = outputPath;

        // 检查输入文件是否存在
        if (!fsExtra.pathExistsSync(inputPath)) {
            throw new Error(`Input file ${inputPath} does not exist`);
        }

        // 确保输出文件的父目录存在
        const outputDir = path.dirname(outputPath);
        fsExtra.ensureDirSync(outputDir);

        // 如果输出文件已存在，先删除它
        if (fs.existsSync(outputPath)) {
            try {
                fs.unlinkSync(outputPath);
                logger.info(`Removed existing output file: ${outputPath}`);
            } catch (error) {
                logger.warn(`Failed to delete existing output file: ${error}`);
            }
        }

        logger.info(`Converter initialized with input: ${inputPath}, output: ${outputPath}`);
    }

    async convert(onProgress?: (info: ConvertInfo) => void) {
        try {
            // 1. 获取输入视频信息
            const getVideoInfo = () => new Promise<{ duration: number }>((resolve, reject) => {
                ffmpeg.ffprobe(this.inputPath, (err, metadata) => {
                    if (err) return reject(err);
                    const duration = metadata.format.duration;
                    if (!duration) return reject(new Error('无法获取视频时长'));
                    resolve({ duration });
                });
            });

            const { duration } = await getVideoInfo();
            logger.info(`Video duration: ${duration} seconds`);

            const maxSize = 3_800_000_000; // 3.8GB
            const audioBitrate = 192 * 1000; // 192kbps
            let videoBitrate = 1500 * 1000; // 默认1500kbps
            let totalBitrate = videoBitrate + audioBitrate;
            let estimatedSize = duration * totalBitrate / 8; // 字节

            // 2. 如果超限，自动调整视频码率
            if (estimatedSize > maxSize) {
                // 计算最大允许总码率
                const maxTotalBitrate = (maxSize * 8) / duration;
                // 分配给视频的码率
                videoBitrate = Math.max(100 * 1000, maxTotalBitrate - audioBitrate); // 最低100kbps
                totalBitrate = videoBitrate + audioBitrate;
                logger.info(`Adjusted video bitrate to ${videoBitrate / 1000} kbps to fit size limit`);
            }

            const startTimestamp = Date.now();
            this.convertInfo = {
                startTime: new Date(startTimestamp).toISOString(),
                progress: 0,
            };

            logger.info(`Starting conversion with video bitrate: ${videoBitrate / 1000} kbps, audio bitrate: ${audioBitrate / 1000} kbps`);

            // 3. 开始转换
            return new Promise<void>((resolve, reject) => {
                ffmpeg(this.inputPath)
                    .videoCodec('h264_nvenc')
                    .audioCodec('aac')
                    .audioBitrate(audioBitrate / 1000) // 单位为kbps
                    .videoBitrate(Math.floor(videoBitrate / 1000)) // 单位为kbps
                    .size('1920x1080')
                    .outputOptions('-preset fast')
                    .on('progress', (progress) => {
                        const elapsed = (Date.now() - startTimestamp) / 1000;
                        const percent = progress.percent ?? 0;
                        const eta = percent > 0 ? elapsed * (100 - percent) / percent : 0;
                        this.convertInfo = {
                            ...this.convertInfo!,
                            progress: percent,
                            currentFps: progress.currentFps ?? 0,
                            currentBitrate: progress.currentKbps ?? 0,
                            eta,
                        };
                        if (onProgress && this.convertInfo) onProgress(this.convertInfo);
                    })
                    .on('end', () => {
                        const endTime = Date.now();
                        const duration = (endTime - startTimestamp) / 1000;
                        this.convertInfo = {
                            ...this.convertInfo!,
                            endTime: new Date(endTime).toISOString(),
                            progress: 100,
                            eta: 0,
                            averageSpeed: duration > 0 ? 100 / duration : 0,
                        };
                        if (onProgress && this.convertInfo) onProgress(this.convertInfo);

                        // 检查输出文件是否存在
                        if (!fs.existsSync(this.outputPath)) {
                            return reject(new Error(`Conversion completed but output file not found: ${this.outputPath}`));
                        }

                        logger.info(`Conversion completed: ${this.outputPath}`);
                        resolve();
                    })
                    .on('error', (err) => {
                        logger.error(`FFmpeg error: ${err.message}`);

                        // 如果输出文件已部分创建，尝试删除它
                        if (fs.existsSync(this.outputPath)) {
                            try {
                                fs.unlinkSync(this.outputPath);
                                logger.info(`Removed incomplete output file: ${this.outputPath}`);
                            } catch (unlinkError) {
                                logger.error(`Failed to remove incomplete output file: ${unlinkError}`);
                            }
                        }

                        reject(err);
                    })
                    .output(this.outputPath)
                    .run();
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Conversion error: ${errorMessage}`);

            // 如果输出文件已部分创建，尝试删除它
            if (fs.existsSync(this.outputPath)) {
                try {
                    fs.unlinkSync(this.outputPath);
                    logger.info(`Removed incomplete output file: ${this.outputPath}`);
                } catch (unlinkError) {
                    logger.error(`Failed to remove incomplete output file: ${unlinkError}`);
                }
            }

            throw error;
        }
    }
}