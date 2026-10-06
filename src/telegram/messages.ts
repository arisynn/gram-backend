import { TelegramClient, Api } from 'telegram';
import { CustomFile } from 'telegram/client/uploads';
import type { ChatMessage, MessageMedia } from '../shared/types';

export async function fetchMessages(
  client: TelegramClient,
  chatId: string,
  limit: number = 50,
  offsetId?: number
): Promise<ChatMessage[]> {
  let entity = await resolveEntitySafe(client, chatId);
  if (!entity) {
    entity = await client.getEntity(chatId);
  }

  const messages = await client.getMessages(entity, {
    limit,
    offsetId: offsetId || 0,
  });

  const result: ChatMessage[] = [];

  for (const msg of messages) {
    if (!msg || !msg.id) continue;

    let media: MessageMedia | undefined;
    if (msg.photo) {
      media = {
        type: 'photo',
        url: `/api/media/message/${encodeURIComponent(chatId)}/${msg.id}`,
      };
    } else if (msg.document) {
      const doc = msg.document as any;
      const mime = doc.mimeType || '';
      
      const stickerAttr = doc.attributes?.find(
        (a: any) => a instanceof Api.DocumentAttributeSticker || a.className === 'DocumentAttributeSticker'
      );
      const isSticker = Boolean(stickerAttr);
      let stickerType: 'static' | 'animated' | 'video' | undefined;
      
      let type: MessageMedia['type'] = 'document';
      if (isSticker) {
        type = 'sticker';
        if (mime.includes('webm')) stickerType = 'video';
        else if (mime.includes('tgsticker')) stickerType = 'animated';
        else stickerType = 'static';
      } else if (mime.startsWith('image/')) type = 'photo';
      else if (mime.startsWith('video/')) type = 'video';
      else if (mime.startsWith('audio/ogg') || mime.includes('opus')) type = 'voice';
      else if (mime.startsWith('audio/')) type = 'audio';

      media = {
        type,
        url: `/api/media/message/${encodeURIComponent(chatId)}/${msg.id}`,
        fileName: doc.attributes?.find((a: any) => a.fileName)?.fileName || (type === 'voice' ? 'voice.ogg' : 'file'),
        fileSize: doc.size ? Number(doc.size) : undefined,
        mimeType: mime,
        duration: doc.attributes?.find((a: any) => a.duration)?.duration,
        isSticker,
        stickerType,
        altEmoji: stickerAttr?.alt,
      };
    }

    const replies = (msg as any).replies;
    const repliesCount = replies ? Number(replies.replies || 0) : undefined;
    const hasComments = replies ? Boolean(replies.comments || (replies.replies && replies.replies > 0)) : undefined;

    // Reactions
    const reactions: Array<{ emoji: string; count: number; isChosen?: boolean }> = [];
    if ((msg as any).reactions?.results) {
      for (const r of (msg as any).reactions.results) {
        const emoji = r.reaction?.emoticon || '👍';
        reactions.push({
          emoji,
          count: r.count || 1,
          isChosen: Boolean(r.chosenOrder !== undefined),
        });
      }
    }

    // In MTProto, for outgoing message: unread property indicates not yet read by recipient
    const isOut = Boolean(msg.out);
    const isRead = isOut ? !(msg as any).unread : true;

    result.push({
      id: msg.id,
      chatId,
      senderId: String(msg.senderId || ''),
      senderName: msg.sender ? ((msg.sender as any).firstName || (msg.sender as any).title || 'User') : '',
      text: msg.message || msg.text || '',
      date: msg.date,
      isOutgoing: isOut,
      isRead,
      isEdited: Boolean((msg as any).editDate),
      isPinned: Boolean(msg.pinned),
      replyToMsgId: msg.replyTo?.replyToMsgId,
      media,
      reactions: reactions.length > 0 ? reactions : undefined,
      repliesCount,
      hasComments,
    });
  }

  // Telegram returns messages newest to oldest, reverse for chronological view
  return result.reverse();
}

export async function sendChatMessage(
  client: TelegramClient,
  chatId: string,
  text: string,
  replyToMsgId?: number
): Promise<ChatMessage> {
  let entity = await resolveEntitySafe(client, chatId);
  if (!entity) {
    entity = await client.getEntity(chatId);
  }

  const sent = await client.sendMessage(entity, {
    message: text,
    replyTo: replyToMsgId,
  });

  return {
    id: sent.id,
    chatId,
    senderId: String(sent.senderId || ''),
    senderName: 'You',
    text: sent.message || text,
    date: sent.date || Math.floor(Date.now() / 1000),
    isOutgoing: true,
    isRead: false,
    replyToMsgId,
  };
}

