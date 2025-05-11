import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { RunnerService } from '@/services/runner';
import config from './utils/init';
import logger from './utils/logger';
import { getSystemInfo } from './utils/system-info';
import { testMinioConnection } from './utils/minio-tester';

// 环境变量检查
const { BASE_URL, HOSTNAME, ENCODER } = process.env;

if (!BASE_URL || !HOSTNAME || !ENCODER) {
    logger.error('缺少环境变量 BASE_URL, HOSTNAME 或 ENCODER');
    process.exit(1);
}

// 创建临时目录
const TMP_DIR = join(os.tmpdir(), 'videoconverter');
const tempDir = join(process.cwd(), 'temp'); // 保留临时目录，以防其他地方使用

// 初始化 RunnerService 配置
const runnerConfig = {
    machineId: config.id,
    token: config.token,
    apiUrl: BASE_URL,
    downloadDir: TMP_DIR, // 使用临时目录作为下载目录
    heartbeatInterval: 1000 * 20, // 20秒心跳
    taskCheckInterval: 1000 * 10  // 10秒检查一次任务
};

async function main() {
    try {
        // 确保目录存在
        await mkdir(TMP_DIR, { recursive: true });
        await mkdir(tempDir, { recursive: true });

        // 测试MinIO连接
        logger.info('Testing MinIO connection...');
        await testMinioConnection();

        // 创建并启动 Runner 服务
        const runner = new RunnerService(runnerConfig);
        await runner.start();

        logger.info('Runner service started successfully');
    } catch (error: any) {
        logger.error(`启动失败: ${error.message}`);
        process.exit(1);
    }
}

// 启动主程序
main().catch((error) => {
    logger.error('Unhandled error:', error);
    process.exit(1);
});

// 处理进程终止信号
process.on('SIGINT', async () => {
    logger.info('SIGINT received');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('SIGTERM received');
    process.exit(0);
});
