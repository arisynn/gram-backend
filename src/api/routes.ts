import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { telegramManager } from '../telegram/client';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { isTelegramConfigured, config } from '../config/env';
import { fetchDialogs } from '../telegram/dialogs';
import {
  fetchMessages,
  sendChatMessage,
  editChatMessage,
  deleteChatMessage,
  forwardChatMessage,
  sendMediaMessage,
  downloadMessageMedia,
  downloadAvatar,
  markChatRead,
  sendTypingAction,
} from '../telegram/messages';
import {
  fetchContacts,
  fetchGroupDetail,
  fetchChannelDetail,
  joinChannel,
  leaveChannel,
  toggleChatPin,
  toggleChatArchive,
  searchGlobal,
  fetchPostComments,
  sendPostComment,
  addTelegramContact,
  updateUserProfile,
} from '../telegram/contacts';
import {
  fetchCallHistory,
  getTelegramCallConfig,
  requestTelegramCall,
  acceptTelegramCall,
  confirmTelegramCall,
  discardTelegramCall,
} from '../telegram/calls';
import { Api } from 'telegram';
import { parseCookies, createSessionCookie, clearSessionCookie } from '../utils/cookie';

export const apiRouter = Router();

// ==========================================
// AUTH ROUTES
// ==========================================

apiRouter.get('/auth/status', async (req: Request, res: Response) => {
  let sessionId: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.substring(7).trim();
  }
  if (!sessionId && req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    sessionId = cookies['gram_session'];
  }

  const configured = isTelegramConfigured();

  if (!sessionId) {
    res.json({
      authenticated: false,
      configured,
      backendVersion: '1.0.0',
    });
    return;
  }

  try {
    const client = await telegramManager.getClientForSession(sessionId);
    if (!client) {
      res.json({
        authenticated: false,
        configured,
        backendVersion: '1.0.0',
      });
      return;
    }

    const me = await client.getMe();
    res.json({
      authenticated: true,
      configured,
      backendVersion: '1.0.0',
      sessionId,
      token: sessionId,
      user: {
        id: String((me as any).id),
        firstName: (me as any).firstName || '',
        lastName: (me as any).lastName || undefined,
        username: (me as any).username || undefined,
        phone: (me as any).phone || undefined,
        isSelf: true,
      },
    });
  } catch (err: any) {
    res.json({
      authenticated: false,
      configured,
      backendVersion: '1.0.0',
    });
  }
});

apiRouter.post('/auth/send-code', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, apiId, apiHash } = req.body;
    if (!phoneNumber) {
      res.status(400).json({ error: 'Nomor telepon wajib diisi.' });
      return;
    }

    const tempSessionId = crypto.randomBytes(16).toString('hex');
    const result = await telegramManager.sendCode(tempSessionId, phoneNumber, apiId, apiHash);

    res.json({
      success: true,
      tempSessionId,
      phoneCodeHash: result.phoneCodeHash,
      isCodeViaApp: result.isCodeViaApp,
      timeout: result.timeout,
    });
  } catch (err: any) {
    console.error('Error in send-code:', err);
    res.status(400).json({ error: err.message || 'Gagal mengirim kode verifikasi.' });
  }
});

apiRouter.post('/auth/verify-code', async (req: Request, res: Response) => {
  try {
    const { tempSessionId, code } = req.body;
    if (!tempSessionId || !code) {
      res.status(400).json({ error: 'Data verifikasi tidak lengkap.' });
      return;
    }

    const result = await telegramManager.verifyCode(tempSessionId, code);

    if (result.requires2FA) {
      res.json({
        success: true,
        requires2FA: true,
      });
      return;
    }

    const sessionId = crypto.randomBytes(24).toString('hex');
    telegramManager.registerAuthenticatedSession(sessionId, result.sessionString!, result.user!);

    res.setHeader('Set-Cookie', createSessionCookie(sessionId, config.cookieSecure));
    res.json({
      success: true,
      requires2FA: false,
      token: sessionId,
      user: result.user,
    });
  } catch (err: any) {
    console.error('Error in verify-code:', err);
    res.status(400).json({ error: err.message || 'Gagal memverifikasi kode.' });
  }
});

