import type { ConvertInfo } from '@/types/task';
import ffmpeg from 'fluent-ffmpeg';
import fsExtra from 'fs-extra';

export default class Converter {
    private inputPath: string;
    private outputPath: string;

    public convertInfo: ConvertInfo | null = null;

    constructor(inputPath: string, outputPath: string) {
        this.inputPath = inputPath;
        this.outputPath = outputPath;

        if (!fsExtra.pathExistsSync(inputPath)) {
            throw new Error(`Input file ${inputPath} does not exist`);
        }

        fsExtra.ensureDirSync(outputPath);
    }

    async convert(onProgress?: (info: ConvertInfo) => void) {
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
        }

        const startTimestamp = Date.now();
        this.convertInfo = {
            startTime: new Date(startTimestamp).toISOString(),
            progress: 0,
        };

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
                    resolve();
                })
                .on('error', err => {
                    reject(err);
                })
                .output(this.outputPath)
                .run();
        });
    }
}