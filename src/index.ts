import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import config from './utils/init';
import logger from './utils/logger';
import { getSystemInfo } from './utils/system-info';

// 环境变量检查
const { BASE_URL, HOSTNAME, ENCODER } = process.env;

if (!BASE_URL || !HOSTNAME || !ENCODER) {
    logger.error('缺少环境变量 BASE_URL, HOSTNAME 或 ENCODER');
    process.exit(1);
}

// 创建必要的目录
const downloadDir = join(process.cwd(), 'downloads');
const tempDir = join(process.cwd(), 'temp');

// 初始化 RunnerService 配置
const runnerConfig = {
    machineId: config.id,
    token: config.token,
    apiUrl: BASE_URL,
    downloadDir,
    heartbeatInterval: 1000 * 20, // 20秒心跳
    taskCheckInterval: 1000 * 10  // 10秒检查一次任务
};

async function main() {
    try {
        // 确保目录存在
        await mkdir(downloadDir, { recursive: true });
        await mkdir(tempDir, { recursive: true });
        // 上线通知
        try {
            const { systemInfo, encoder } = await getSystemInfo();
            logger.info(`系统信息: CPU: ${systemInfo.cpu.brand}, 核心数: ${systemInfo.cpu.cores}, 编码器: ${encoder}`);
        } catch (error: any) {
            logger.error(`上线通知失败: ${error.message}`);
        }

    } catch (error: any) {
        logger.error(`启动失败: ${error.message}`);
        process.exit(1);
    }
}

// 启动主程序
main().catch(error => {
    logger.error('未捕获的错误:', error);
    process.exit(1);
});

// 处理进程终止信号
process.on('SIGINT', async () => {
    logger.info('接收到 SIGINT 信号，正在关闭...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('接收到 SIGTERM 信号，正在关闭...');
    process.exit(0);
});
