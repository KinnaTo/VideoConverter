import logger from '@/utils/logger';

/**
 * 任务状态管理器 - 用于在不同阶段之间传递数据
 */
export class TaskStateManager {
    private states: Map<string, Record<string, any>> = new Map();

    /**
     * 设置任务状态数据
     * @param taskId 任务ID
     * @param data 状态数据
     */
    set(taskId: string, data: Record<string, any>): void {
        this.states.set(taskId, { ...this.states.get(taskId) || {}, ...data });
        logger.debug(`Updated state for task ${taskId}: ${JSON.stringify(this.states.get(taskId))}`);
    }

    /**
     * 获取任务状态数据
     * @param taskId 任务ID
     */
    get(taskId: string): Record<string, any> | undefined {
        return this.states.get(taskId);
    }

    /**
     * 删除任务状态数据
     * @param taskId 任务ID
     */
    delete(taskId: string): void {
        this.states.delete(taskId);
        logger.debug(`Cleared state for task ${taskId}`);
    }

    /**
     * 检查任务是否有特定状态数据
     * @param taskId 任务ID
     * @param key 状态数据键
     */
    has(taskId: string, key: string): boolean {
        const state = this.states.get(taskId);
        return !!state && key in state;
    }
} 