import type { Token } from '@/generated/prisma';
import { prisma } from '@/utils/db';

export class TokenService {
    static async verifyToken(token: string | undefined): Promise<Token | null> {
        if (!token) {
            return null;
        }

        try {
            const tokenRecord = await prisma.token.findUnique({
                where: {
                    token,
                },
            });

            if (!tokenRecord) {
                return null;
            }

            return tokenRecord;
        } catch (error) {
            console.error('Token verification error:', error);
            return null;
        }
    }
}
