/** biome-ignore-all lint/suspicious/noExplicitAny: comment */
import type { ExtendedRequest } from '@/types/request';
import { prisma } from '@/utils/db';
export function AuthMachine() {
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            const req = args[0] as ExtendedRequest;

            const authHeader = req.headers.get('authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token format' }), {
                    status: 401,
                });
            }

            const token = authHeader.split(' ')[1];
            const machine = await prisma.machine.findUnique({
                where: {
                    token,
                },
            });

            if (!machine) {
                return new Response(JSON.stringify({ error: 'Unauthorized: Invalid machine' }), {
                    status: 403,
                });
            }

            // 将maxPriority添加到请求对象中
            req.machine = machine;

            return originalMethod.apply(this, args);
        };

        return descriptor;
    };
}
