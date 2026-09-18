// El caso que más importa cubrir: el proveedor reenvía el mismo mensaje y NO se duplica.
// Es un test de integración contra Postgres a propósito: la idempotencia vive en un
// constraint de la DB, mockear la DB sería testear nada.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firstRow, pool, query } from "@/lib/db";
import { ingestInboundMessage } from "@/lib/webhook";

let orgId: string;

beforeAll(async () => {
  const rows = await query<{ id: string }>(
    `INSERT INTO organizations (name) VALUES ('test-org') RETURNING id`,
  );
  orgId = firstRow(rows, "organizations").id;
});

afterAll(async () => {
  // ON DELETE CASCADE limpia contactos, conversaciones y mensajes.
  await query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  await pool.end();
});

describe("webhook idempotency", () => {
  it("stores the message once even if the provider retries", async () => {
    const payload = {
      messageId: "wamid.TEST-1",
      from: { id: "+5491100000000", name: "Ana" },
      text: "hola",
    };

    const first = await ingestInboundMessage(orgId, "whatsapp", payload);
    const second = await ingestInboundMessage(orgId, "whatsapp", payload);

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("duplicate");
    expect(second.conversationId).toBe(first.conversationId);

    const count = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM messages WHERE conversation_id = $1`,
      [first.conversationId],
    );
    expect(firstRow(count, "count").n).toBe("1");
  });

  it("does not duplicate under concurrent retries", async () => {
    const payload = {
      messageId: "wamid.TEST-2",
      from: { id: "+5491100000001" },
      text: "hola de nuevo",
    };

    // 5 entregas simultáneas del mismo mensaje.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ingestInboundMessage(orgId, "whatsapp", payload)),
    );

    expect(results.filter((r) => r.outcome === "created")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "duplicate")).toHaveLength(4);
  });
});
