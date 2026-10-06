import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage } from 'telegram/events';
import { EditedMessage } from 'telegram/events/EditedMessage';
import { DeletedMessage } from 'telegram/events/DeletedMessage';
import { Raw } from 'telegram/events/Raw';
import { Api } from 'telegram';
import { config, isTelegramConfigured } from '../config/env';
import { loadUserSession, saveUserSession, deleteUserSession, getAllStoredSessions } from './session';
import type { UserProfile, ChatSummary, ChatMessage, TelegramContact, GroupDetail, ChannelDetail, AccountInfo } from '../shared/types';

export type UpdateListener = (sessionId: string, eventType: string, data: any) => void;

class TelegramManager {
  private activeClients = new Map<string, TelegramClient>();
  private pendingAuth = new Map<string, {
    client: TelegramClient;
    phoneNumber: string;
    phoneCodeHash: string;
    createdAt: number;
    apiId?: number;
    apiHash?: string;
  }>();
  private updateListeners: UpdateListener[] = [];

  public onUpdate(listener: UpdateListener): () => void {
    this.updateListeners.push(listener);
    return () => {
      this.updateListeners = this.updateListeners.filter(l => l !== listener);
    };
  }

  private notifyUpdate(sessionId: string, eventType: string, data: any): void {
    for (const listener of this.updateListeners) {
      try {
        listener(sessionId, eventType, data);
      } catch (err) {
        console.error('Error in update listener callback:', err);
      }
    }
  }

  /**
   * Get effective API ID and API HASH (either from env or custom runtime config)
   */
  public getCredentials(customApiId?: number, customApiHash?: string): { apiId: number; apiHash: string } {
    const apiId = customApiId || config.telegramApiId;
    const apiHash = customApiHash || config.telegramApiHash;
    if (!apiId || !apiHash) {
      throw new Error('Telegram API credentials missing. Please set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env');
    }
    return { apiId, apiHash };
  }

  /**
   * Retrieve an active, connected Telegram client for the session.
   * If not in memory, attempts to load and restore from disk.
   */
  public async getClientForSession(sessionId: string): Promise<TelegramClient | null> {
    if (this.activeClients.has(sessionId)) {
      const client = this.activeClients.get(sessionId)!;
      if (!client.connected) {
        await client.connect();
      }
      return client;
    }

    const stored = loadUserSession(sessionId);
    if (!stored) {
      return null;
    }

    try {
      const { apiId, apiHash } = this.getCredentials();
      const stringSession = new StringSession(stored.sessionString);
      const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: false,
        deviceModel: 'Desktop x64',
        systemVersion: 'Windows 11',
        appVersion: '5.10.3',
      });

      await client.connect();
      
      const isAuth = await client.checkAuthorization();
      if (!isAuth) {
        deleteUserSession(sessionId);
        return null;
      }

