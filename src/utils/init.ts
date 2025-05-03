import pc from 'picocolors';
import { prisma } from './db';

const apiKeyCount = await prisma.token.count();
if (apiKeyCount === 0) {
    const maxPriority = 100;

    const token = await prisma.token.create({
        data: {
            maxPriority,
        },
    });

    console.log(pc.green('Created initial API key:'), pc.cyan(token.token));
}
