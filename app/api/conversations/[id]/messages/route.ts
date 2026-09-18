import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { outboundMessageSchema, sendOutboundMessage } from "@/lib/conversations";
import type { ApiError, MessageDTO } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { organizationId } = await getSession();

  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json<ApiError>({ error: "Conversación no encontrada" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json<ApiError>({ error: "Body inválido" }, { status: 400 });
  }
  const body = outboundMessageSchema.safeParse(raw);
  if (!body.success) {
    return NextResponse.json<ApiError>(
      { error: "Payload inválido", details: body.error.issues },
      { status: 400 },
    );
  }

  const message = await sendOutboundMessage(organizationId, id.data, body.data.text);
  if (!message) {
    return NextResponse.json<ApiError>({ error: "Conversación no encontrada" }, { status: 404 });
  }
  return NextResponse.json<MessageDTO>(message, { status: 201 });
}
