import type { Context, Next } from 'hono';
import { prisma } from '@/utils/db';

export async function withQueue(c: Context, next: Next) {
    const { queueId } = c.req.param();

    const queue = await prisma.queue.findUnique({
        where: {
            id: queueId,
        },
    });

    if (!queue) {
        return c.json({ error: 'Queue not found' }, 404);
    }

    c.set('queue', queue);
    await next();
}
