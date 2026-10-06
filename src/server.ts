import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config, isTelegramConfigured } from './config/env';
import { apiRouter } from './api/routes';
import { setupWebSocketServer } from './websocket/server';

async function startServer() {
  const app = express();

  // Enable CORS
  app.use(cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
    credentials: true,
  }));

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Health & Info Endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'GRAM MTProto Backend',
      version: '1.0.0',
      telegramConfigured: isTelegramConfigured(),
      timestamp: new Date().toISOString(),
    });
  });

  // Mount API router
  app.use('/api', apiRouter);

  // Serve Frontend
  const isProd = process.env.NODE_ENV === 'production';
  const rootDir = process.cwd();

  if (!isProd) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
        root: rootDir,
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('Vite dev middleware could not be loaded, fallback to static dist:', err);
      const distPath = path.resolve(rootDir, 'dist');
      if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
          res.sendFile(path.resolve(distPath, 'index.html'));
        });
      }
    }
  } else {
    const distPath = path.resolve(rootDir, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  }

  // Create HTTP server & attach WebSocket
  const server = http.createServer(app);
  setupWebSocketServer(server);

  server.listen(config.port, config.host, () => {
    console.log(`===============================================`);
    console.log(`GRAM MTProto running on http://${config.host}:${config.port}`);
    console.log(`Telegram API Configured: ${isTelegramConfigured() ? 'YES' : 'NO (Set TELEGRAM_API_ID & TELEGRAM_API_HASH)'}`);
    console.log(`WebSocket endpoint: ws://${config.host}:${config.port}/ws`);
    console.log(`===============================================`);
  });

  process.on('SIGINT', () => {
    console.log('Shutting down GRAM backend gracefully...');
    server.close(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    console.log('Terminating GRAM backend...');
    server.close(() => process.exit(0));
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
