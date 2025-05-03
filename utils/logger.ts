// biome-ignore-all lint/suspicious/noExplicitAny: comment

import pc from 'picocolors';

const logger = {
    info: (msg: any) => console.log(`${pc.gray(new Date().toLocaleTimeString())} ${pc.blue('INFO')} ${msg}`),

    warn: (msg: any) => console.warn(`${pc.gray(new Date().toLocaleTimeString())} ${pc.yellow('WARN')} ${msg}`),

    error: (msg: any) => console.error(`${pc.gray(new Date().toLocaleTimeString())} ${pc.red('ERROR')} ${msg}`),

    debug: (msg: any) => {
        if (process.env.NODE_ENV !== 'production') {
            console.debug(`${pc.gray(new Date().toLocaleTimeString())} ${pc.gray('DEBUG')} ${msg}`);
        }
    },

    // 简化的请求日志
    req: (method: string, path: string, status: number, ms: number) => {
        const statusColor = status >= 400 ? pc.red : status >= 300 ? pc.yellow : pc.green;
        logger.info(`${method} ${path} ${statusColor(status)} ${ms}ms`);
    },
};

export default logger;
