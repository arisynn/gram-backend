import { TelegramClient, Api } from 'telegram';
import type { StickerSet, StickerItem } from '../shared/types';
import { resolveEntitySafe } from './messages';

export async function fetchInstalledStickerSets(client: TelegramClient): Promise<StickerSet[]> {
  try {
    const res = await client.invoke(
      new Api.messages.GetAllStickers({
        hash: BigInt(0) as any,
      })
    ) as any;

    if (!res || !res.sets) return [];

    const sets: StickerSet[] = [];
    // Take top 8 sticker sets for quick mobile load
    const activeSets = res.sets.slice(0, 10);

    for (const s of activeSets) {
      if (s.archived) continue;
      const setId = String(s.id);
      const shortName = s.shortName || '';
      const title = s.title || shortName || 'Stickers';

      sets.push({
        id: setId,
        title,
        shortName,
        count: s.count || 0,
        isAnimated: Boolean(s.animated),
        isVideo: Boolean(s.videos),
        thumbnailUrl: `/api/stickers/thumb/${setId}`,
        stickers: [],
      });
    }

    return sets;
  } catch (err) {
    console.error('Error fetching sticker sets:', err);
    return [];
  }
}

export async function fetchStickerSetDetails(
  client: TelegramClient,
  setNameOrId: string
): Promise<StickerSet | null> {
  try {
    let inputSet: any;
    if (setNameOrId.match(/^\d+$/)) {
      inputSet = new Api.InputStickerSetID({
        id: BigInt(setNameOrId) as any,
        accessHash: BigInt(0) as any,
      });
    } else {
      inputSet = new Api.InputStickerSetShortName({
        shortName: setNameOrId,
      });
    }

    const res = await client.invoke(
      new Api.messages.GetStickerSet({
        stickerset: inputSet,
        hash: 0,
      })
    ) as any;

    if (!res || !res.set) return null;

    const set = res.set;
    const documents = res.documents || [];
    const packs = res.packs || [];

    // Map documents to stickers
    const stickers: StickerItem[] = [];

    for (const doc of documents) {
      if (!doc || !doc.id) continue;
      const mime = doc.mimeType || 'image/webp';
      const isVideo = mime.includes('webm') || Boolean(set.videos);
      const isAnimated = mime.includes('tgsticker') || Boolean(set.animated);

      let type: StickerItem['type'] = 'static';
      if (isVideo) type = 'video';
      else if (isAnimated) type = 'animated';

      // Find alt emoji for this sticker
      const stickerAttr = doc.attributes?.find(
        (a: any) => a instanceof Api.DocumentAttributeSticker || a.className === 'DocumentAttributeSticker'
      );
      const alt = stickerAttr?.alt || '⭐';

      const imgAttr = doc.attributes?.find(
        (a: any) => a instanceof Api.DocumentAttributeImageSize || a.className === 'DocumentAttributeImageSize'
      );

      stickers.push({
        id: String(doc.id),
        accessHash: String(doc.accessHash || '0'),
        alt,
        url: `/api/media/document/${doc.id}`,
        type,
        mimeType: mime,
        width: imgAttr?.w || 512,
        height: imgAttr?.h || 512,
      });
    }

    return {
      id: String(set.id),
      title: set.title || 'Stickers',
      shortName: set.shortName || '',
      count: set.count || stickers.length,
      isAnimated: Boolean(set.animated),
      isVideo: Boolean(set.videos),
      stickers,
    };
  } catch (err) {
    console.error('Error fetching sticker set details:', err);
    return null;
  }
}

export async function sendStickerMessage(
  client: TelegramClient,
  chatId: string,
  documentId: string,
  accessHash: string,
  replyToMsgId?: number
): Promise<any> {
  const entity = await resolveEntitySafe(client, chatId);
  if (!entity) throw new Error('Obrolan tidak ditemukan');

  const inputDoc = new Api.InputDocument({
    id: BigInt(documentId) as any,
    accessHash: BigInt(accessHash) as any,
    fileReference: Buffer.alloc(0),
  });

  const sent = await client.sendMessage(entity, {
    file: inputDoc as any,
    replyTo: replyToMsgId,
  });

  return sent;
}
