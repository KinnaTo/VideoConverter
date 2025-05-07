// 视频编码器选项
export type VideoCodec = 'h264_nvenc' | 'hevc_nvenc' | 'copy';

// 音频编码器选项
export type AudioCodec = 'aac' | 'copy';

// 视频质量预设
export type PresetType =
    | 'p1' // slowest
    | 'p2' // slower
    | 'p3' // slow
    | 'p4' // medium
    | 'p5' // fast
    | 'p6' // faster
    | 'p7' // fastest
    | 'slow'
    | 'medium'
    | 'fast';

export type Resolution = '1080p' | '720p' | '480p' | '360p' | '240p' | '144p';

export type ConvertParams = {
    codec: VideoCodec;
    audioCodec: AudioCodec;
    preset: PresetType;
    resolution: Resolution;
};
