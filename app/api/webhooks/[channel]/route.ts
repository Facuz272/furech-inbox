import { NextResponse } from "next/server";
import {
  channelSchema,
  inboundMessageSchema,
  ingestInboundMessage,
  resolveOrganizationFromToken,
} from "@/lib/webhook";
import type { ApiError } from "@/lib/types";

type RouteContext = { params: Promise<{ channel: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const channel = channelSchema.safeParse((await params).channel);
  if (!channel.success) {
    return NextResponse.json<ApiError>({ error: "Canal desconocido" }, { status: 404 });
  }

  // El tenant sale del secreto del proveedor, resuelto en el servidor. Nunca del payload.
  const org = await resolveOrganizationFromToken(request.headers.get("authorization"));
  if (!org) {
    return NextResponse.json<ApiError>({ error: "Token inválido" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json<ApiError>({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = inboundMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { error: "Payload inválido", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await ingestInboundMessage(org.id, channel.data, parsed.data);

  // Duplicado → 200 (no 409): el proveedor tiene que dejar de reintentar.
  return NextResponse.json(result, { status: result.outcome === "created" ? 201 : 200 });
}