apiRouter.post('/auth/verify-2fa', async (req: Request, res: Response) => {
  try {
    const { tempSessionId, password } = req.body;
    if (!tempSessionId || !password) {
      res.status(400).json({ error: 'Kata sandi 2FA wajib diisi.' });
      return;
    }

    const result = await telegramManager.verify2FA(tempSessionId, password);
    const sessionId = crypto.randomBytes(24).toString('hex');
    telegramManager.registerAuthenticatedSession(sessionId, result.sessionString, result.user);

    res.setHeader('Set-Cookie', createSessionCookie(sessionId, config.cookieSecure));
    res.json({
      success: true,
      token: sessionId,
      user: result.user,
    });
  } catch (err: any) {
    console.error('Error in verify-2fa:', err);
    res.status(400).json({ error: err.message || 'Gagal memverifikasi kata sandi 2FA.' });
  }
});

apiRouter.post('/auth/logout', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.sessionId) {
      await telegramManager.logout(req.sessionId);
    }
    res.setHeader('Set-Cookie', clearSessionCookie(config.cookieSecure));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal keluar sesi.' });
  }
});

// ==========================================
// MULTI-ACCOUNT MANAGEMENT ROUTES (Unlimited)
// ==========================================

apiRouter.get('/accounts', async (req: Request, res: Response) => {
  try {
    let sessionId: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionId = authHeader.substring(7).trim();
    }
    if (!sessionId && req.headers.cookie) {
      const cookies = parseCookies(req.headers.cookie);
      sessionId = cookies['gram_session'];
    }
    if (!sessionId && req.query) {
      sessionId = (req.query.token as string) || (req.query.session as string);
    }

    const accounts = await telegramManager.getAvailableAccounts(sessionId);
    res.json({
      accounts,
      currentSessionId: sessionId,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal mengambil daftar akun.', accounts: [] });
  }
});

apiRouter.post('/accounts/switch', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: 'Session ID diperlukan.' });
      return;
    }

    const client = await telegramManager.getClientForSession(sessionId);
    if (!client) {
      res.status(404).json({ error: 'Akun tidak ditemukan atau sesi berakhir.' });
      return;
    }

    const me = await client.getMe();
    res.setHeader('Set-Cookie', createSessionCookie(sessionId, config.cookieSecure));
    res.json({
      success: true,
      token: sessionId,
      user: {
        id: String((me as any).id),
        firstName: (me as any).firstName || '',
        lastName: (me as any).lastName || undefined,
        username: (me as any).username || undefined,
        phone: (me as any).phone || undefined,
        avatarUrl: `/api/media/avatar/${(me as any).id}`,
        isSelf: true,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal beralih akun.' });
  }
});

