declare module 'fluent-ffmpeg' {
    namespace ffmpeg {
        interface FfmpegCommand {
            outputOptions(options: string[]): this;
            size(size: string): this;
            on(event: 'progress', callback: (progress: { percent: number }) => void): this;
            on(event: 'end', callback: () => void): this;
            on(event: 'error', callback: (err: Error) => void): this;
            save(outputPath: string): this;
            kill(signal: string): void;
        }

        interface FfprobeData {
            format: {
                duration?: number;
            };
        }

        function ffprobe(path: string, callback: (err: Error | null, data: FfprobeData) => void): void;
    }

    function ffmpeg(input?: string): ffmpeg.FfmpegCommand;
    export = ffmpeg;
}
