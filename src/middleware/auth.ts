import { Request, Response, NextFunction } from 'express';
import { telegramManager } from '../telegram/client';
import { parseCookies } from '../utils/cookie';

export interface AuthenticatedRequest extends Request {
  sessionId?: string;
  telegramClient?: any;
}

export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  let sessionId: string | undefined;

  // 1. Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.substring(7).trim();
  }

  // 2. Check Cookie header
  if (!sessionId && req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    sessionId = cookies['gram_session'];
  }

  // 3. Check query param (Crucial for <img> tags and media downloads)
  if (!sessionId && req.query) {
    sessionId = (req.query.token as string) || (req.query.session as string);
  }

  if (!sessionId) {
    res.status(401).json({ error: 'Tidak terotentikasi. Silakan masuk terlebih dahulu.' });
    return;
  }

  try {
    const client = await telegramManager.getClientForSession(sessionId);
    if (!client) {
      res.status(401).json({ error: 'Sesi Telegram berakhir atau tidak valid. Silakan masuk kembali.' });
      return;
    }

    req.sessionId = sessionId;
    req.telegramClient = client;
    next();
  } catch (err: any) {
    res.status(401).json({ error: 'Gagal memverifikasi sesi Telegram.', details: err?.message });
  }
}
