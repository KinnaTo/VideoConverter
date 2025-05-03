/** biome-ignore-all lint/suspicious/noExplicitAny: comment */
import type { Context } from 'hono';
import { TokenService } from '@/services/token';

export function Auth() {
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            const c = args[0] as Context;

            const authHeader = c.req.header('authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                return c.json({ error: 'Unauthorized: Invalid token format' }, 401);
            }

            const token = authHeader.split(' ')[1];
            const tokenData = await TokenService.verifyToken(token);

            if (!tokenData) {
                return c.json({ error: 'Unauthorized: Invalid token' }, 403);
            }

            // 将maxPriority添加到Context中
            c.set('maxPriority', tokenData.maxPriority);

            return originalMethod.apply(this, args);
        };

        return descriptor;
    };
}
