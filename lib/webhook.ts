import { z } from "zod";
import { pool, query } from "@/lib/db";
import type { Channel } from "@/lib/types";

export const channelSchema = z.enum(["whatsapp", "telegram", "webchat"]);

// Payload normalizado. En la vida real cada proveedor tiene su forma y habría un
// adapter por canal que lo traduzca a esto; para el time-box asumo un único shape.
export const inboundMessageSchema = z.object({
  messageId: z.string().min(1), // id del proveedor: clave de idempotencia
  from: z.object({
    id: z.string().min(1), // teléfono / chat_id / visitor_id
    name: z.string().min(1).optional(),
  }),
  text: z.string().min(1),
  timestamp: z.iso.datetime().optional(),
});

export type InboundMessage = z.infer<typeof inboundMessageSchema>;

// Resuelve el tenant desde el secreto del proveedor. Devuelve null si no matchea.
export async function resolveOrganizationFromToken(
  authorization: string | null,
): Promise<{ id: string } | null> {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;
  const rows = await query<{ id: string }>(
    `SELECT id FROM organizations WHERE webhook_token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

export type IngestResult =
  | { outcome: "created"; messageId: string; conversationId: string }
  | { outcome: "duplicate"; conversationId: string };

// Todo en una transacción. Idempotencia: el UNIQUE (conversation_id, external_id)
// hace que el reintento del proveedor choque y se descarte con ON CONFLICT DO NOTHING.
// Si dos reintentos llegan a la vez, el segundo espera el lock del índice único
// hasta que el primero commitea y recién ahí ve el conflicto: no hay carrera.
export async function ingestInboundMessage(
  organizationId: string,
  channel: Channel,
  msg: InboundMessage,
): Promise<IngestResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Contacto: crear si no existe. DO UPDATE (y no DO NOTHING) para que
    //    RETURNING devuelva la fila también cuando ya existía.
    const contact = await client.query<{ id: string }>(
      `INSERT INTO contacts (organization_id, channel, external_id, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, channel, external_id)
       DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, contacts.display_name)
       RETURNING id`,
      [organizationId, channel, msg.from.id, msg.from.name ?? null],
    );
    const contactId = contact.rows[0]!.id;

    // 2. Conversación: una por contacto (ver constraint en el schema).
    const conversation = await client.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, contact_id, channel)
       VALUES ($1, $2, $3)
       ON CONFLICT (contact_id) DO UPDATE SET contact_id = EXCLUDED.contact_id
       RETURNING id`,
      [organizationId, contactId, channel],
    );
    const conversationId = conversation.rows[0]!.id;

    // 3. Mensaje: acá vive la idempotencia.
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO messages
         (organization_id, conversation_id, direction, status, body, external_id, created_at)
       VALUES ($1, $2, 'inbound', 'received', $3, $4, COALESCE($5::timestamptz, now()))
       ON CONFLICT (conversation_id, external_id) DO NOTHING
       RETURNING id`,
      [organizationId, conversationId, msg.text, msg.messageId, msg.timestamp ?? null],
    );
    const messageId = inserted.rows[0]?.id;

    if (messageId === undefined) {
      await client.query("COMMIT");
      return { outcome: "duplicate", conversationId };
    }

    // 4. Solo si fue nuevo: subir la conversación en la bandeja.
    await client.query(
      `UPDATE conversations
       SET last_message_at = GREATEST(last_message_at, (SELECT created_at FROM messages WHERE id = $2))
       WHERE id = $1`,
      [conversationId, messageId],
    );

    await client.query("COMMIT");
    return { outcome: "created", messageId, conversationId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
