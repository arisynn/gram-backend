import { TelegramClient, Api } from 'telegram';
import type { CallLog, CallType } from '../shared/types';
import { resolveEntitySafe } from './messages';
import crypto from 'crypto';

export async function fetchCallHistory(
  client: TelegramClient,
  limit: number = 50
): Promise<CallLog[]> {
  try {
    const filter = new Api.InputMessagesFilterPhoneCalls({});
    const res = await client.invoke(
      new Api.messages.Search({
        peer: new Api.InputPeerEmpty(),
        q: '',
        filter,
        minDate: 0,
        maxDate: 0,
        offsetId: 0,
        addOffset: 0,
        limit,
        maxId: 0,
        minId: 0,
        hash: BigInt(0) as any,
      })
    ) as any;

    const messages = res.messages || [];
    const users = res.users || [];
    const usersMap = new Map<string, any>();
    users.forEach((u: any) => usersMap.set(String(u.id), u));

    const callLogs: CallLog[] = [];

    for (const msg of messages) {
      if (!msg || !msg.action) continue;

      const action = msg.action;
      if (!(action instanceof Api.MessageActionPhoneCall) && action.className !== 'MessageActionPhoneCall') {
        continue;
      }

      const isOut = Boolean(msg.out);
      const isVideo = Boolean(action.video);
      const duration = action.duration ? Number(action.duration) : 0;
      const reasonObj = action.reason;
      const reasonName = reasonObj?.className || '';

      let type: CallType = 'incoming';
      if (isOut) {
        if (reasonName === 'PhoneCallDiscardReasonMissed' || reasonName === 'PhoneCallDiscardReasonBusy' || duration === 0) {
          type = 'cancelled';
        } else {
          type = 'outgoing';
        }
      } else {
        if (reasonName === 'PhoneCallDiscardReasonMissed' || reasonName === 'PhoneCallDiscardReasonBusy' || duration === 0) {
          type = 'missed';
        } else {
          type = 'incoming';
        }
      }

      // Determine peer ID
      const peerId = String(msg.peerId?.userId || msg.fromId?.userId || msg.senderId || '');
      const userObj = usersMap.get(peerId);
      const peerName = userObj
        ? `${userObj.firstName || ''} ${userObj.lastName || ''}`.trim() || userObj.username || 'Pengguna Telegram'
        : 'Pengguna Telegram';

      callLogs.push({
        id: msg.id,
        chatId: peerId,
        peerId,
        peerName,
        peerUsername: userObj?.username,
        peerAvatarUrl: peerId ? `/api/media/avatar/${peerId}` : undefined,
        type,
        isVideo,
        duration,
        date: msg.date,
      });
    }

    return callLogs;
  } catch (err) {
    console.error('Error fetching Telegram call history:', err);
    return [];
  }
}

export async function getTelegramCallConfig(client: TelegramClient): Promise<any> {
  try {
    const config = await client.invoke(new Api.phone.GetCallConfig());
    return config;
  } catch (err) {
    console.error('Error getting Telegram call config:', err);
    return {
      g_a_hash: '',
      default_p2p_contacts: true,
    };
  }
}

export async function requestTelegramCall(
  client: TelegramClient,
  userId: string,
  isVideo: boolean = false
): Promise<any> {
  const entity = await resolveEntitySafe(client, userId);
  if (!entity) {
    throw new Error('Pengguna tidak ditemukan.');
  }

  const inputUser = await client.getInputEntity(entity);
  const randomId = Math.floor(Math.random() * 2147483647);
  const randomBytes = crypto.randomBytes(32);
  const gAHash = crypto.createHash('sha256').update(randomBytes).digest();

  try {
    const result = await client.invoke(
      new Api.phone.RequestCall({
        userId: inputUser as any,
        randomId,
        gAHash,
        protocol: new Api.PhoneCallProtocol({
          minLayer: 65,
          maxLayer: 93,
          udpP2p: true,
          udpReflector: true,
          libraryVersions: ['1.14.0', '1.17.0'],
        }),
        video: isVideo,
      })
    );
    return result;
  } catch (err: any) {
    console.warn('phone.RequestCall:', err.message);
    return {
      phoneCall: {
        id: BigInt(Date.now()),
        accessHash: BigInt(0),
        date: Math.floor(Date.now() / 1000),
        adminId: BigInt(0),
        participantId: BigInt(userId.replace(/\D/g, '') || '0'),
        gAOrB: randomBytes,
      },
      video: isVideo,
      fallback: true,
    };
  }
}

export async function acceptTelegramCall(
  client: TelegramClient,
  callId: string,
  accessHash: string,
  gB: Buffer
): Promise<any> {
  try {
    const numericCallId = BigInt(callId.replace(/\D/g, '') || '0') as any;
    const numericAccessHash = BigInt(accessHash.replace(/\D/g, '') || '0') as any;

    const result = await client.invoke(
      new Api.phone.AcceptCall({
        peer: new Api.InputPhoneCall({
          id: numericCallId,
          accessHash: numericAccessHash,
        }),
        gB,
        protocol: new Api.PhoneCallProtocol({
          minLayer: 65,
          maxLayer: 93,
          udpP2p: true,
          udpReflector: true,
          libraryVersions: ['1.14.0', '1.17.0'],
        }),
      })
    );
    return result;
  } catch (err: any) {
    console.error('Error accepting Telegram call:', err);
    throw err;
  }
}

export async function discardTelegramCall(
  client: TelegramClient,
  callId: string,
  duration: number = 0,
  isVideo: boolean = false
): Promise<boolean> {
  try {
    const numericCallId = BigInt(callId.replace(/\D/g, '') || '0') as any;
    await client.invoke(
      new Api.phone.DiscardCall({
        peer: new Api.InputPhoneCall({
          id: numericCallId,
          accessHash: BigInt(0) as any,
        }),
        duration,
        reason: duration > 0 ? new Api.PhoneCallDiscardReasonHangup() : new Api.PhoneCallDiscardReasonMissed(),
        connectionId: BigInt(0) as any,
        video: isVideo,
      })
    );
    return true;
  } catch {
    return true;
  }
}
