import { TelegramClient, Api } from 'telegram';
import type { CallLog, CallType } from '../shared/types';
import { resolveEntitySafe } from './messages';
import crypto from 'crypto';

// Telegram 2048-bit MODP Group 14 DH Prime
const DH_PRIME_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AACAA68FFFFFFFFFFFFFFFF';

const DH_PRIME = BigInt('0x' + DH_PRIME_HEX);
const DH_GENERATOR = BigInt(3);

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let res = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e % 2n === 1n) {
      res = (res * b) % mod;
    }
    b = (b * b) % mod;
    e = e / 2n;
  }
  return res;
}

function generateDhKeypair(): { a: bigint; ga: bigint; gaBuffer: Buffer; gaHash: Buffer } {
  // Generate random 256-bit secret exponent a (1 < a < p-1)
  const aBytes = crypto.randomBytes(32);
  const a = BigInt('0x' + aBytes.toString('hex'));

  // Calculate g_a = g^a mod p
  const ga = modPow(DH_GENERATOR, a, DH_PRIME);

  // Convert to 256-byte Big-Endian buffer
  let gaHex = ga.toString(16);
  if (gaHex.length % 2 !== 0) gaHex = '0' + gaHex;
  const rawBuffer = Buffer.from(gaHex, 'hex');

  const gaBuffer = Buffer.alloc(256);
  rawBuffer.copy(gaBuffer, 256 - rawBuffer.length);

  // g_a_hash is SHA256 of g_a
  const gaHash = crypto.createHash('sha256').update(gaBuffer).digest();

  return { a, ga, gaBuffer, gaHash };
}

// Supported modern tgcalls library versions
const SUPPORTED_LIBRARY_VERSIONS = [
  '10.0.0',
  '9.0.0',
  '8.0.0',
  '7.0.0',
  '6.0.0',
  '5.0.0',
  '4.0.0',
  '3.0.0',
  '2.7.7',
  '1.28.0',
  '1.17.0',
  '1.14.0',
];

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
    const callConfig = await client.invoke(new Api.phone.GetCallConfig());
    return callConfig;
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
  
  // Real Diffie-Hellman Key generation
  const { gaHash, gaBuffer } = generateDhKeypair();

  try {
    const result = await client.invoke(
      new Api.phone.RequestCall({
        userId: inputUser as any,
        randomId,
        gAHash: gaHash,
        protocol: new Api.PhoneCallProtocol({
          minLayer: 65,
          maxLayer: 93,
          udpP2p: true,
          udpReflector: true,
          libraryVersions: SUPPORTED_LIBRARY_VERSIONS,
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
        gAOrB: gaBuffer,
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
          libraryVersions: SUPPORTED_LIBRARY_VERSIONS,
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
