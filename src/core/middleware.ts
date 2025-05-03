import { createId } from '@paralleldrive/cuid2';
import type { Context, Next } from 'hono';
import logger from '../utils/logger';

/**
 * 访问日志中间件
 * 记录所有HTTP请求的访问日志
 */
export async function accessLogger(c: Context, next: Next) {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;

    logger.req(c.req.method, c.req.path, c.res.status, duration);
}

/**
 * 性能监控中间件
 * 记录请求处理时间超过阈值的性能日志
 */
export function performanceLogger(thresholdMs = 1000) {
    return async (c: Context, next: Next) => {
        const start = Date.now();
        await next();
        const duration = Date.now() - start;

        if (duration > thresholdMs) {
            logger.warn(`Slow request: ${c.req.method} ${c.req.path} ${duration}ms`);
        }
    };
}
