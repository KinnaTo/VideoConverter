import { EventEmitter } from 'node:events';
import type { Task, TaskError } from '@/types/task';
import { WaitingState, ConvertingState, UploadingState } from './TaskStates';
import logger from '@/utils/logger';
import { TaskStatus } from '@/types/task';
import { TaskStage } from './TaskQueue';

/**
 * 任务状态接口
 */
export interface TaskState {
    /**
     * 处理当前状态下的任务
     * @param task 任务对象
     * @param context 任务处理上下文
     * @returns 下一个状态，如果返回null则表示处理完成
     */
    process(task: Task, context: TaskContext): Promise<TaskState | null>;

    /**
     * 获取当前状态名称
     */
    getName(): string;
}

/**
 * 任务处理上下文，用于在不同状态间共享数据
 */
export interface TaskContext {
    /**
     * 发送进度更新
     */
    emitProgress(stage: string, info: Record<string, unknown>): void;

    /**
     * 获取工作目录
     */
    getWorkDir(): string;

    /**
     * 获取API客户端
     */
    getApiClient(): any;
}

/**
 * 任务处理器基类
 */
export class TaskProcessor extends EventEmitter {
    private workDir: string;
    private apiClient: any;
    private stage: TaskStage;

    constructor(workDir: string, apiClient: any, stage: TaskStage = TaskStage.DOWNLOAD) {
        super();
        this.workDir = workDir;
        this.apiClient = apiClient;
        this.stage = stage;
    }

    /**
     * 处理任务
     * @param task 任务对象
     */
    async process(task: Task): Promise<void> {
        try {
            logger.info(`TaskProcessor[${this.stage}] starting to process task ${task.id}`);
            logger.info(`Task initial state: ${JSON.stringify({
                id: task.id,
                status: task.status,
                hasDownloadInfo: !!task.downloadInfo,
                hasDownloadPath: !!(task as any).downloadedFilePath,
                downloadPath: (task as any).downloadedFilePath,
                downloadInfoPath: task.downloadInfo?.filePath
            })}`);

            // 根据阶段选择起始状态
            let initialState: TaskState;
            switch (this.stage) {
                case TaskStage.DOWNLOAD:
                    initialState = new WaitingState();
                    break;
                case TaskStage.CONVERT:
                    initialState = new ConvertingState();
                    break;
                case TaskStage.UPLOAD:
                    initialState = new UploadingState();
                    break;
                default:
                    initialState = new WaitingState();
            }

            // 创建任务上下文
            const context: TaskContext = {
                emitProgress: this.emitProgress.bind(this),
                getWorkDir: () => this.workDir,
                getApiClient: () => this.apiClient
            };

            // 处理当前阶段
            const stateName = initialState.getName();
            this.emit('stateChange', stateName);
            logger.info(`Processing task ${task.id} in state: ${stateName}`);

            try {
                await initialState.process(task, context);

                // 记录处理后的任务状态
                logger.info(`TaskProcessor[${this.stage}] completed processing task ${task.id}`);
                logger.info(`Task final state: ${JSON.stringify({
                    id: task.id,
                    status: task.status,
                    hasDownloadInfo: !!task.downloadInfo,
                    hasDownloadPath: !!(task as any).downloadedFilePath,
                    downloadPath: (task as any).downloadedFilePath,
                    downloadInfoPath: task.downloadInfo?.filePath,
                    hasConvertedPath: !!(task as any).convertedFilePath,
                    convertedPath: (task as any).convertedFilePath
                })}`);

                // 阶段处理完成
                this.emit('complete', task);
            } catch (error) {
                // 记录错误时的任务状态
                logger.error(`TaskProcessor[${this.stage}] failed processing task ${task.id}: ${error}`);
                logger.error(`Task error state: ${JSON.stringify({
                    id: task.id,
                    status: task.status,
                    hasDownloadInfo: !!task.downloadInfo,
                    hasDownloadPath: !!(task as any).downloadedFilePath,
                    downloadPath: (task as any).downloadedFilePath,
                    downloadInfoPath: task.downloadInfo?.filePath,
                    error: error instanceof Error ? error.message : String(error)
                })}`);

                // 阶段处理出错
                this.emit('error', { task, error });
            }
        } catch (error) {
            // 这里捕获其他未预期的错误
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Unexpected error in task processing: ${errorMessage}`);

            // 确保任务被标记为失败
            task.status = TaskStatus.FAILED;
            task.error = {
                message: errorMessage,
                code: 'UNEXPECTED_ERROR'
            };

            this.emit('error', { task, error });
        }
    }

    /**
     * 发送进度更新
     */
    private emitProgress(stage: string, info: Record<string, unknown>): void {
        this.emit('progress', { stage, info });
    }
} 