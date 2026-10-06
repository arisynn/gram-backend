import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env';

// Ensure session directory exists
if (!fs.existsSync(config.sessionDir)) {
  fs.mkdirSync(config.sessionDir, { recursive: true });
}

function getDerivedKey(): Buffer {
  return crypto.createHash('sha256').update(config.sessionEncryptionKey).digest();
}

/**
 * Encrypt a string session using AES-256-GCM
 */
export function encryptSession(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getDerivedKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

/**
 * Decrypt an encrypted string session
 */
export function decryptSession(cipherJson: string): string {
  try {
    const parsed = JSON.parse(cipherJson);
    const iv = Buffer.from(parsed.iv, 'hex');
    const tag = Buffer.from(parsed.tag, 'hex');
    const data = Buffer.from(parsed.data, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', getDerivedKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Failed to decrypt session: invalid key or corrupted data');
  }
}

export interface StoredSessionMeta {
  userId?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  avatarUrl?: string;
  createdAt: number;
  lastUsedAt: number;
}

export function saveUserSession(sessionId: string, sessionString: string, meta: StoredSessionMeta): void {
  const filePath = path.join(config.sessionDir, `${sessionId}.session`);
  const metaPath = path.join(config.sessionDir, `${sessionId}.json`);

  const encrypted = encryptSession(sessionString);
  fs.writeFileSync(filePath, encrypted, 'utf8');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

export function loadUserSession(sessionId: string): { sessionString: string; meta?: StoredSessionMeta } | null {
  const filePath = path.join(config.sessionDir, `${sessionId}.session`);
  const metaPath = path.join(config.sessionDir, `${sessionId}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const encrypted = fs.readFileSync(filePath, 'utf8');
    const sessionString = decryptSession(encrypted);
    let meta: StoredSessionMeta | undefined;
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }
    return { sessionString, meta };
  } catch {
    return null;
  }
}

export function deleteUserSession(sessionId: string): void {
  const filePath = path.join(config.sessionDir, `${sessionId}.session`);
  const metaPath = path.join(config.sessionDir, `${sessionId}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
}

export function getActiveSessionIds(): string[] {
  if (!fs.existsSync(config.sessionDir)) return [];
  const files = fs.readdirSync(config.sessionDir);
  return files.filter(f => f.endsWith('.session')).map(f => f.replace(/\.session$/, ''));
}

export function getAllStoredSessions(): Array<{ sessionId: string; meta?: StoredSessionMeta }> {
  const ids = getActiveSessionIds();
  return ids.map(id => {
    const metaPath = path.join(config.sessionDir, `${id}.json`);
    let meta: StoredSessionMeta | undefined;
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {}
    }
    return { sessionId: id, meta };
  });
}