export async function editChatMessage(
  client: TelegramClient,
  chatId: string,
  messageId: number,
  newText: string
): Promise<void> {
  let entity = await resolveEntitySafe(client, chatId);
  if (!entity) {
    entity = await client.getEntity(chatId);
  }
  await client.editMessage(entity, {
    message: messageId,
    text: newText,
  });
}

export async function deleteChatMessage(
  client: TelegramClient,
  chatId: string,
  messageId: number
): Promise<void> {
  let entity = await resolveEntitySafe(client, chatId);
  if (!entity) {
    entity = await client.getEntity(chatId);
  }
  await client.deleteMessages(entity, [messageId], { revoke: true });
}

export async function forwardChatMessage(
  client: TelegramClient,
  fromChatId: string,
  toChatId: string,
  messageId: number
): Promise<void> {
  let toEntity = await resolveEntitySafe(client, toChatId);
  if (!toEntity) toEntity = await client.getEntity(toChatId);

  let fromEntity = await resolveEntitySafe(client, fromChatId);
  if (!fromEntity) fromEntity = await client.getEntity(fromChatId);

  await client.forwardMessages(toEntity, {
    messages: [messageId],
    fromPeer: fromEntity,
  });
}

export async function sendMediaMessage(
  client: TelegramClient,
  chatId: string,
  buffer: Buffer,
  filename: string,
  caption?: string,
  replyToMsgId?: number
): Promise<ChatMessage> {
  let entity = await resolveEntitySafe(client, chatId);
  if (!entity) {
    entity = await client.getEntity(chatId);
  }

  (buffer as any).name = filename;
  const customFile = new CustomFile(filename, buffer.length, '', buffer);
  const isImage = Boolean(filename.match(/\.(jpg|jpeg|png|webp|gif)$/i));
  const isVideo = Boolean(filename.match(/\.(mp4|mov|avi|webm)$/i));
  const isAudio = Boolean(filename.match(/\.(ogg|mp3|wav|m4a|aac|opus)$/i));
  const isVoice = Boolean(filename.match(/\.(ogg|opus)$/i)) && filename.includes('voice');

  const uploadedFile = await client.uploadFile({
    file: customFile,
    workers: 1,
  });

  const sent = await client.sendFile(entity, {
    file: uploadedFile,
    caption: caption || '',
    replyTo: replyToMsgId,
    forceDocument: !isImage && !isVideo && !isAudio,
    voiceNote: isVoice,
    workers: 1,
  });

  let mediaType: MessageMedia['type'] = 'document';
  if (isImage) mediaType = 'photo';
  else if (isVideo) mediaType = 'video';
  else if (isVoice) mediaType = 'voice';
  else if (isAudio) mediaType = 'audio';

  return {
    id: sent.id,
    chatId,
    senderId: String(sent.senderId || ''),
    senderName: 'You',
    text: sent.message || caption || '',
    date: sent.date || Math.floor(Date.now() / 1000),
    isOutgoing: true,
    isRead: false,
    replyToMsgId,
    media: {
      type: mediaType,
      url: `/api/media/message/${encodeURIComponent(chatId)}/${sent.id}`,
      fileName: filename,
      fileSize: buffer.length,
    },
  };
}

export async function resolveEntitySafe(client: TelegramClient, peerId: string | number | bigint): Promise<any> {
  const str = String(peerId).trim();
  // 1. Try raw string
  try {
    return await client.getEntity(str);
  } catch {}

  // 2. Try BigInt
  if (/^-?\d+$/.test(str)) {
    try {
      return await client.getEntity(BigInt(str) as any);
    } catch {}
    try {
      return await client.getEntity(Number(str) as any);
    } catch {}
  }

  // 3. Channel/supergroup with -100 prefix
  if (str.startsWith('-100')) {
    try {
      return await client.getEntity(BigInt(str.slice(4)) as any);
    } catch {}
  }

  // 4. Input entity fallback
  try {
    return await client.getInputEntity(peerId as any);
  } catch {}

  return null;
}

const mediaCache = new Map<string, { buffer: Buffer; mimeType?: string; fileName?: string }>();

