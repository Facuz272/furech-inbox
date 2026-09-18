// Tipos compartidos de los bordes de la API (respuestas). Sin `any`.

export type Channel = "whatsapp" | "telegram" | "webchat";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "received" | "pending" | "sent" | "failed";

export type MessageDTO = {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  status: MessageStatus;
  body: string;
  createdAt: string; // ISO
};

export type ConversationListItem = {
  id: string;
  channel: Channel;
  lastMessageAt: string; // ISO
  contact: { id: string; externalId: string; displayName: string | null };
  lastMessage: MessageDTO | null;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type ApiError = { error: string; details?: unknown };
