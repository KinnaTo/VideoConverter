import { S3Client } from 'bun';
import { URL } from 'url';
import logger from './logger';
import config from './init';

// S3配置接口
interface S3Config {
    accessKey: string;
    secretKey: string;
    bucket: string;
    endpoint: string;
}

/**
 * 测试S3连接
 */
export async function testMinioConnection(): Promise<void> {
    try {
        logger.info('Testing S3 connection...');

        // 从环境变量获取S3配置
        const { BASE_URL } = process.env;
        if (!BASE_URL) {
            throw new Error('BASE_URL environment variable not set');
        }

        try {
            // 获取S3配置
            const response = await fetch(`${BASE_URL}/api/runner/minio`, {
                headers: {
                    authorization: `Bearer ${config.token}`,
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to get S3 configuration: ${response.statusText}`);
            }

            const s3Config = await response.json() as S3Config;

            if (!s3Config || !s3Config.accessKey || !s3Config.secretKey || !s3Config.bucket || !s3Config.endpoint) {
                throw new Error('Invalid S3 configuration from API');
            }

            // 解析endpoint URL
            let endpoint: string;

            try {
                // 确保endpoint有协议前缀，如果没有则添加http://
                let fullUrl = s3Config.endpoint;
                if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
                    fullUrl = 'http://' + fullUrl;
                }

                endpoint = fullUrl;
                logger.info(`Parsed S3 endpoint: ${endpoint}`);
            } catch (parseError) {
                const error = parseError as Error;
                logger.error(`Failed to parse S3 endpoint URL: ${s3Config.endpoint} - ${error.message}`);
                throw new Error(`Invalid S3 endpoint URL: ${s3Config.endpoint}`);
            }

            // 创建S3客户端
            const s3Client = new S3Client({
                endpoint,
                accessKeyId: s3Config.accessKey,
                secretAccessKey: s3Config.secretKey,
                bucket: s3Config.bucket
            });

            // 测试连接 - 尝试列出对象
            try {
                const bucket = s3Config.bucket;
                // 列出最多1个对象，只是为了测试连接
                await s3Client.list({ maxKeys: 1 });
                logger.info(`S3 connection test successful. Connected to bucket: ${bucket}`);
                return;
            } catch (listError) {
                // 如果列出对象失败，尝试检查桶是否存在
                try {
                    // 尝试写入一个小测试文件
                    const testKey = `test-connection-${Date.now()}.txt`;
                    await s3Client.write(testKey, 'Connection test');
                    // 删除测试文件
                    await s3Client.delete(testKey);
                    logger.info(`S3 connection test successful. Bucket ${s3Config.bucket} exists and is writable.`);
                    return;
                } catch (writeError) {
                    const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
                    logger.error(`Failed to write test file to bucket: ${errorMessage}`);
                    throw writeError;
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`S3 connection test failed: ${errorMessage}`);
            if (error instanceof Error && error.stack) {
                logger.error(`Error stack: ${error.stack}`);
            }
            // 不抛出错误，只记录日志
            return;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`S3 connection test failed: ${errorMessage}`);
        if (error instanceof Error && error.stack) {
            logger.error(`Error stack: ${error.stack}`);
        }
        // 不抛出错误，只记录日志
        return;
    }
} 