      this.attachClientListeners(sessionId, client);
      this.activeClients.set(sessionId, client);
      return client;
    } catch (err) {
      console.error(`Failed to restore Telegram session ${sessionId}:`, err);
      return null;
    }
  }

  private attachClientListeners(sessionId: string, client: TelegramClient): void {
    // 1. New Messages
    client.addEventHandler(async (event: any) => {
      try {
        const message = event.message;
        if (!message) return;

        const peerId = message.peerId;
        let chatId = '';
        if (peerId) {
          if ('userId' in peerId) chatId = String(peerId.userId);
          else if ('chatId' in peerId) chatId = String(peerId.chatId);
          else if ('channelId' in peerId) chatId = String(peerId.channelId);
        }

        const chatMessage: ChatMessage = {
          id: message.id,
          chatId: chatId || String(message.chatId || ''),
          senderId: String(message.senderId || ''),
          senderName: 'Sender',
          text: message.message || message.text || '',
          date: message.date || Math.floor(Date.now() / 1000),
          isOutgoing: Boolean(message.out),
          replyToMsgId: message.replyTo?.replyToMsgId,
        };

        this.notifyUpdate(sessionId, 'new_message', { message: chatMessage, chatId });
      } catch (e) {
        console.error('Error handling Telegram new_message update:', e);
      }
    }, new NewMessage({}));

    // 2. Edited Messages
    client.addEventHandler(async (event: any) => {
      try {
        const message = event.message;
        if (!message) return;

        const peerId = message.peerId;
        let chatId = '';
        if (peerId) {
          if ('userId' in peerId) chatId = String(peerId.userId);
          else if ('chatId' in peerId) chatId = String(peerId.chatId);
          else if ('channelId' in peerId) chatId = String(peerId.channelId);
        }

        const chatMessage: ChatMessage = {
          id: message.id,
          chatId: chatId || String(message.chatId || ''),
          senderId: String(message.senderId || ''),
          senderName: 'Sender',
          text: message.message || message.text || '',
          date: message.date || Math.floor(Date.now() / 1000),
          isOutgoing: Boolean(message.out),
          isEdited: true,
          replyToMsgId: message.replyTo?.replyToMsgId,
        };

        this.notifyUpdate(sessionId, 'edit_message', { message: chatMessage, chatId });
      } catch (e) {
        console.error('Error handling Telegram edit_message update:', e);
      }
    }, new EditedMessage({}));

    // 3. Deleted Messages
    client.addEventHandler(async (event: any) => {
      try {
        const deletedIds: number[] = event.deletedIds || [];
        const channelId = event.channelId ? String(event.channelId) : undefined;
        this.notifyUpdate(sessionId, 'delete_message', { messageIds: deletedIds, chatId: channelId });
      } catch (e) {
        console.error('Error handling Telegram delete_message update:', e);
      }
    }, new DeletedMessage({}));

    // 4. Raw updates (Read Receipts & Statuses)
    client.addEventHandler(async (event: any) => {
      try {
        if (event instanceof Api.UpdateReadHistoryInbox || event instanceof Api.UpdateReadChannelInbox) {
          const peer = (event as any).peer || (event as any).channelId;
          const chatId = peer ? (typeof peer === 'object' ? (peer.userId || peer.chatId || peer.channelId) : peer) : '';
          this.notifyUpdate(sessionId, 'read_history', {
            chatId: String(chatId),
            maxId: event.maxId,
            stillUnreadCount: (event as any).stillUnreadCount || 0,
          });
        } else if (
          event instanceof Api.UpdateReadHistoryOutbox ||
          event instanceof Api.UpdateReadChannelOutbox ||
          (event as any).className === 'UpdateReadHistoryOutbox' ||
          (event as any).className === 'UpdateReadChannelOutbox'
        ) {
          const peer = (event as any).peer || (event as any).channelId;
          const chatId = peer ? (typeof peer === 'object' ? (peer.userId || peer.chatId || peer.channelId) : peer) : '';
          this.notifyUpdate(sessionId, 'read_outbox', {
            chatId: String(chatId),
            maxId: event.maxId,
          });
        } else if (
          event instanceof Api.UpdateUserTyping ||
          event instanceof Api.UpdateChatUserTyping ||
          (event as any).className === 'UpdateUserTyping' ||
          (event as any).className === 'UpdateChatUserTyping'
        ) {
          const userId = (event as any).userId || (event as any).fromId?.userId;
          const chatId = (event as any).chatId || userId;
          this.notifyUpdate(sessionId, 'user_typing', {
            chatId: String(chatId),
            userId: String(userId),
            action: 'typing',
          });
        } else if (
          event instanceof Api.UpdatePhoneCall ||
          (event as any).className === 'UpdatePhoneCall'
        ) {
          const callObj = (event as any).phoneCall;
          const callClass = callObj?.className || '';
          this.notifyUpdate(sessionId, 'phone_call_update', {
            status: callClass,
            call: callObj,
            callId: String(callObj?.id || ''),
            participantId: String(callObj?.participantId || callObj?.adminId || ''),
            isVideo: Boolean(callObj?.video),
            reason: callObj?.reason?.className,
            duration: callObj?.duration || 0,
          });
        }
      } catch {}
    }, new Raw({}));
  }

  /**
   * Start authentication: create temporary client and send verification code
   */
  public async sendCode(
    tempSessionId: string,
    phoneNumber: string,
    customApiId?: number,
    customApiHash?: string
  ): Promise<{ phoneCodeHash: string; isCodeViaApp?: boolean; timeout?: number }> {
    const { apiId, apiHash } = this.getCredentials(customApiId, customApiHash);

    // Clean up previous pending auth for this session if any
    const existing = this.pendingAuth.get(tempSessionId);
    if (existing) {
      try { await existing.client.disconnect(); } catch {}
    }

    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
      connectionRetries: 5,
      deviceModel: 'Desktop x64',
      systemVersion: 'Windows 11',
      appVersion: '5.10.3',
    });

    await client.connect();

    const result = await client.sendCode(
      { apiId, apiHash },
      phoneNumber
    );

    this.pendingAuth.set(tempSessionId, {
      client,
      phoneNumber,
      phoneCodeHash: result.phoneCodeHash,
      createdAt: Date.now(),
      apiId,
      apiHash,
    });

    return {
      phoneCodeHash: result.phoneCodeHash,
      isCodeViaApp: result.isCodeViaApp,
      timeout: (result as any).timeout,
    };
  }

  /**
   * Verify phone code
   */
  public async verifyCode(
    tempSessionId: string,
    phoneCode: string
  ): Promise<{ requires2FA: boolean; user?: UserProfile; sessionString?: string }> {
    const pending = this.pendingAuth.get(tempSessionId);
    if (!pending) {
      throw new Error('Authentication session expired or not found. Please restart.');
    }

    try {
      await pending.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: pending.phoneNumber,
          phoneCodeHash: pending.phoneCodeHash,
          phoneCode: phoneCode.trim(),
        })
      );

      const me = await pending.client.getMe();
      const sessionString = pending.client.session.save() as unknown as string;
      this.pendingAuth.delete(tempSessionId);

      return {
        requires2FA: false,
        sessionString,
        user: this.mapTelegramUser(me),
      };
    } catch (err: any) {
      const errMsg = String(err?.message || err?.errorMessage || '');
      if (
        errMsg.includes('SESSION_PASSWORD_NEEDED') ||
        err?.errorMessage === 'SESSION_PASSWORD_NEEDED' ||
        err?.code === 401
      ) {
        return { requires2FA: true };
      }
      throw this.formatTelegramError(err);
    }
  }

  /**
   * Verify 2FA password
   */
  public async verify2FA(
    tempSessionId: string,
    password: string
  ): Promise<{ user: UserProfile; sessionString: string }> {
    const pending = this.pendingAuth.get(tempSessionId);
    if (!pending) {
      throw new Error('Authentication session expired or not found. Please restart.');
    }

    try {
      await (pending.client as any).signInWithPassword(
        { apiId: pending.apiId!, apiHash: pending.apiHash! },
        {
          password: async () => password.trim(),
          onError: (err: any) => {
            console.error('2FA error:', err);
          },
        }
      );

      const me = await pending.client.getMe();
      const sessionString = pending.client.session.save() as unknown as string;
      this.pendingAuth.delete(tempSessionId);

      return {
        sessionString,
        user: this.mapTelegramUser(me),
      };
    } catch (err: any) {
      throw this.formatTelegramError(err);
    }
  }

  /**
   * Save a newly authenticated session
   */
  public registerAuthenticatedSession(sessionId: string, sessionString: string, user: UserProfile): void {
    saveUserSession(sessionId, sessionString, {
      userId: user.id,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
  }

  /**
   * Get list of all available stored accounts
   */
  public async getAvailableAccounts(currentSessionId?: string): Promise<AccountInfo[]> {
    const stored = getAllStoredSessions();
    const accounts: AccountInfo[] = [];

    for (const item of stored) {
      const meta = item.meta;
      const user: UserProfile = {
        id: meta?.userId || item.sessionId,
        firstName: meta?.firstName || 'Telegram User',
        lastName: meta?.lastName,
        username: meta?.username,
        phone: meta?.phone,
        avatarUrl: meta?.avatarUrl || `/api/media/avatar/${meta?.userId || item.sessionId}`,
        isSelf: true,
      };

      accounts.push({
        sessionId: item.sessionId,
        user,
        isCurrent: item.sessionId === currentSessionId,
        createdAt: meta?.createdAt,
        lastUsedAt: meta?.lastUsedAt,
      });
    }

    return accounts;
  }

  /**
   * Terminate and clean up session
   */
  public async logout(sessionId: string): Promise<void> {
    const client = this.activeClients.get(sessionId);
    if (client) {
      try {
        await client.invoke(new Api.auth.LogOut());
      } catch {}
      try {
        await client.disconnect();
      } catch {}
      this.activeClients.delete(sessionId);
    }
    deleteUserSession(sessionId);
  }

  /**
   * Format GramJS / MTProto error into user-friendly message
   */
  private formatTelegramError(err: any): Error {
    const raw = String(err?.message || err?.errorMessage || '');
    if (raw.includes('PHONE_NUMBER_INVALID')) {
      return new Error('Nomor telepon tidak valid. Periksa kembali kode negara dan nomor Anda.');
    }
    if (raw.includes('PHONE_CODE_INVALID')) {
      return new Error('Kode verifikasi salah. Silakan periksa kembali.');
    }
    if (raw.includes('PHONE_CODE_EXPIRED')) {
      return new Error('Kode verifikasi telah kedaluwarsa. Silakan minta kode baru.');
    }
    if (raw.includes('PASSWORD_HASH_INVALID')) {
      return new Error('Kata sandi 2FA salah.');
    }
    if (raw.includes('FLOOD_WAIT')) {
      const seconds = raw.match(/\d+/)?.[0] || 'beberapa';
      return new Error(`Terlalu banyak permintaan (Flood Wait). Harap tunggu ${seconds} detik.`);
    }
    if (raw.includes('API_ID_INVALID')) {
      return new Error('TELEGRAM_API_ID atau TELEGRAM_API_HASH tidak valid.');
    }
    return new Error(raw || 'Terjadi kesalahan pada Telegram.');
  }

  private mapTelegramUser(user: any): UserProfile {
    return {
      id: String(user.id),
      firstName: user.firstName || '',
      lastName: user.lastName || undefined,
      username: user.username || undefined,
      phone: user.phone || undefined,
      isSelf: Boolean(user.isSelf),
      status: user.status ? 'Aktif' : undefined,
    };
  }
}

export const telegramManager = new TelegramManager();
