import { Client as MinioClient } from 'minio';
import type { UploadInfo, MinioConfig } from '@/types/task';
import fs from 'fs';

export default class Uploader {
    private minio: MinioClient;
    private bucket: string;
    public uploadInfo: UploadInfo | null = null;

    constructor(config: MinioConfig) {
        this.minio = new MinioClient({
            endPoint: config.endpoint,
            accessKey: config.accessKey,
            secretKey: config.secretKey,
            useSSL: config.endpoint.startsWith('https'),
        });
        this.bucket = config.bucket;
    }

    async upload(localFile: string, taskId: string, format: string, onProgress?: (info: UploadInfo) => void) {
        const stat = fs.statSync(localFile);
        const totalSize = stat.size;
        let uploaded = 0;
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
        const objectName = `${taskId}.${format}`;
        const stream = fs.createReadStream(localFile);
        stream.on('data', (chunk) => {
            uploaded += chunk.length;
            const now = Date.now();
            const elapsed = (now - startTime) / 1000;
            const speed = elapsed > 0 ? uploaded / elapsed : 0;
            const progress = totalSize ? uploaded / totalSize : 0;
            const eta = speed > 0 ? (totalSize - uploaded) / speed : 0;
            this.uploadInfo = {
                ...this.uploadInfo!,
                currentSize: uploaded,
                progress: progress * 100,
                currentSpeed: speed,
                eta,
            };
            if (onProgress && this.uploadInfo) onProgress(this.uploadInfo);
        });
        await this.minio.putObject(this.bucket, objectName, stream);
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        this.uploadInfo = {
            ...this.uploadInfo!,
            endTime: new Date(endTime).toISOString(),
            progress: 100,
            currentSize: totalSize,
            currentSpeed: 0,
            eta: 0,
            averageSpeed: duration > 0 ? totalSize / duration : 0,
            targetUrl: `${this.bucket}/${objectName}`,
        };
        if (onProgress && this.uploadInfo) onProgress(this.uploadInfo);
    }
}
