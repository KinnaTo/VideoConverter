import axios from 'axios';
import fs from 'fs';

import type { DownloadInfo } from '../types/task';
import fsExtra from 'fs-extra';

export default class Downloader {
    private url: string;
    private path: string;

    public downloadInfo: DownloadInfo | null = null;

    constructor(url: string, path: string) {
        this.url = url;
        this.path = path;

        fsExtra.ensureDirSync(path);
    }

    async download(onProgress?: (info: DownloadInfo) => void) {
        const headRes = await axios.head(this.url);
        const totalSize = Number(headRes.headers['content-length']) || 0;
        let downloaded = 0;
        let lastTime = Date.now();
        let lastDownloaded = 0;
        const startTime = Date.now();

        this.downloadInfo = {
            startTime: new Date(startTime).toISOString(),
            sourceUrl: this.url,
            fileSize: totalSize,
            totalSize,
            currentSize: 0,
            progress: 0,
            currentSpeed: 0,
            eta: 0,
            endTime: '',
            averageSpeed: 0,
        };

        const response = await axios.get(this.url, { responseType: 'stream' });
        const writer = fs.createWriteStream(this.path);

        response.data.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            const now = Date.now();
            const timeElapsed = (now - lastTime) / 1000; // 秒
            if (timeElapsed >= 1) {
                const speed = (downloaded - lastDownloaded) / timeElapsed; // B/s
                const progress = totalSize ? downloaded / totalSize : 0;
                const eta = speed > 0 ? (totalSize - downloaded) / speed : 0;
                this.downloadInfo = {
                    ...this.downloadInfo!,
                    currentSize: downloaded,
                    progress: progress * 100,
                    currentSpeed: speed,
                    eta,
                };
                if (onProgress && this.downloadInfo) onProgress(this.downloadInfo);
                lastTime = now;
                lastDownloaded = downloaded;
            }
        });

        response.data.on('end', () => {
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            const averageSpeed = duration > 0 ? downloaded / duration : 0;
            this.downloadInfo = {
                ...this.downloadInfo!,
                endTime: new Date(endTime).toISOString(),
                currentSize: downloaded,
                progress: 100,
                currentSpeed: 0,
                eta: 0,
                averageSpeed,
            };
            if (onProgress && this.downloadInfo) onProgress(this.downloadInfo);
        });

        response.data.pipe(writer);

        await new Promise<void>((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }
}