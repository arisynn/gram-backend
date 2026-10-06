import { TelegramClient, Api } from 'telegram';
import type { TelegramContact, GroupDetail, ChannelDetail, GlobalSearchResult } from '../shared/types';

export async function fetchContacts(client: TelegramClient): Promise<TelegramContact[]> {
  try {
    const result = await client.invoke(new Api.contacts.GetContacts({ hash: 0 as any })) as any;
    if (!result || !result.users) return [];

    return result.users.map((u: any) => ({
      id: String(u.id),
      firstName: u.firstName || '',
      lastName: u.lastName || undefined,
      username: u.username || undefined,
      phone: u.phone || undefined,
      status: u.status ? 'online' : undefined,
      avatarUrl: `/api/media/avatar/${u.id}`,
    }));
  } catch (err) {
    console.error('Failed to get contacts:', err);
    return [];
  }
}

export async function fetchGroupDetail(client: TelegramClient, chatId: string): Promise<GroupDetail> {
  const entity = await client.getEntity(chatId) as any;
  let membersCount = entity.participantsCount || 0;
  let members: any[] = [];

  try {
    const participants = await client.getParticipants(entity, { limit: 50 });
    members = participants.map((p: any) => ({
      id: String(p.id),
      name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.username || 'Member',
      username: p.username,
      status: p.status ? 'online' : undefined,
      avatarUrl: `/api/media/avatar/${p.id}`,
    }));
    if (!membersCount) membersCount = members.length;
  } catch {}

  return {
    id: String(entity.id),
    title: entity.title || 'Group',
    about: (entity as any).about,
    avatarUrl: `/api/media/avatar/${entity.id}`,
    membersCount,
    members,
  };
}

export async function fetchChannelDetail(client: TelegramClient, channelId: string): Promise<ChannelDetail> {
  const entity = await client.getEntity(channelId) as any;
  let subscribersCount = entity.participantsCount || 0;
  let isJoined = !entity.left;

  return {
    id: String(entity.id),
    title: entity.title || 'Channel',
    about: (entity as any).about,
    username: entity.username,
    avatarUrl: `/api/media/avatar/${entity.id}`,
    subscribersCount,
    isJoined,
  };
}

export async function joinChannel(client: TelegramClient, channelId: string): Promise<void> {
  const entity = await client.getEntity(channelId);
  await client.invoke(new Api.channels.JoinChannel({ channel: entity as any }));
}

export async function leaveChannel(client: TelegramClient, channelId: string): Promise<void> {
  const entity = await client.getEntity(channelId);
  await client.invoke(new Api.channels.LeaveChannel({ channel: entity as any }));
}

export async function toggleChatPin(client: TelegramClient, chatId: string, pinned: boolean): Promise<void> {
  const entity = await client.getEntity(chatId);
  await client.invoke(new Api.messages.ToggleDialogPin({
    peer: entity as any,
    pinned,
  }));
}

export async function toggleChatArchive(client: TelegramClient, chatId: string, archived: boolean): Promise<void> {
  const entity = await client.getEntity(chatId);
  await client.invoke(new Api.folders.EditPeerFolders({
    folderPeers: [
      new Api.InputFolderPeer({
        peer: entity as any,
        folderId: archived ? 1 : 0,
      }),
    ],
  }));
}

export async function searchGlobal(client: TelegramClient, query: string): Promise<GlobalSearchResult> {
  const trimmed = query.trim();
  const searchResult: GlobalSearchResult = {
    users: [],
    chats: [],
    messages: [],
  };

  // If starts with @ or is a username
  if (trimmed.startsWith('@') || /^[a-zA-Z0-9_]{4,}$/.test(trimmed)) {
    try {
      const username = trimmed.replace(/^@/, '');
      const entity = await client.getEntity(username) as any;
      if (entity) {
        let type: 'user' | 'channel' | 'group' | 'bot' = 'user';
        if (entity.broadcast) type = 'channel';
        else if (entity.megagroup || entity.participantsCount) type = 'group';
        else if (entity.bot) type = 'bot';

        searchResult.publicEntity = {
          id: String(entity.id),
          title: entity.title || `${entity.firstName || ''} ${entity.lastName || ''}`.trim() || entity.username,
          username: entity.username || username,
          type,
        };
      }
    } catch {}
  }

  // Contacts/Global Search
  try {
    const res = await client.invoke(new Api.contacts.Search({ q: trimmed, limit: 15 })) as any;
    if (res && res.users) {
      searchResult.users = res.users.map((u: any) => ({
        id: String(u.id),
        firstName: u.firstName || '',
        lastName: u.lastName || undefined,
        username: u.username || undefined,
        phone: u.phone || undefined,
        avatarUrl: `/api/media/avatar/${u.id}`,
      }));
    }
  } catch {}

  return searchResult;
}