export async function downloadMessageMedia(
  client: TelegramClient,
  chatId: string,
  messageId: number
): Promise<{ buffer: Buffer; mimeType?: string; fileName?: string } | null> {
  const cacheKey = `${chatId}_${messageId}`;
  if (mediaCache.has(cacheKey)) {
    return mediaCache.get(cacheKey)!;
  }

  try {
    const entity = await resolveEntitySafe(client, chatId);
    if (!entity) return null;

    const messages = await client.getMessages(entity, { ids: [messageId] });
    if (!messages || messages.length === 0) return null;

    const msg = messages[0];
    if (!msg || !msg.media) return null;

    let mimeType = 'application/octet-stream';
    let fileName = `file_${messageId}`;

    if (msg.photo) {
      mimeType = 'image/jpeg';
      fileName = `photo_${messageId}.jpg`;
    } else if (msg.document) {
      const doc = msg.document as any;
      if (doc.mimeType) mimeType = doc.mimeType;
      const nameAttr = doc.attributes?.find((a: any) => a.fileName);
      if (nameAttr?.fileName) fileName = nameAttr.fileName;
    }

    const downloaded = await client.downloadMedia(msg, {});
    if (!downloaded) return null;

    const buffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any);
    const result = { buffer, mimeType, fileName };
    mediaCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error('Error downloading message media:', err);
    return null;
  }
}

const avatarCache = new Map<string, Buffer>();

export async function downloadAvatar(
  client: TelegramClient,
  peerId: string
): Promise<Buffer | null> {
  const cacheKey = String(peerId);
  if (avatarCache.has(cacheKey)) {
    return avatarCache.get(cacheKey)!;
  }
  try {
    const entity = await resolveEntitySafe(client, peerId);
    if (!entity) return null;

    let downloaded: any = null;
    try {
      downloaded = await client.downloadProfilePhoto(entity, { isBig: false });
    } catch {}

    if (!downloaded || downloaded.length === 0) {
      try {
        downloaded = await client.downloadProfilePhoto(entity, { isBig: true });
      } catch {}
    }

    if (!downloaded || downloaded.length === 0) return null;
    const buffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any);
    if (buffer && buffer.length > 0) {
      avatarCache.set(cacheKey, buffer);
      return buffer;
    }
    return null;
  } catch {
    return null;
  }
}

export async function markChatRead(
  client: TelegramClient,
  chatId: string,
  maxId?: number
): Promise<void> {
  try {
    const entity = await resolveEntitySafe(client, chatId);
    if (entity) {
      await client.markAsRead(entity, maxId);
    }
  } catch (err) {
    console.error('Error marking chat as read:', err);
  }
}

export async function sendTypingAction(
  client: TelegramClient,
  chatId: string,
  actionType: 'typing' | 'record-audio' | 'upload-photo' = 'typing'
): Promise<boolean> {
  try {
    const entity = await resolveEntitySafe(client, chatId);
    if (!entity) return false;
    let action: any = new Api.SendMessageTypingAction();
    if (actionType === 'record-audio') {
      action = new Api.SendMessageRecordAudioAction();
    } else if (actionType === 'upload-photo') {
      action = new Api.SendMessageUploadPhotoAction({ progress: 1 });
    }
    await client.invoke(
      new Api.messages.SetTyping({
        peer: entity,
        action,
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function pinChatMessage(
  client: TelegramClient,
  chatId: string,
  messageId: number,
  silent: boolean = false
): Promise<void> {
  const entity = await resolveEntitySafe(client, chatId);
  if (!entity) throw new Error('Chat tidak ditemukan');

  await client.invoke(
    new Api.messages.UpdatePinnedMessage({
      peer: entity,
      id: messageId,
      silent,
      pmOneside: false,
    })
  );
}

export async function unpinChatMessage(
  client: TelegramClient,
  chatId: string,
  messageId?: number
): Promise<void> {
  const entity = await resolveEntitySafe(client, chatId);
  if (!entity) throw new Error('Chat tidak ditemukan');

  await client.invoke(
    new Api.messages.UpdatePinnedMessage({
      peer: entity,
      id: messageId || 0,
      unpin: true,
    })
  );
}

export async function sendReaction(
  client: TelegramClient,
  chatId: string,
  messageId: number,
  emoji: string
): Promise<void> {
  const entity = await resolveEntitySafe(client, chatId);
  if (!entity) throw new Error('Chat tidak ditemukan');

  await client.invoke(
    new Api.messages.SendReaction({
      peer: entity,
      msgId: messageId,
      reaction: [
        new Api.ReactionEmoji({
          emoticon: emoji,
        }),
      ],
    })
  );
}

