import { taskManager } from './services/task-manager';
import type { Task } from './types/task';
import api from './utils/api';
import config from './utils/init';
import logger from './utils/logger';
import { getSystemInfo } from './utils/system-info';

const { BASE_URL, HOSTNAME, ENCODER } = process.env;

if (!BASE_URL || !HOSTNAME || !ENCODER) {
    logger.error('缺少环境变量 BASE_URL, HOSTNAME 或 ENCODER');
    process.exit(1);
}

try {
    await api.post('/runner/online', { id: config.id });
    logger.info('Runner 已上线');
} catch (error: any) {
    logger.error(`${error.message}`);
}

const heartbeat = async () => {
    try {
        const { systemInfo: deviceInfo, encoder } = await getSystemInfo();
        await api.post('/runner/heartbeat', {
            id: config.id,
            deviceInfo,
            encoder: encoder,
        });
    } catch (error: any) {
        logger.error(`Heartbeat failed: ${error.message}${error.response?.data ? ` - ${JSON.stringify(error.response.data)}` : ''}`);
    }
};

heartbeat();
setInterval(heartbeat, 1000 * 20);

async function fetchAndProcessTask() {
    logger.info('尝试获取新任务...');
    try {
        const taskRes = await api.get<{ task?: Task; message?: string }>('/runner/getTask');

        if (taskRes.data.task) {
            const newTask = taskRes.data.task;
            logger.info(`获取到新任务: ${newTask.id}`);
            await taskManager.addTask(newTask);
        } else {
            logger.info('当前无可用任务.');
        }
    } catch (error: any) {
        logger.error(`获取任务失败: ${error.message}${error.response?.data ? ` - ${JSON.stringify(error.response.data)}` : ''}`);
    }
}

// 每10秒尝试获取新任务
setInterval(fetchAndProcessTask, 1000 * 10);
// 立即开始第一次获取
fetchAndProcessTask();

process.on('SIGINT', () => {
    logger.info('SIGINT TERMINATED');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('SIGTERM TERMINATED');
    process.exit(0);
});
