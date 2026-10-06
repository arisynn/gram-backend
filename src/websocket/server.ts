import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import url from 'url';
import { parseCookies } from '../utils/cookie';
import { telegramManager } from '../telegram/client';

interface AuthenticatedWs extends WebSocket {
  sessionId?: string;
  isAlive?: boolean;
}

export function setupWebSocketServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const sessionSockets = new Map<string, Set<AuthenticatedWs>>();

  // Telegram update listener -> broadcast to respective session sockets
  telegramManager.onUpdate((sessionId, eventType, data) => {
    const sockets = sessionSockets.get(sessionId);
    if (!sockets || sockets.size === 0) return;

    const payload = JSON.stringify({
      type: eventType,
      data,
      timestamp: Date.now(),
    });

    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch (e) {
          console.error('Failed to send ws message:', e);
        }
      }
    }
  });

  wss.on('connection', async (ws: AuthenticatedWs, req: http.IncomingMessage) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const parsedUrl = url.parse(req.url || '', true);
    let sessionId = parsedUrl.query.token as string || parsedUrl.query.session as string;

    if (!sessionId && req.headers.cookie) {
      const parsedCookies = parseCookies(req.headers.cookie);
      sessionId = parsedCookies['gram_session'];
    }

    if (!sessionId) {
      ws.close(4001, 'Unauthorized: session token required');
      return;
    }

    // Verify session
    const client = await telegramManager.getClientForSession(sessionId);
    if (!client) {
      ws.close(4003, 'Session invalid or expired');
      return;
    }

    ws.sessionId = sessionId;
    if (!sessionSockets.has(sessionId)) {
      sessionSockets.set(sessionId, new Set());
    }
    sessionSockets.get(sessionId)!.add(ws);

    // Send connection ACK
    ws.send(JSON.stringify({
      type: 'connected',
      data: { sessionId: sessionId.slice(0, 6) + '...' },
      timestamp: Date.now(),
    }));

    ws.on('message', (message: string) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch {}
    });

    ws.on('close', () => {
      if (ws.sessionId && sessionSockets.has(ws.sessionId)) {
        const set = sessionSockets.get(ws.sessionId)!;
        set.delete(ws);
        if (set.size === 0) {
          sessionSockets.delete(ws.sessionId);
        }
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket client error:', err);
    });
  });

  // Keep-alive heartbeat interval (every 30s)
  const interval = setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      const authWs = ws as AuthenticatedWs;
      if (authWs.isAlive === false) {
        return authWs.terminate();
      }
      authWs.isAlive = false;
      authWs.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}
