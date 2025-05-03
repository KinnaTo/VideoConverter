export enum TaskStatus {
    WAITING = 'WAITING',
    DOWNLOADING = 'DOWNLOADING',
    RUNNING = 'RUNNING',
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

export interface TaskResult {
    outputPath?: string;
    duration?: number;
    bitrate?: number;
    size?: number;
    resolution?: {
        width: number;
        height: number;
    };
    minioInfo?: {
        bucket: string;
        objectName: string;
        endpoint: string;
    };
    uploadPath?: string;
    uploadTimestamp?: string;
    metadata?: {
        taskId: string;
        duration: number;
        bitrate: number;
        size: number;
        resolution: {
            width: number;
            height: number;
        };
    };
}

export interface TaskError {
    message: string;
    code?: string | number;
    command?: string;
    path?: string;
    transcodeResult?: TaskResult;
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
    progress?: number;
    error?: string;
    result?: TaskResult;
}

export type ProgressType = 'upload' | 'download';

export interface ProgressData {
    type: ProgressType;
    progress: number;
    transferred: number;
    total: number;
    speed: number;
    eta: number;
    timestamp?: string;
}

export interface TaskProgress {
    type: ProgressType;
    progress: number;
    transferred?: number;
    total?: number;
    speed?: number;
    eta?: number;
}
