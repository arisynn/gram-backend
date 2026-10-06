import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import type { ChatSummary, ChatType } from '../shared/types';

export async function fetchDialogs(client: TelegramClient, limit: number = 40): Promise<ChatSummary[]> {
  const dialogs = await client.getDialogs({ limit });
  const summaries: ChatSummary[] = [];

  for (const d of dialogs) {
    const entity = d.entity;
    if (!entity) continue;

    let type: ChatType = 'user';
    let title = d.title || d.name || 'Chat';
    let username: string | undefined = undefined;

    if (d.isUser) {
      type = (entity as any).bot ? 'bot' : 'user';
      username = (entity as any).username;
    } else if (d.isGroup) {
      type = 'group';
    } else if (d.isChannel) {
      type = 'channel';
      username = (entity as any).username;
    }

    if ((entity as any).isSelf) {
      type = 'saved';
      title = 'Saved Messages';
    }

    let lastMessage = undefined;
    if (d.message) {
      lastMessage = {
        id: d.message.id,
        text: d.message.message || d.message.text || (d.message.media ? '[Media]' : ''),
        date: d.message.date,
        isOutgoing: Boolean(d.message.out),
      };
    }

    summaries.push({
      id: String(d.id),
      title,
      type,
      username,
      unreadCount: d.unreadCount || 0,
      lastMessage,
      isPinned: Boolean(d.pinned),
      avatarUrl: `/api/media/avatar/${d.id}`,
    });
  }

  return summaries;
}

export async function fetchEntityInfo(client: TelegramClient, peerId: string): Promise<any> {
  try {
    return await client.getEntity(peerId);
  } catch (err) {
    // If integer ID without peer resolution, attempt input peer
    return await client.getEntity(Number(peerId) || peerId);
  }
}
