import type { Context } from 'hono';
import { AuthMachine } from '@/decorators/authmatchine';
import { Controller } from '@/decorators/controller';
import { Get, Post } from '@/decorators/http';
import { TaskStatus } from '@/generated/prisma';
import { prisma } from '@/utils/db';

@Controller('/runner')
export class RunnerController {
    @Get('/')
    @AuthMachine()
    async getRunner(c: Context) {
        const runner = c.get('machine');
        return c.json({ runner });
    }

    @Get('/listQueue')
    @AuthMachine()
    async listQueue(c: Context) {
        const queue = await prisma.queue.findMany({});
        return c.json({ queue });
    }

    @Get('/:queueId/getTask')
    @AuthMachine()
    async getTask(c: Context) {
        const { queueId } = c.req.param();

        const task = await prisma.task.findFirst({
            where: { queueId, status: TaskStatus.WAITING },
            orderBy: {
                priority: 'desc',
            },
        });

        if (!task) {
            return c.json({ error: 'No task found' }, 404);
        }

        return c.json({ task });
    }

    @Post('/:taskId/start')
    @AuthMachine()
    async startTask(c: Context) {
        const { taskId } = c.req.param();

        const task = await prisma.task.findFirst({
            where: { id: taskId, status: TaskStatus.WAITING },
        });

        if (!task) {
            return c.json({ error: 'Task not found' }, 404);
        }

        await prisma.task.update({
            where: { id: taskId },
            data: { status: TaskStatus.RUNNING },
        });

        return c.json({ success: true });
    }

    @Post('/:taskId/complete')
    @AuthMachine()
    async completeTask(c: Context) {
        const { taskId } = c.req.param();
        const { result } = await c.req.json();

        await prisma.task.update({
            where: { id: taskId },
            data: { status: TaskStatus.FINISHED, result },
        });

        return c.json({ success: true });
    }

    @Post('/:taskId/fail')
    @AuthMachine()
    async failTask(c: Context) {
        const { taskId } = c.req.param();
        const { error } = await c.req.json();

        await prisma.task.update({
            where: { id: taskId },
            data: { status: TaskStatus.FAILED, error },
        });

        return c.json({ success: true });
    }

    @Post('/:taskId/progress')
    @AuthMachine()
    async progressTask(c: Context) {
        const { taskId } = c.req.param();
        const { data } = await c.req.json();

        await prisma.task.update({
            where: { id: taskId },
            data: { result: data },
        });

        return c.json({ success: true });
    }

    @Post('/online')
    @AuthMachine()
    async online(c: Context) {
        const runner = c.get('machine');
        const data = await c.req.json();

        if (!data.machine || !data.machine.id || data.machine.id !== runner.id) {
            return c.json({ error: 'Machine not found' }, 404);
        }

        if (!runner.firstHeartbeat) {
            await prisma.machine.update({
                where: { id: runner.id },
                data: { firstHeartbeat: new Date() },
            });
        }

        return c.json({ runner });
    }

    @Post('/heartbeat')
    @AuthMachine()
    async heartbeat(c: Context) {
        const runner = c.get('machine');

        await prisma.machine.update({
            where: { id: runner.id },
            data: { heartbeat: new Date() },
        });

        return c.json({ runner });
    }
}
