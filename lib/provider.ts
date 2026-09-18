import type { Channel } from "@/lib/types";

// Stub del proveedor de mensajería. En producción acá iría el cliente de
// WhatsApp Cloud API / Telegram Bot API / el socket del webchat, elegido por canal.

export type SendMessageInput = { channel: Channel; to: string; text: string };

export type SendMessageResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string };

export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  console.log(`[provider:${input.channel}] → ${input.to}: ${input.text}`);
  return { ok: true, providerMessageId: `stub-${crypto.randomUUID()}` };
}
