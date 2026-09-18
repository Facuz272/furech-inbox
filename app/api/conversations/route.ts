import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listConversations, listParamsSchema } from "@/lib/conversations";
import type { ApiError, ConversationListItem, Page } from "@/lib/types";

export async function GET(request: Request) {
  // El tenant viene de la sesión, nunca de la query string.
  const { organizationId } = await getSession();

  const url = new URL(request.url);
  const params = listParamsSchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!params.success) {
    return NextResponse.json<ApiError>(
      { error: "Parámetros inválidos", details: params.error.issues },
      { status: 400 },
    );
  }

  const page = await listConversations(organizationId, params.data);
  return NextResponse.json<Page<ConversationListItem>>(page);
}
