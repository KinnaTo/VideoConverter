import type { Machine } from '@/generated/prisma';
export interface ExtendedRequest extends Request {
    maxPriority?: number;
    machine?: Machine;
}
