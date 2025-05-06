import { initMinio, uploadFile } from './minio';
import logger from './logger';
import { stat } from 'node:fs/promises';

export class Uploader {
    async upload(filePath: string) {
        try {
            // 获取文件信息
            const stats = await stat(filePath);
            const fileSize = stats.size;

            // 初始化MinIO客户端
            await initMinio();

            // 上传文件
            const objectName = `${Date.now()}.mp4`;
            const uploadPath = await uploadFile(objectName, filePath, {
                timestamp: new Date().toISOString(),
                size: String(fileSize),
            });

            return {
                status: 'completed',
                progress: 100,
                fileSize,
                targetUrl: uploadPath,
                startTime: new Date().toISOString(),
                endTime: new Date().toISOString(),
            };
        } catch (error) {
            logger.error('上传失败:', error);
            throw error;
        }
    }
} 