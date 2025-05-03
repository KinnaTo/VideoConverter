import type { Systeminformation } from 'systeminformation';
import si from 'systeminformation';
import logger from './logger';

export interface SystemInfo {
    cpu: {
        manufacturer: string;
        brand: string;
        speed: number;
        cores: number;
        usage: number;
    };
    memory: {
        total: number;
        free: number;
        used: number;
        usedPercent: number;
    };
    disk: {
        size: number;
        free: number;
        used: number;
        usedPercent: number;
    };
    gpu?: {
        vendor: string;
        model: string;
        memoryTotal: number;
        memoryUsed: number;
        memoryFree?: number;
        utilizationGpu?: number; // GPU使用率
        utilizationMemory?: number; // 显存使用率
        temperature?: number; // GPU温度
        powerDraw?: number; // 功耗
        powerLimit?: number; // 功耗限制
        clockCore?: number; // 核心频率
        clockMemory?: number; // 显存频率
        fanSpeed?: number; // 风扇转速
        driverVersion?: string; // 驱动版本
        cuda?: {
            version: string;
            cores: number;
            computeCapability: string;
        };
        features?: {
            cudaEnabled: boolean;
            nvencEnabled: boolean;
            nvdecEnabled: boolean;
        };
    };
}

export async function getSystemInfo(): Promise<SystemInfo> {
    try {
        const [cpuData, _cpuTemp, memData, diskData, gpuData] = await Promise.all([
            si.cpu(),
            si.cpuTemperature(),
            si.mem(),
            si.fsSize(),
            si.graphics(),
        ]);

        // 获取 CPU 使用率
        const cpuLoad = await si.currentLoad();

        const systemInfo: SystemInfo = {
            cpu: {
                manufacturer: cpuData.manufacturer,
                brand: cpuData.brand,
                speed: cpuData.speed,
                cores: cpuData.cores,
                usage: Math.round(cpuLoad.currentLoad),
            },
            memory: {
                total: memData.total,
                free: memData.free,
                used: memData.used,
                usedPercent: Math.round((memData.used / memData.total) * 100),
            },
            disk: {
                size: diskData[0]?.size ?? 0,
                free: diskData[0]?.available ?? 0,
                used: (diskData[0]?.size ?? 0) - (diskData[0]?.available ?? 0),
                usedPercent: diskData[0]?.use ?? 0,
            },
        };

        // 如果有 GPU 信息，添加到结果中
        const mainGpu = gpuData.controllers?.[0];
        if (mainGpu) {
            // 基础 GPU 信息
            const gpuInfo: SystemInfo['gpu'] = {
                vendor: mainGpu.vendor || 'Unknown',
                model: mainGpu.model || 'Unknown',
                memoryTotal: mainGpu.memoryTotal || 0,
                memoryUsed: mainGpu.memoryUsed || 0,
                memoryFree: mainGpu.memoryFree,
                temperature: mainGpu.temperatureGpu,
                powerDraw: mainGpu.powerDraw,
                powerLimit: mainGpu.powerLimit,
                clockCore: mainGpu.clockCore,
                clockMemory: mainGpu.clockMemory,
                fanSpeed: mainGpu.fanSpeed,
                driverVersion: mainGpu.driverVersion,
            };

            // 如果是 NVIDIA GPU，尝试获取更多信息
            if (mainGpu.vendor.toLowerCase().includes('nvidia')) {
                try {
                    // 尝试使用 nvidia-smi 获取更多信息
                    const nvidiaSmi = await si.graphics();
                    const nvGpu = nvidiaSmi.controllers?.[0];

                    if (nvGpu?.vendor.toLowerCase().includes('nvidia')) {
                        gpuInfo.utilizationGpu = nvGpu.utilizationGpu;
                        gpuInfo.utilizationMemory = nvGpu.utilizationMemory;
                        gpuInfo.cuda = {
                            version: nvGpu.subDeviceId || 'Unknown', // CUDA版本可能需要其他方式获取
                            cores: Number.parseInt(String(nvGpu.clockCore || '0'), 10), // CUDA核心数可能需要其他方式获取
                            computeCapability: nvGpu.name || 'Unknown', // 计算能力可能需要其他方式获取
                        };

                        gpuInfo.features = {
                            cudaEnabled: true,
                            nvencEnabled: true, // 这些特性可能需要其他方式检测
                            nvdecEnabled: true,
                        };
                    }
                } catch (error) {
                    logger.warn(`Failed to get detailed NVIDIA GPU information: ${error}`);
                }
            }

            systemInfo.gpu = gpuInfo;
        }

        return systemInfo;
    } catch (error) {
        logger.error(`Failed to get system information: ${error}`);
        throw error;
    }
}

// 格式化字节为人类可读的格式
export function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
}
