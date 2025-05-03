declare module 'fs-extra' {
    export * from 'node:fs';
    export function ensureDirSync(path: string): void;
    export function pathExists(path: string): Promise<boolean>;
    export function stat(path: string): Promise<{ size: number }>;
    export function remove(path: string): Promise<void>;
    export function readFile(path: string): Promise<Buffer>;
    export function createReadStream(path: string): NodeJS.ReadableStream;
    export function createWriteStream(path: string, options?: { flags?: string }): NodeJS.WritableStream;
}

declare module 'p-retry' {
    interface Options {
        retries: number;
        onFailedAttempt?: (error: Error) => void | Promise<void>;
    }

    function pRetry<T>(input: () => Promise<T>, options?: Options): Promise<T>;
    export = pRetry;
}
