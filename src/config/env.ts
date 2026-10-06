import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend root or monorepo root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  cookieSecure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  
  // Telegram API Credentials
  telegramApiId: parseInt(process.env.TELEGRAM_API_ID || '0', 10),
  telegramApiHash: process.env.TELEGRAM_API_HASH || '',
  
  // Storage & Session Encryption
  sessionEncryptionKey: process.env.SESSION_ENCRYPTION_KEY || 'gram-default-secret-encryption-key-32ch',
  sessionDir: process.env.SESSION_DIR || path.resolve(process.cwd(), 'data/sessions'),
};

export function isTelegramConfigured(): boolean {
  return config.telegramApiId > 0 && Boolean(config.telegramApiHash);
}
