/**
 * GRAM — Shared Data Contracts & Types
 */

export type ChatType = 'user' | 'group' | 'channel' | 'saved' | 'bot';

export interface UserProfile {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  phone?: string;
  bio?: string;
  status?: string;
  avatarUrl?: string;
  isSelf?: boolean;
}

export interface ChatSummary {
  id: string;
  title: string;
  type: ChatType;
  username?: string;
  unreadCount: number;
  isPinned?: boolean;
  isArchived?: boolean;
  avatarUrl?: string;
  lastMessage?: {
    id: number;
    text: string;
    date: number;
    isOutgoing: boolean;
    mediaType?: 'photo' | 'video' | 'document';
  };
}

export interface MessageMedia {
  type: 'photo' | 'video' | 'document' | 'audio' | 'voice';
  url: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface ChatMessage {
  id: number;
  chatId: string;
  senderId: string;
  senderName?: string;
  text: string;
  date: number;
  isOutgoing: boolean;
  isRead?: boolean;
  isEdited?: boolean;
  replyToMsgId?: number;
  replyToText?: string;
  replyToSender?: string;
  media?: MessageMedia;
  commentsCount?: number;
  repliesCount?: number;
  hasComments?: boolean;
  callAction?: {
    duration?: number;
    reason?: 'missed' | 'busy' | 'disconnect' | 'hangup';
    isVideo?: boolean;
    isOutgoing?: boolean;
  };
}

export type CallType = 'incoming' | 'outgoing' | 'missed' | 'cancelled';

export interface TelegramCallConnection {
  id: string;
  ip: string;
  ipv6?: string;
  port: number;
  peerTag?: string;
  username?: string;
  password?: string;
  isTurn?: boolean;
  isStun?: boolean;
}

export interface CallLog {
  id: number;
  chatId: string;
  peerId: string;
  peerName: string;
  peerUsername?: string;
  peerAvatarUrl?: string;
  type: CallType;
  isVideo: boolean;
  duration: number; // in seconds
  date: number; // unix timestamp
}

export interface ChannelComment {
  id: number;
  senderId: string;
  senderName: string;
  text: string;
  date: number;
  avatarUrl?: string;
}

export interface GroupMember {
  id: string;
  name: string;
  username?: string;
  role?: string;
  status?: string;
  avatarUrl?: string;
}

export interface GroupDetail {
  id: string;
  title: string;
  membersCount: number;
  about?: string;
  avatarUrl?: string;
  members: GroupMember[];
}

export interface ChannelDetail {
  id: string;
  title: string;
  subscribersCount: number;
  about?: string;
  username?: string;
  avatarUrl?: string;
  isJoined: boolean;
  posts?: ChatMessage[];
}

export interface TelegramContact {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  phone?: string;
  avatarUrl?: string;
  status?: string;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  configured: boolean;
  user?: UserProfile;
  backendVersion: string;
  token?: string;
  sessionId?: string;
}

export interface SendCodeResponse {
  success: boolean;
  tempSessionId: string;
  phoneCodeHash: string;
  timeout?: number;
  isCodeViaApp?: boolean;
  message?: string;
}

export interface SignInResponse {
  success: boolean;
  requires2FA?: boolean;
  token?: string;
  user?: UserProfile;
  message?: string;
}

export interface GlobalSearchResult {
  users: TelegramContact[];
  chats: ChatSummary[];
  messages: ChatMessage[];
  publicEntity?: {
    id: string;
    title: string;
    username: string;
    type: ChatType;
  };
}

export interface AccountInfo {
  sessionId: string;
  user: UserProfile;
  isCurrent: boolean;
  createdAt?: number;
  lastUsedAt?: number;
}

export interface AccountsResponse {
  accounts: AccountInfo[];
  currentSessionId?: string;
}

