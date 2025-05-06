import * as Minio from 'minio';
import type { MinioConfig } from '../types/task';
import api from './api';
import logger from './logger';

let minioClient: Minio.Client | null = null;
let currentBucket: string | null = null;

export async function initMinio(config: MinioConfig): Promise<void> {
    try {
        logger.debug(`初始化MinIO客户端，配置: ${JSON.stringify(config)}`);

        // 解析endpoint URL
        const endpointUrl = new URL(config.endpoint);

        minioClient = new Minio.Client({
            endPoint: endpointUrl.hostname,
            port: Number(endpointUrl.port) || (endpointUrl.protocol === 'https:' ? 443 : 80),
            useSSL: endpointUrl.protocol === 'https:',
            accessKey: config.accessKey,
            secretKey: config.secretKey,
        });

        logger.debug(
            `MinIO客户端配置: ${JSON.stringify({
                endPoint: endpointUrl.hostname,
                port: Number(endpointUrl.port) || (endpointUrl.protocol === 'https:' ? 443 : 80),
                useSSL: endpointUrl.protocol === 'https:',
                accessKey: '***',
                secretKey: '***',
            })}`,
        );

        // 测试连接
        await minioClient.bucketExists(config.bucket);
        currentBucket = config.bucket;
        logger.info('MinIO client initialized successfully');
    } catch (error: any) {
        logger.error(`MinIO initialization failed: ${error.message}`);
        if (error instanceof Error) {
            logger.error(`Error stack: ${error.stack}`);
        }
        throw error;
    }
}

export async function uploadFile(taskId: string, fileName: string, data: string | Buffer, metadata: Record<string, string> = {}): Promise<string> {
    if (!minioClient || !currentBucket) {
        throw new Error('MinIO client not initialized');
    }

    try {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const objectName = `${taskId}/${fileName}`;

        // 使用 putObject 上传文件，MinIO 默认支持覆盖
        await minioClient.putObject(currentBucket, objectName, buffer, buffer.length, {
            'Content-Type': 'video/mp4',
            ...metadata
        });

        logger.info(`File uploaded successfully: ${objectName}`);
        return objectName;
    } catch (error: any) {
        logger.error(`File upload failed: ${error.message}`);
        throw error;
    }
}