apiRouter.post('/accounts/logout', async (req: Request, res: Response) => {
  try {
    let sessionId = req.body?.sessionId;
    if (!sessionId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        sessionId = authHeader.substring(7).trim();
      }
      if (!sessionId && req.headers.cookie) {
        const cookies = parseCookies(req.headers.cookie);
        sessionId = cookies['gram_session'];
      }
    }

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID diperlukan.' });
      return;
    }

    await telegramManager.logout(sessionId);

    const remaining = await telegramManager.getAvailableAccounts();
    const nextAccount = remaining.length > 0 ? remaining[0] : null;

    if (nextAccount) {
      res.setHeader('Set-Cookie', createSessionCookie(nextAccount.sessionId, config.cookieSecure));
      res.json({
        success: true,
        hasRemaining: true,
        nextSessionId: nextAccount.sessionId,
        nextUser: nextAccount.user,
        accounts: remaining,
      });
    } else {
      res.setHeader('Set-Cookie', clearSessionCookie(config.cookieSecure));
      res.json({
        success: true,
        hasRemaining: false,
        accounts: [],
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal menghapus akun.' });
  }
});

// ==========================================
// PROFILE ROUTES
// ==========================================

apiRouter.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = await req.telegramClient.getMe();
    res.json({
      id: String((me as any).id),
      firstName: (me as any).firstName || '',
      lastName: (me as any).lastName || undefined,
      username: (me as any).username || undefined,
      phone: (me as any).phone || undefined,
      isSelf: true,
      avatarUrl: `/api/media/avatar/${(me as any).id}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal mengambil data profil.' });
  }
});

apiRouter.put('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { firstName, lastName, about } = req.body;
    if (firstName !== undefined) {
      await req.telegramClient.invoke(
        new Api.account.UpdateProfile({
          firstName,
          lastName: lastName || '',
          about: about || '',
        })
      );
    }
    const me = await req.telegramClient.getMe();
    res.json({
      id: String((me as any).id),
      firstName: (me as any).firstName || '',
      lastName: (me as any).lastName || undefined,
      username: (me as any).username || undefined,
      phone: (me as any).phone || undefined,
      isSelf: true,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal memperbarui profil.' });
  }
});

// ==========================================
// CHATS & DIALOGS
// ==========================================

apiRouter.get('/chats', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string || '50', 10);
    const chats = await fetchDialogs(req.telegramClient, limit);
    res.json(chats);
  } catch (err: any) {
    console.error('Error fetching chats:', err);
    res.status(500).json({ error: err.message || 'Gagal mengambil daftar percakapan.' });
  }
});

apiRouter.post('/chats/:chatId/pin', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const chatId = String(req.params.chatId);
    const { pinned = true } = req.body;
    await toggleChatPin(req.telegramClient, chatId, pinned);
    res.json({ success: true, pinned });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menyematkan chat.' });
  }
});

apiRouter.post('/chats/:chatId/archive', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const chatId = String(req.params.chatId);
    const { archived = true } = req.body;
    await toggleChatArchive(req.telegramClient, chatId, archived);
    res.json({ success: true, archived });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal mengarsipkan chat.' });
  }
});

// ==========================================
// MESSAGES
// ==========================================

apiRouter.get('/messages/:chatId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const chatId = String(req.params.chatId);
    const limit = parseInt(req.query.limit as string || '50', 10);
    const offsetId = req.query.offsetId ? parseInt(req.query.offsetId as string, 10) : undefined;

    const messages = await fetchMessages(req.telegramClient, chatId, limit, offsetId);
    res.json(messages);
  } catch (err: any) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: err.message || 'Gagal memuat riwayat pesan.' });
  }
});

apiRouter.post('/messages/:chatId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const chatId = String(req.params.chatId);
    const { text, replyToMsgId } = req.body;
    if (!text || !text.trim()) {
      res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
      return;
    }

    const sent = await sendChatMessage(req.telegramClient, chatId, text.trim(), replyToMsgId);
    res.json(sent);
  } catch (err: any) {
    console.error('Error sending message:', err);
    res.status(500).json({ error: err.message || 'Gagal mengirim pesan.' });
  }
});

apiRouter.put('/messages/:chatId/:msgId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const chatId = String(req.params.chatId);
    const msgId = parseInt(String(req.params.msgId), 10);
    const { text } = req.body;

    if (!text || !text.trim()) {
      res.status(400).json({ error: 'Teks pesan tidak boleh kosong.' });
      return;
    }

    await editChatMessage(req.telegramClient, chatId, msgId, text.trim());
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal mengubah pesan.' });
  }
});

apiRouter.delete('/messages/:chatId/:msgId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const chatId = String(req.params.chatId);
    const msgId = parseInt(String(req.params.msgId), 10);

    await deleteChatMessage(req.telegramClient, chatId, msgId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menghapus pesan.' });
  }
});

apiRouter.post('/messages/:chatId/forward', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const toChatId = String(req.params.chatId);
    const { fromChatId, messageId } = req.body;

    if (!fromChatId || !messageId) {
      res.status(400).json({ error: 'Parameter teruskan pesan tidak lengkap.' });
      return;
    }

    await forwardChatMessage(req.telegramClient, fromChatId, toChatId, parseInt(messageId, 10));
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal meneruskan pesan.' });
  }
});

apiRouter.post('/messages/:chatId/media', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const chatId = String(req.params.chatId);
    const { base64Data, filename, caption, replyToMsgId } = req.body;

    if (!base64Data || !filename) {
      res.status(400).json({ error: 'Berkas tidak lengkap.' });
      return;
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const sent = await sendMediaMessage(
      req.telegramClient,
      chatId,
      buffer,
      filename,
      caption,
      replyToMsgId
    );
    res.json(sent);
  } catch (err: any) {
    console.error('Error sending media:', err);
    res.status(500).json({ error: err.message || 'Gagal mengirim berkas.' });
  }
});

apiRouter.post('/messages/:chatId/read', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const chatId = String(req.params.chatId);
    const maxId = req.body.maxId ? parseInt(req.body.maxId, 10) : undefined;
    await markChatRead(req.telegramClient, chatId, maxId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal menandai pesan telah dibaca.' });
  }
});

apiRouter.post('/messages/:chatId/typing', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const chatId = String(req.params.chatId);
    const { action } = req.body || {};
    await sendTypingAction(req.telegramClient, chatId, action || 'typing');
    res.json({ success: true });
  } catch (err: any) {
    res.json({ success: true });
  }
});

// ==========================================
// MEDIA SERVING (Avatars & Photos)
// ==========================================

apiRouter.get('/media/avatar/:peerId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const peerId = String(req.params.peerId);
    const buffer = await downloadAvatar(req.telegramClient, peerId);
    if (!buffer) {
      res.status(404).send('Not found');
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch {
    res.status(404).send('Not found');
  }
});

apiRouter.get('/media/message/:chatId/:msgId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const chatId = String(req.params.chatId);
    const msgId = parseInt(String(req.params.msgId), 10);

    const media = await downloadMessageMedia(req.telegramClient, chatId, msgId);
    if (!media) {
      res.status(404).send('Not found');
      return;
    }

    res.setHeader('Content-Type', media.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (media.fileName) {
      res.setHeader('Content-Disposition', `inline; filename="${media.fileName}"`);
    }
    res.send(media.buffer);
  } catch {
    res.status(404).send('Not found');
  }
});

// ==========================================
// PROFILE MANAGEMENT
// ==========================================

apiRouter.put('/profile', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { firstName, lastName, bio, username, photoBase64 } = req.body;
    let photoBuffer: Buffer | undefined = undefined;
    if (photoBase64) {
      photoBuffer = Buffer.from(photoBase64, 'base64');
    }
    const updated = await updateUserProfile(req.telegramClient, {
      firstName,
      lastName,
      bio,
      username,
      photoBuffer,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal memperbarui profil.' });
  }
});

apiRouter.post('/profile/photo', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { base64Data } = req.body;
    if (!base64Data) {
      res.status(400).json({ error: 'Foto tidak valid.' });
      return;
    }
    const buffer = Buffer.from(base64Data, 'base64');
    const updated = await updateUserProfile(req.telegramClient, {
      photoBuffer: buffer,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal mengunggah foto profil.' });
  }
});

// ==========================================
// CONTACTS & GLOBAL SEARCH
// ==========================================

apiRouter.get('/contacts', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const contacts = await fetchContacts(req.telegramClient);
    res.json(contacts);
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal memuat kontak.' });
  }
});

apiRouter.post('/contacts', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { phone, firstName, lastName } = req.body;
    if (!phone || !firstName) {
      res.status(400).json({ error: 'Nomor telepon dan nama depan wajib diisi.' });
      return;
    }
    const contact = await addTelegramContact(req.telegramClient, phone, firstName, lastName);
    res.json(contact);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menambahkan kontak.' });
  }
});

apiRouter.get('/search', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const query = String(req.query.q || '');
    if (!query.trim()) {
      res.json({ users: [], chats: [], messages: [] });
      return;
    }

    const results = await searchGlobal(req.telegramClient, query);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal melakukan pencarian.' });
  }
});

// ==========================================
// GROUPS & CHANNELS
// ==========================================

apiRouter.get('/groups/:chatId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const chatId = String(req.params.chatId);
    const detail = await fetchGroupDetail(req.telegramClient, chatId);
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal memuat informasi grup.' });
  }
});

apiRouter.get('/channels/:channelId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelId = String(req.params.channelId);
    const detail = await fetchChannelDetail(req.telegramClient, channelId);
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal memuat informasi channel.' });
  }
});

apiRouter.post('/channels/:channelId/join', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelId = String(req.params.channelId);
    await joinChannel(req.telegramClient, channelId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal bergabung ke channel.' });
  }
});

apiRouter.post('/channels/:channelId/leave', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelId = String(req.params.channelId);
    await leaveChannel(req.telegramClient, channelId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal keluar channel.' });
  }
});

apiRouter.get('/channels/:channelId/posts/:postId/comments', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelId = String(req.params.channelId);
    const postId = parseInt(String(req.params.postId), 10);
    const comments = await fetchPostComments(req.telegramClient, channelId, postId);
    res.json(comments);
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal memuat komentar channel.' });
  }
});

apiRouter.post('/channels/:channelId/posts/:postId/comments', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelId = String(req.params.channelId);
    const postId = parseInt(String(req.params.postId), 10);
    const { text } = req.body;
    if (!text || !text.trim()) {
      res.status(400).json({ error: 'Komentar tidak boleh kosong.' });
      return;
    }
    const comment = await sendPostComment(req.telegramClient, channelId, postId, text.trim());
    res.json(comment);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal mengirim komentar.' });
  }
});

// ==========================================
// TELEGRAM CALLS & CALL HISTORY (tgcalls)
// ==========================================

apiRouter.get('/calls', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string || '50', 10);
    const calls = await fetchCallHistory(req.telegramClient, limit);
    res.json(calls);
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal memuat riwayat panggilan.', calls: [] });
  }
});

apiRouter.get('/calls/config', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const callConfig = await getTelegramCallConfig(req.telegramClient);
    res.json(callConfig);
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal memuat konfigurasi panggilan.' });
  }
});

apiRouter.post('/calls/request', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, isVideo } = req.body;
    if (!userId) {
      res.status(400).json({ error: 'User ID tujuan wajib diisi.' });
      return;
    }
    const result = await requestTelegramCall(req.telegramClient, String(userId), Boolean(isVideo));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal melakukan panggilan Telegram.' });
  }
});

apiRouter.post('/calls/accept', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { callId, accessHash, isVideo } = req.body;
    if (!callId) {
      res.status(400).json({ error: 'callId diperlukan.' });
      return;
    }
    const result = await acceptTelegramCall(req.telegramClient, String(callId), String(accessHash || '0'), Boolean(isVideo));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menerima panggilan.' });
  }
});

apiRouter.post('/calls/confirm', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { callId, accessHash, gBBase64 } = req.body;
    if (!callId) {
      res.status(400).json({ error: 'callId diperlukan.' });
      return;
    }
    const gbBuffer = gBBase64 ? Buffer.from(gBBase64, 'base64') : Buffer.alloc(256);
    const result = await confirmTelegramCall(req.telegramClient, String(callId), String(accessHash || '0'), gbBuffer);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal mengonfirmasi panggilan.' });
  }
});

apiRouter.post('/calls/discard', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { callId, duration = 0, isVideo = false } = req.body;
    await discardTelegramCall(req.telegramClient, String(callId || ''), Number(duration), Boolean(isVideo));
    res.json({ success: true });
  } catch (err: any) {
    res.json({ success: true });
  }
});

