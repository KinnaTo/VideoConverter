import type { Context } from 'hono';
import { Auth } from '@/decorators/auth';
import { Controller } from '@/decorators/controller';
import { Delete, Get, Post } from '@/decorators/http';
import { prisma } from '@/utils/db';

@Controller('/machine')
export class MachineController {
    @Get('/')
    @Auth()
    async getMachine(c: Context) {
        const machines = await prisma.machine.findMany();
        return c.json({ machines });
    }

    @Post('/')
    @Auth()
    async createMachine(c: Context) {
        const { name, ip } = await c.req.json();
        const machine = await prisma.machine.create({
            data: { name, ip },
        });
        return c.json({ machine });
    }

    @Delete('/:id')
    @Auth()
    async deleteMachine(c: Context) {
        const { id } = c.req.param();

        await prisma.machine.delete({
            where: { id },
        });

        return c.json({ message: 'Machine deleted' });
    }
}
