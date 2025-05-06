export enum TaskStatus {
    WAITING = 'WAITING',
    DOWNLOADING = 'DOWNLOADING',
    CONVERTING = 'CONVERTING',
    UPLOADING = 'UPLOADING',
    FINISHED = 'FINISHED',
    FAILED = 'FAILED',
}

export interface MinioConfig {
    accessKey: string;
    secretKey: string;
    bucket: string;
    endpoint: string;
}

// 下载信息接口
export interface DownloadInfo {
    // 持久化信息
    startTime: string;
    endTime?: string;
    fileSize?: number;
    averageSpeed?: number;
    sourceUrl: string;
    hash?: string;

    // 运行时状态（处理完成后会被清除）
    status?: 'downloading' | 'completed' | 'failed';
    progress?: number;
    currentSize?: number;
    totalSize?: number;
    currentSpeed?: number;
    eta?: number;
}

// 转换信息接口
export interface ConvertInfo {
    // 持久化信息
    startTime: string;
    endTime?: string;
    inputFormat?: string;
    outputFormat?: string;
    resolution?: {
        width: number;
        height: number;
    };
    bitrate?: number;
    frames?: number;
    fps?: number;
    averageSpeed?: number;
    preset?: string;

    // 运行时状态（处理完成后会被清除）
    status?: 'converting' | 'completed' | 'failed';
    progress?: number;
    currentFrame?: number;
    currentFps?: number;
    currentBitrate?: number;
    eta?: number;
}

// 上传信息接口
export interface UploadInfo {
    // 持久化信息
    startTime: string;
    endTime?: string;
    fileSize?: number;
    averageSpeed?: number;
    targetUrl: string;
    hash?: string;

    // 运行时状态（处理完成后会被清除）
    status?: 'uploading' | 'completed' | 'failed';
    progress?: number;
    currentSize?: number;
    totalSize?: number;
    currentSpeed?: number;
    eta?: number;
}

// 最终结果接口（只包含整体任务的汇总信息）
export interface TaskResult {
    totalDuration: number;      // 总处理时间（毫秒）
    compressionRatio: number;   // 压缩比
    status: 'success' | 'failed';
}

export interface TaskError {
    message: string;
    code?: string | number;
    command?: string;
    path?: string;
    tempFiles?: {
        downloadPath?: string;
        transcodePath?: string;
    };
    uploadError?: boolean;
}

export interface Task {
    id: string;
    status: TaskStatus;
    source: string;
    downloadInfo?: DownloadInfo;
    convertInfo?: ConvertInfo;
    uploadInfo?: UploadInfo;
    result?: TaskResult;
    error?: TaskError;
}
