import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import config from './init';
import logger from './logger';

// 创建axios实例
const api = axios.create({
    baseURL: `${process.env.BASE_URL}/api`,
    headers: {
        authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json'
    },
    timeout: 30000
});

// 重试配置
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 初始重试延迟(ms)
const MAX_RETRY_DELAY = 30000; // 最大重试延迟(ms)

// 判断是否是进度上报API
const isProgressApi = (url: string) => {
    return url.includes('/download') ||
        url.includes('/convert') ||
        url.includes('/upload');
};

// 判断是否是关键状态API
const isStateApi = (url: string) => {
    return url.includes('/downloadComplete') ||
        url.includes('/convertComplete') ||
        url.includes('/complete') ||
        url.includes('/fail');
};

// 判断错误是否可重试
const isRetryableError = (error: AxiosError) => {
    // 服务器错误或网络错误可以重试
    if (!error.response) {
        return true;
    }
    const status = error.response.status;
    // 404表示资源不存在,不重试
    if (status === 404) {
        return false;
    }
    // 500以上的服务器错误可以重试
    return status >= 500;
};

// 重试延迟函数
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 包装API调用的重试逻辑
const withRetry = async (apiCall: () => Promise<any>, url: string) => {
    let retries = 0;
    let lastError: any;

    // 进度上报API失败直接返回
    if (isProgressApi(url)) {
        try {
            return await apiCall();
        } catch (error) {
            logger.warn(`Progress update failed, continuing: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
    }

    while (retries < MAX_RETRIES) {
        try {
            return await apiCall();
        } catch (error) {
            lastError = error;

            // 如果是不可重试的错误,直接抛出
            if (axios.isAxiosError(error) && !isRetryableError(error)) {
                throw error;
            }

            retries++;
            if (retries < MAX_RETRIES) {
                // 计算指数退避的重试延迟
                const delay = Math.min(
                    INITIAL_RETRY_DELAY * Math.pow(2, retries - 1),
                    MAX_RETRY_DELAY
                );

                // 关键API记录警告,其他API记录debug
                const logLevel = isStateApi(url) ? 'warn' : 'debug';
                logger[logLevel](`API call failed, retrying in ${delay}ms (${retries}/${MAX_RETRIES}): ${error instanceof Error ? error.message : String(error)}`);

                await sleep(delay);
            } else {
                logger.error(`API call failed after ${MAX_RETRIES} retries: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    }

    throw lastError;
};

// 重写axios方法以添加重试逻辑
const originalRequest = api.request;
api.request = async function (config: AxiosRequestConfig) {
    const url = config.url || '';
    return withRetry(() => originalRequest.call(this, config), url);
};

export default api;