export async function fetchPostComments(
  client: TelegramClient,
  channelId: string,
  postId: number
): Promise<any[]> {
  try {
    const channelEntity = await client.getEntity(channelId);

    // 1. Try standard MTProto messages.GetReplies
    try {
      const repliesRes = await client.invoke(
        new Api.messages.GetReplies({
          peer: channelEntity as any,
          msgId: postId,
          offsetId: 0,
          addOffset: 0,
          limit: 50,
          maxId: 0,
          minId: 0,
          hash: BigInt(0) as any,
        })
      ) as any;

      if (repliesRes && repliesRes.messages && repliesRes.messages.length > 0) {
        const usersMap = new Map<string, any>();
        if (repliesRes.users) {
          repliesRes.users.forEach((u: any) => usersMap.set(String(u.id), u));
        }

        return repliesRes.messages
          .filter((m: any) => m && m.id && m.id !== postId)
          .map((r: any) => {
            const senderUserId = String(r.senderId || r.fromId?.userId || '');
            const senderUser = usersMap.get(senderUserId);
            const name = senderUser
              ? `${senderUser.firstName || ''} ${senderUser.lastName || ''}`.trim() || senderUser.username || 'User'
              : 'User';
            return {
              id: r.id,
              senderId: senderUserId,
              senderName: name,
              text: r.message || r.text || '',
              date: r.date,
              avatarUrl: senderUserId ? `/api/media/avatar/${senderUserId}` : undefined,
            };
          });
      }
    } catch {}

    // 2. Fallback to getDiscussionMessage
    const discussion = await (client as any).getDiscussionMessage(channelEntity, postId);
    if (!discussion) return [];

    const replies = await client.getMessages(discussion, { replyTo: discussion.id, limit: 50 });
    return replies.map((r: any) => ({
      id: r.id,
      senderId: String(r.senderId || ''),
      senderName: r.sender ? ((r.sender as any).firstName || (r.sender as any).title || 'User') : 'User',
      text: r.message || r.text || '',
      date: r.date,
      avatarUrl: r.senderId ? `/api/media/avatar/${r.senderId}` : undefined,
    }));
  } catch (e) {
    console.error('Error fetching channel comments:', e);
    return [];
  }
}

export async function sendPostComment(
  client: TelegramClient,
  channelId: string,
  postId: number,
  text: string
): Promise<any> {
  const channelEntity = await client.getEntity(channelId);
  try {
    const discussion = await (client as any).getDiscussionMessage(channelEntity, postId);
    if (discussion) {
      const sent = await client.sendMessage(discussion, {
        message: text,
        replyTo: discussion.id,
      });
      return {
        id: sent.id,
        senderId: String(sent.senderId || ''),
        senderName: 'You',
        text: sent.message || text,
        date: sent.date || Math.floor(Date.now() / 1000),
      };
    }
  } catch {}

  // Fallback to direct channel comment reply
  const sent = await client.sendMessage(channelEntity, {
    message: text,
    replyTo: postId,
  });

  return {
    id: sent.id,
    senderId: String(sent.senderId || ''),
    senderName: 'You',
    text: sent.message || text,
    date: sent.date || Math.floor(Date.now() / 1000),
  };
}

export async function addTelegramContact(
  client: TelegramClient,
  phone: string,
  firstName: string,
  lastName?: string
): Promise<TelegramContact> {
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  const res = await client.invoke(
    new Api.contacts.ImportContacts({
      contacts: [
        new Api.InputPhoneContact({
          clientId: BigInt(Date.now()) as any,
          phone: cleanPhone,
          firstName: firstName.trim(),
          lastName: (lastName || '').trim(),
        }),
      ],
    })
  ) as any;

  if (res && res.users && res.users.length > 0) {
    const u = res.users[0];
    return {
      id: String(u.id),
      firstName: u.firstName || firstName,
      lastName: u.lastName || lastName,
      username: u.username,
      phone: u.phone || cleanPhone,
      avatarUrl: `/api/media/avatar/${u.id}`,
    };
  }

  return {
    id: `temp_${Date.now()}`,
    firstName,
    lastName,
    phone: cleanPhone,
  };
}

import { CustomFile } from 'telegram/client/uploads';

export async function uploadUserProfilePhoto(
  client: TelegramClient,
  buffer: Buffer,
  fileName: string = 'avatar.jpg'
): Promise<any> {
  const toUpload = new CustomFile(fileName, buffer.length, '', buffer);
  const file = await client.uploadFile({
    file: toUpload,
    workers: 1,
  });

  await client.invoke(
    new Api.photos.UploadProfilePhoto({
      file: file,
    })
  );

  const me = await client.getMe() as any;
  return {
    id: String(me.id),
    firstName: me.firstName || '',
    lastName: me.lastName,
    username: me.username,
    phone: me.phone,
    avatarUrl: `/api/media/avatar/${me.id}?t=${Date.now()}`,
    isSelf: true,
  };
}

export async function updateUserProfile(
  client: TelegramClient,
  data: { firstName?: string; lastName?: string; bio?: string; username?: string; photoBuffer?: Buffer }
): Promise<any> {
  if (data.photoBuffer) {
    try {
      await uploadUserProfilePhoto(client, data.photoBuffer);
    } catch (photoErr) {
      console.error('Error uploading profile photo:', photoErr);
    }
  }

  if (data.firstName !== undefined || data.lastName !== undefined || data.bio !== undefined) {
    await client.invoke(
      new Api.account.UpdateProfile({
        firstName: data.firstName,
        lastName: data.lastName,
        about: data.bio,
      })
    );
  }

  if (data.username !== undefined) {
    const cleanUser = data.username.replace(/^@/, '').trim();
    try {
      await client.invoke(new Api.account.UpdateUsername({ username: cleanUser }));
    } catch (err: any) {
      console.error('Error updating username:', err);
    }
  }

  const me = await client.getMe() as any;
  return {
    id: String(me.id),
    firstName: me.firstName || '',
    lastName: me.lastName,
    username: me.username,
    phone: me.phone,
    bio: data.bio,
    avatarUrl: `/api/media/avatar/${me.id}?t=${Date.now()}`,
    isSelf: true,
  };
}
