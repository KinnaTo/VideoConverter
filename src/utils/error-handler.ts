import fs from 'fs';
import logger from './logger';

/**
 * 格式化错误消息
 */
export function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * 清理文件
 */
export function cleanupFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            logger.info(`Removed file: ${filePath}`);
        } catch (error) {
            logger.error(`Failed to remove file: ${formatErrorMessage(error)}`);
        }
    }
}

/**
 * 清理目录
 */
export function cleanupDirectory(dirPath: string): void {
    if (fs.existsSync(dirPath)) {
        try {
            fs.rmSync(dirPath, { recursive: true, force: true });
            logger.info(`Removed directory: ${dirPath}`);
        } catch (error) {
            logger.error(`Failed to remove directory: ${formatErrorMessage(error)}`);
        }
    }
} 