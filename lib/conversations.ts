import { z } from "zod";
import { firstRow, pool, query } from "@/lib/db";
import type {
  Channel,
  ConversationListItem,
  MessageDTO,
  MessageDirection,
  MessageStatus,
  Page,
} from "@/lib/types";
import { sendMessage } from "@/lib/provider";

// Mantiene conversations.last_message_at = max(messages.created_at): única fuente de
// verdad, y con el índice (conversation_id, created_at DESC) el max es una lectura.
// Lo usan el webhook (entrante) y el envío saliente.
export const touchConversationSql = `
  UPDATE conversations
  SET last_message_at = (SELECT max(created_at) FROM messages WHERE conversation_id = $1)
  WHERE id = $1`;

// ---------------------------------------------------------------------------
// Paginación por cursor (keyset) sobre (last_message_at, id).
// Offset se rompe en una bandeja viva: si entra un mensaje entre página 1 y 2,
// todo se corre y ves repetidos/salteados. El cursor es opaco para el cliente.
// ---------------------------------------------------------------------------

type Cursor = { lastMessageAt: string; id: string };

const cursorSchema = z.object({ lastMessageAt: z.iso.datetime(), id: z.uuid() });

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const result = cursorSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// Un cursor malformado es 400, no "volvé a la primera página" en silencio.
export const listParamsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z
    .string()
    .optional()
    .transform((raw, ctx): Cursor | null => {
      if (raw === undefined) return null;
      const cursor = decodeCursor(raw);
      if (!cursor) {
        ctx.addIssue({ code: "custom", message: "Cursor inválido" });
        return z.NEVER;
      }
      return cursor;
    }),
});

type ListRow = {
  id: string;
  channel: Channel;
  last_message_at: Date;
  contact_id: string;
  contact_external_id: string;
  contact_display_name: string | null;
  m_id: string | null;
  m_direction: MessageDirection | null;
  m_status: MessageStatus | null;
  m_body: string | null;
  m_created_at: Date | null;
};

// Una sola query: conversaciones + contacto + último mensaje (LATERAL LIMIT 1).
// Sin esto sería 1 query por conversación para buscar su último mensaje (el N+1).
export async function listConversations(
  organizationId: string,
  params: z.infer<typeof listParamsSchema>,
): Promise<Page<ConversationListItem>> {
  const { cursor } = params;
  const rows = await query<ListRow>(
    `SELECT c.id, c.channel, c.last_message_at,
            ct.id AS contact_id, ct.external_id AS contact_external_id,
            ct.display_name AS contact_display_name,
            m.id AS m_id, m.direction AS m_direction, m.status AS m_status,
            m.body AS m_body, m.created_at AS m_created_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN LATERAL (
       SELECT id, direction, status, body, created_at
       FROM messages
       WHERE conversation_id = c.id
       ORDER BY created_at DESC, id DESC
       LIMIT 1
     ) m ON true
     WHERE c.organization_id = $1
       AND ($2::timestamptz IS NULL OR (c.last_message_at, c.id) < ($2::timestamptz, $3::uuid))
     ORDER BY c.last_message_at DESC, c.id DESC
     LIMIT $4`,
    [organizationId, cursor?.lastMessageAt ?? null, cursor?.id ?? null, params.limit + 1],
  );

  // Pedimos limit+1 para saber si hay página siguiente sin un COUNT extra.
  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);

  return {
    items: pageRows.map(toListItem),
    nextCursor:
      hasMore && last
        ? encodeCursor({ lastMessageAt: last.last_message_at.toISOString(), id: last.id })
        : null,
  };
}

function toListItem(r: ListRow): ConversationListItem {
  const lastMessage: MessageDTO | null =
    r.m_id && r.m_direction && r.m_status && r.m_body !== null && r.m_created_at
      ? {
          id: r.m_id,
          conversationId: r.id,
          direction: r.m_direction,
          status: r.m_status,
          body: r.m_body,
          createdAt: r.m_created_at.toISOString(),
        }
      : null;
  return {
    id: r.id,
    channel: r.channel,
    lastMessageAt: r.last_message_at.toISOString(),
    contact: {
      id: r.contact_id,
      externalId: r.contact_external_id,
      displayName: r.contact_display_name,
    },
    lastMessage,
  };
}

type MessageRow = {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  status: MessageStatus;
  body: string;
  created_at: Date;
};

export function toMessageDTO(r: MessageRow): MessageDTO {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    direction: r.direction,
    status: r.status,
    body: r.body,
    createdAt: r.created_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Hilo de una conversación (para /inbox). Filtra por org: ajena ⇒ [] como inexistente.
// ---------------------------------------------------------------------------

export async function listMessages(
  organizationId: string,
  conversationId: string,
): Promise<MessageDTO[]> {
  const rows = await query<MessageRow>(
    `SELECT id, conversation_id, direction, status, body, created_at
     FROM messages
     WHERE conversation_id = $1 AND organization_id = $2
     ORDER BY created_at ASC, id ASC`,
    [conversationId, organizationId],
  );
  return rows.map(toMessageDTO);
}

// ---------------------------------------------------------------------------
// Mensaje saliente
// ---------------------------------------------------------------------------

export const outboundMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});


// Devuelve null si la conversación no existe O no es de esta organización:
// misma respuesta en ambos casos para no filtrar ids de otros tenants.
export async function sendOutboundMessage(
  organizationId: string,
  conversationId: string,
  text: string,
): Promise<MessageDTO | null> {
  const client = await pool.connect();
  let pending: MessageRow;
  let channel: Channel;
  let contactExternalId: string;
  try {
    await client.query("BEGIN");
    const conv = await client.query<{ channel: Channel; external_id: string }>(
      `SELECT c.channel, ct.external_id
       FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [conversationId, organizationId],
    );
    const found = conv.rows[0];
    if (!found) {
      await client.query("ROLLBACK");
      return null;
    }
    channel = found.channel;
    contactExternalId = found.external_id;

    // Se persiste como 'pending' ANTES de llamar al proveedor: si el envío falla
    // el mensaje queda en la DB con status 'failed' y se puede reintentar.
    const inserted = await client.query<MessageRow>(
      `INSERT INTO messages (organization_id, conversation_id, direction, status, body)
       VALUES ($1, $2, 'outbound', 'pending', $3)
       RETURNING id, conversation_id, direction, status, body, created_at`,
      [organizationId, conversationId, text],
    );
    pending = firstRow(inserted.rows, "messages");
    await client.query(touchConversationSql, [conversationId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Fuera de la transacción: no se sostiene una conexión abierta mientras
  // esperamos a un servicio externo.
  const delivery = await sendMessage({ channel, to: contactExternalId, text });
  const rows = await query<MessageRow>(
    `UPDATE messages SET status = $2, external_id = $3
     WHERE id = $1
     RETURNING id, conversation_id, direction, status, body, created_at`,
    [pending.id, delivery.ok ? "sent" : "failed", delivery.ok ? delivery.providerMessageId : null],
  );
  return toMessageDTO(rows[0] ?? pending);
}
