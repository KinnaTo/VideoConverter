import ffmpeg from 'fluent-ffmpeg';
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

// 新增：转码进度接口
export interface TranscodeProgress {
    frames: number;
    currentFps: number;
    currentKbps: number;
    targetSize: number;
    timemark: string;
    percent: number;
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
        // 修改回调函数类型
        private onProgress?: (progress: TranscodeProgress) => void,
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

    public async start(): Promise<TranscodeResult & { ffmpegCommand?: string; ffmpegOutput?: string; stdErr?: string }> {
        if (this.process) {
            throw new Error('转码已在进行中');
        }

        const bitrate = await this.calculateBitrate();
        const duration = await this.getVideoDuration();
        logger.info(`计算得到的目标码率: ${bitrate / 1000}Kbps`);

        let stdErr = '';
        let ffmpegOutput = '';

        return new Promise((resolve, reject) => {
            this.process = ffmpeg(this.inputPath)
                .outputOptions([
                    '-c:v h264_nvenc', // 使用NVENC编码器
                    '-preset fast', // 兼容性更好的预设
                    // '-tune hq', // 高质量调优
                    '-rc:v vbr', // 可变比特率
                    `-b:v ${bitrate}`, // 目标比特率
                    `-maxrate ${bitrate * 1.5}`, // 最大比特率
                    `-bufsize ${bitrate * 2}`, // 缓冲区大小
                    '-preset fast', // 兼容性更好的预设
                    // '-profile:v fast', // 高规格
                    // '-level:v 4.1',
                    '-c:a aac', // 音频编码器
                    '-b:a 128k', // 音频比特率
                    '-movflags +faststart', // 快速启动
                    '-y', // 覆盖输出文件
                ])
                .size(`${this.options.width}x${this.options.height}`)
                .on('start', (commandLine: string) => {
                    logger.info('开始转码');
                    logger.info(commandLine);
                    ffmpegOutput = commandLine;
                })
                .on('progress', (progress) => {
                    logger.info(progress);

                    // 计算百分比进度
                    const percent = progress.percent || 0;

                    // 构建转码进度对象，包含所有需要的详情
                    const transcodeProgress: TranscodeProgress = {
                        frames: progress.frames || 0,
                        currentFps: progress.currentFps || 0,
                        currentKbps: progress.currentKbps || 0,
                        targetSize: progress.targetSize || 0,
                        timemark: progress.timemark || '00:00:00.00',
                        percent: percent,
                    };

                    // 回调通知
                    if (this.onProgress) {
                        this.onProgress(transcodeProgress);
                    }
                })
                .on('stderr', (line: string) => {
                    if (line.startsWith('frame=')) {
                        return
                    }
                    logger.error(line);
                    stdErr += line + '\n';
                })
                .on('error', (err: Error & { stdout?: string; stderr?: string }) => {
                    this.process = null;
                    logger.error('转码失败:', {
                        error: err.message,
                        stdout: err.stdout,
                        stderr: err.stderr,
                        command: ffmpegOutput
                    });
                    reject({
                        error: err,
                        ffmpegOutput,
                        stdErr: err.stderr || stdErr,
                        command: ffmpegOutput
                    });
                })
                .on('end', () => {
                    this.process = null;
                    resolve({ duration, bitrate, ffmpegOutput, stdErr });
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
