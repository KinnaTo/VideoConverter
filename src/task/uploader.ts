import { S3Client, type S3File } from 'bun';
import type { UploadInfo, MinioConfig } from '@/types/task';
import fs from 'fs';
import logger from '@/utils/logger';
import { URL } from 'url';

export default class Uploader {
    private s3Client: S3Client;
    private bucket: string;
    public uploadInfo: UploadInfo | null = null;

    constructor(config: MinioConfig) {
        try {
            if (!config || !config.endpoint || !config.accessKey || !config.secretKey || !config.bucket) {
                throw new Error('Invalid S3 configuration');
            }

            logger.info(`Original endpoint: ${config.endpoint}`);

            // 解析endpoint URL
            let endpoint: string;
            try {
                // 确保endpoint有协议前缀，如果没有则添加http://
                let fullUrl = config.endpoint;
                if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
                    fullUrl = 'http://' + fullUrl;
                }

                endpoint = fullUrl;
                logger.info(`Parsed endpoint: ${endpoint}`);
            } catch (parseError) {
                logger.error(`Failed to parse endpoint URL: ${config.endpoint}`, parseError);
                throw new Error(`Invalid endpoint URL: ${config.endpoint}`);
            }

            this.s3Client = new S3Client({
                endpoint,
                accessKeyId: config.accessKey,
                secretAccessKey: config.secretKey,
                bucket: config.bucket
            });

            this.bucket = config.bucket;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to initialize S3 client: ${errorMessage}`);
            throw error;
        }
    }

    async upload(localFile: string, taskId: string, format: string, onProgress?: (info: UploadInfo) => void) {
        try {
            // 检查文件是否存在
            if (!fs.existsSync(localFile)) {
                throw new Error(`File to upload does not exist: ${localFile}`);
            }

            const stat = fs.statSync(localFile);
            const totalSize = stat.size;

            if (totalSize === 0) {
                throw new Error(`File is empty: ${localFile}`);
            }

            logger.info(`Starting upload of file: ${localFile}, size: ${totalSize} bytes`);

            const objectName = `${taskId}.${format}`;
            const startTime = Date.now();
            this.uploadInfo = {
                startTime: new Date(startTime).toISOString(),
                fileSize: totalSize,
                averageSpeed: 0,
                targetUrl: '',
                hash: '',
                progress: 0,
                currentSize: 0,
                totalSize,
                currentSpeed: 0,
                eta: 0,
                endTime: '',
            };

            // 使用Bun.file替代fs.createReadStream
            const bunFile = Bun.file(localFile);
            const s3File: S3File = this.s3Client.file(objectName);

            // 使用Bun的S3 API上传文件
            // 如果文件较大，使用分段上传
            if (totalSize > 10 * 1024 * 1024) { // 大于10MB使用分段上传
                let uploaded = 0;
                let lastReportedProgress = 0;

                // 分块大小设为5MB
                const PART_SIZE = 5 * 1024 * 1024;
                const partCount = Math.ceil(totalSize / PART_SIZE);

                logger.info(`Starting multipart upload with ${partCount} parts`);

                // 手动实现分块上传并跟踪进度
                for (let i = 0; i < partCount; i++) {
                    const start = i * PART_SIZE;
                    const end = Math.min(start + PART_SIZE, totalSize);
                    const chunkSize = end - start;

                    // 读取文件块
                    const chunk = await bunFile.slice(start, end).arrayBuffer();

                    // 上传分块
                    await this.s3Client.write(
                        `${objectName}.part${i + 1}`,
                        chunk
                    );

                    // 更新已上传大小
                    uploaded += chunkSize;

                    // 计算进度
                    const now = Date.now();
                    const elapsed = (now - startTime) / 1000;
                    const speed = uploaded / elapsed;
                    const progress = (uploaded / totalSize) * 100;
                    const eta = speed > 0 ? (totalSize - uploaded) / speed : 0;

                    // 只有当进度变化超过1%时才报告进度
                    if (progress - lastReportedProgress >= 1 || i === partCount - 1) {
                        lastReportedProgress = progress;

                        this.uploadInfo = {
                            ...this.uploadInfo!,
                            currentSize: uploaded,
                            progress,
                            currentSpeed: speed,
                            eta,
                        };

                        if (onProgress && this.uploadInfo) {
                            onProgress(this.uploadInfo);
                        }
                    }
                }

                // 合并分块（在实际S3实现中，这里应该调用completeMultipartUpload）
                // 但在Bun的S3 API中，我们可以直接上传完整文件来替代这个步骤
                await this.s3Client.write(objectName, bunFile);

                // 清理临时分块
                for (let i = 0; i < partCount; i++) {
                    await this.s3Client.delete(`${objectName}.part${i + 1}`);
                }

                logger.info(`Multipart upload completed successfully for ${objectName}`);
            } else {
                // 小文件直接上传
                await this.s3Client.write(objectName, bunFile);

                // 更新进度为100%
                this.uploadInfo = {
                    ...this.uploadInfo,
                    currentSize: totalSize,
                    progress: 100,
                };

                if (onProgress && this.uploadInfo) {
                    onProgress(this.uploadInfo);
                }
            }

            // 验证文件大小
            const stat2 = await this.s3Client.stat(objectName);
            if (stat2.size !== totalSize) {
                throw new Error('Upload verification failed: file size mismatch');
            }

            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;

            // 获取文件URL
            const targetUrl = s3File.presign({
                expiresIn: 7 * 24 * 60 * 60, // 7天过期
            });

            this.uploadInfo = {
                ...this.uploadInfo,
                endTime: new Date(endTime).toISOString(),
                progress: 100,
                currentSize: totalSize,
                currentSpeed: 0,
                eta: 0,
                averageSpeed: duration > 0 ? totalSize / duration : 0,
                targetUrl,
            };

            if (onProgress && this.uploadInfo) {
                onProgress(this.uploadInfo);
            }

            logger.info(`Upload completed: ${objectName}, duration: ${duration.toFixed(2)}s`);

            return this.uploadInfo;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Upload error: ${errorMessage}`);

            if (error instanceof Error && error.stack) {
                logger.error(`Error stack: ${error.stack}`);
            }

            throw error;
        }
    }
}
