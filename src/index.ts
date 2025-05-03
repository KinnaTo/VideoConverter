import { getSystemInfo } from './utils/system-info';
import config from './utils/init';
import api from './utils/api';
import logger from './utils/logger';
// import type { Task } from '@prisma/client';

const { BASE_URL, HOSTNAME, ENCODER } = process.env;

if (!BASE_URL || !HOSTNAME || !ENCODER) {
    logger.error('缺少环境变量 BASE_URL, HOSTNAME 或 ENCODER');
    process.exit(1);
}

try {
    await api.post(`/runner/online`, { id: config.id });
    logger.info('Runner 已上线');
} catch (error: any) {
    logger.error(`${error.message}`);
}

const heartbeat = async () => {
    try {
        const { systemInfo: deviceInfo, encoder } = await getSystemInfo();
        await api.post(`/runner/heartbeat`, {
            id: config.id,
            deviceInfo,
            encoder: encoder
        });
    } catch (error: any) {
        logger.error(`Heartbeat failed: ${error.message}${error.response?.data ? ` - ${JSON.stringify(error.response.data)}` : ''}`);
    }
};

heartbeat();
setInterval(heartbeat, 1000 * 20);

let currentTask: any | null = null;
let taskIntervalId: Timer | null = null;

// 实际任务执行逻辑占位符
async function runActualTaskLogic(task: any): Promise<{ result?: any; error?: any }> {
    logger.info(`[任务 ${task.id}] 开始执行模拟任务...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    if (Math.random() > 0.2) {
        logger.info(`[任务 ${task.id}] 模拟执行成功.`);
        return { result: { message: `任务由 ${config.id} 成功完成` } };
    } else {
        logger.warn(`[任务 ${task.id}] 模拟执行失败.`);
        return { error: `在 ${config.id} 上模拟任务失败` };
    }
}

async function executeTask(task: any) {
    logger.info(`[任务 ${task.id}] 开始处理.`);
    try {
        await api.post(`/runner/${task.id}/start`);
        logger.info(`[任务 ${task.id}] 已标记为开始.`);

        const { result, error } = await runActualTaskLogic(task);

        if (error) {
            logger.warn(`[任务 ${task.id}] 报告失败: ${JSON.stringify(error)}`);
            await api.post(`/runner/${task.id}/fail`, { error });
            logger.info(`[任务 ${task.id}] 已标记为失败.`);
        } else {
            logger.info(`[任务 ${task.id}] 报告完成: ${JSON.stringify(result)}`);
            await api.post(`/runner/${task.id}/complete`, { result });
            logger.info(`[任务 ${task.id}] 已标记为完成.`);
        }

    } catch (execError: any) {
        logger.error(`[任务 ${task.id}] 执行或报告时发生严重错误: ${execError.message}${execError.response?.data ? ` - ${JSON.stringify(execError.response.data)}` : ''}`);
        try {
            const failPayload = { error: `严重执行错误: ${execError.message}` };
            await api.post(`/runner/${task.id}/fail`, failPayload);
            logger.info(`[任务 ${task.id}] 因严重错误标记为失败.`);
        } catch (failError: any) {
            logger.error(`[任务 ${task.id}] 标记任务失败时再次出错: ${failError.message}${failError.response?.data ? ` - ${JSON.stringify(failError.response.data)}` : ''}`);
        }
    } finally {
        logger.info(`[任务 ${task.id}] 处理结束.`);
        currentTask = null;
        fetchAndProcessTask(); // 立即尝试获取下一个
    }
}

async function fetchAndProcessTask() {
    if (currentTask) {
        return; // 正在处理任务，跳过
    }

    logger.info('尝试获取新任务...');
    try {
        const taskRes = await api.get<{ task?: any; message?: string }>(`/runner/getTask`);

        if (taskRes.data.task) {
            const newTask = taskRes.data.task;
            logger.info(`获取到新任务: ${newTask.id}`);
            currentTask = newTask;
            if (taskIntervalId) {
                clearInterval(taskIntervalId);
                taskIntervalId = null;
                // logger.info('已停止空闲任务获取定时器。'); // Removed log
            }
            executeTask(newTask);
        } else {
            logger.info('当前无可用任务.');
            if (!taskIntervalId) {
                // logger.info('启动空闲任务获取定时器 (10秒).'); // Removed log
                taskIntervalId = setInterval(fetchAndProcessTask, 1000 * 10);
            }
        }
    } catch (error: any) {
        logger.error(`获取任务失败: ${error.message}${error.response?.data ? ` - ${JSON.stringify(error.response.data)}` : ''}`);
        if (!taskIntervalId) {
            // logger.info('因获取错误启动空闲任务获取定时器 (10秒).'); // Removed log
            taskIntervalId = setInterval(fetchAndProcessTask, 1000 * 10);
        }
    }
}

fetchAndProcessTask();