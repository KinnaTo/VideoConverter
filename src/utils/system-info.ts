import { exec } from 'node:child_process';
import type { Systeminformation } from 'systeminformation';
import si from 'systeminformation';
import { parseStringPromise } from 'xml2js';
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
    gpu?: any;
}

async function getNvidiaSmiData(): Promise<any | null> {
    return new Promise((resolve) => {
        exec('nvidia-smi -q -x', { timeout: 5000 }, async (error, stdout, stderr) => {
            if (error) {
                logger.warn(`nvidia-smi command failed: ${error.message}. No GPU info.`);
                resolve(null);
                return;
            }
            if (stderr) {
                logger.warn(`nvidia-smi returned error output: ${stderr}. No GPU info.`);
                resolve(null);
                return;
            }
            try {
                const result = await parseStringPromise(stdout);
                resolve(result.nvidia_smi_log);
            } catch (parseError: any) {
                logger.warn(`Failed to parse nvidia-smi XML output: ${parseError.message}. No GPU info.`);
                resolve(null);
            }
        });
    });
}

export async function getSystemInfo(): Promise<{ systemInfo: SystemInfo; encoder: 'cuda' | 'cpu' }> {
    try {
        const [cpuData, _cpuTemp, memData, diskData] = await Promise.all([si.cpu(), si.cpuTemperature(), si.mem(), si.fsSize()]);

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

        let encoder: 'cuda' | 'cpu' = 'cpu'; // Default to CPU

        const smiData = await getNvidiaSmiData();
        if (smiData?.gpu?.[0]) {
            const rawGpuData = smiData.gpu[0];

            delete rawGpuData.clocks;
            delete rawGpuData.supported_clocks;
            delete rawGpuData.performance_states;
            delete rawGpuData.pci;
            delete rawGpuData.accounted_processes;

            systemInfo.gpu = rawGpuData;
            encoder = 'cuda'; // Set encoder to CUDA if nvidia-smi succeeded
        } else {
            logger.warn('Failed to get or parse nvidia-smi data. No NVIDIA GPU info available. Encoder set to CPU.');
        }

        return { systemInfo, encoder }; // Return both systemInfo and encoder type
    } catch (error) {
        logger.error(`Failed to get system information: ${error}`);
        throw error;
    }
}

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
