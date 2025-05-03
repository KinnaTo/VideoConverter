import type { Context } from 'hono';
import { Auth } from '@/decorators/auth';
import { Controller } from '@/decorators/controller';
import { Delete, Get, Post } from '@/decorators/http';
import { withQueue } from '@/middlewares/queue';
import { prisma } from '@/utils/db';

@Controller('/queue')
export class QueueController {
    @Get('/')
    async getQueues(c: Context) {
        const queues = await prisma.queue.findMany();
        return c.json({ queues });
    }

    @Post('/')
    @Auth()
    async createQueue(c: Context) {
        const { name } = await c.req.json();
        const queue = await prisma.queue.create({
            data: {
                name,
            },
        });
        return c.json({ queue });
    }
}
@Controller('/queue/:queueId')
export class QueueTaskController {
    @Get('/', withQueue)
    @Auth()
    async getQueue(c: Context) {
        const queue = c.get('queue');
        return c.json({ queue });
    }

    @Get('/tasks', withQueue)
    @Auth()
    async getTasks(c: Context) {
        const queue = c.get('queue');
        const tasks = await prisma.task.findMany({
            where: {
                queueId: queue.id,
            },
        });

        return c.json({ tasks });
    }

    @Post('/task/new', withQueue)
    @Auth()
    async createTask(c: Context) {
        const queue = c.get('queue');
        const { name, priority, source } = await c.req.json();

        const task = await prisma.task.create({
            data: {
                name,
                priority,
                queueId: queue.id,
                source,
            },
        });

        return c.json({ task });
    }

    @Delete('/task/:taskId', withQueue)
    @Auth()
    async deleteTask(c: Context) {
        const queue = c.get('queue');
        const { taskId } = c.req.param();

        await prisma.task.delete({
            where: {
                id: taskId,
                queueId: queue.id,
            },
        });
    }

    @Delete('/tasks', withQueue)
    @Auth()
    async deleteTasks(c: Context) {
        const queue = c.get('queue');
        await prisma.task.deleteMany({
            where: { queueId: queue.id },
        });
    }

    @Delete('/', withQueue)
    @Auth()
    async deleteQueue(c: Context) {
        const queue = c.get('queue');
        await prisma.queue.delete({
            where: { id: queue.id },
        });
    }
}
