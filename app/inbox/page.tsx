import Link from "next/link";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { listConversations, listMessages } from "@/lib/conversations";
import { SendForm } from "@/app/inbox/send-form";

// Server component: lee la DB directo (sin fetch a la propia API) con la org de la sesión.
// La conversación seleccionada viaja en ?c=<id>; el único client component es el form.
type PageProps = { searchParams: Promise<{ c?: string }> };

export default async function InboxPage({ searchParams }: PageProps) {
  const { organizationId } = await getSession();
  const selected = z.uuid().safeParse((await searchParams).c);
  const selectedId = selected.success ? selected.data : null;

  const [page, thread] = await Promise.all([
    listConversations(organizationId, { limit: 50, cursor: null }),
    selectedId ? listMessages(organizationId, selectedId) : Promise.resolve([]),
  ]);
  const current = page.items.find((c) => c.id === selectedId) ?? null;

  return (
    <main className="grid h-screen grid-cols-[320px_1fr] bg-white font-sans text-sm text-neutral-900">
      <aside className="overflow-y-auto border-r border-neutral-200">
        <h1 className="border-b border-neutral-200 p-3 font-semibold">Inbox</h1>
        {page.items.length === 0 && <p className="p-3 text-neutral-500">Sin conversaciones.</p>}
        <ul>
          {page.items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/inbox?c=${c.id}`}
                className={`block border-b border-neutral-100 p-3 hover:bg-neutral-50 ${
                  c.id === selectedId ? "bg-neutral-100" : ""
                }`}
              >
                <div className="flex justify-between">
                  <span className="font-medium">{c.contact.displayName ?? c.contact.externalId}</span>
                  <span className="text-xs text-neutral-500">{c.channel}</span>
                </div>
                <p className="truncate text-neutral-600">
                  {c.lastMessage?.direction === "outbound" && "Vos: "}
                  {c.lastMessage?.body ?? "—"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex flex-col">
        {current ? (
          <>
            <header className="border-b border-neutral-200 p-3">
              <span className="font-semibold">{current.contact.displayName ?? current.contact.externalId}</span>
              <span className="ml-2 text-xs text-neutral-500">
                {current.channel} · {current.contact.externalId}
              </span>
            </header>
            <ul className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
              {thread.map((m) => (
                <li
                  key={m.id}
                  className={`max-w-[70%] rounded px-3 py-2 ${
                    m.direction === "outbound"
                      ? "self-end bg-neutral-900 text-white"
                      : "self-start bg-neutral-100"
                  }`}
                >
                  <p>{m.body}</p>
                  <p className="mt-1 text-[10px] opacity-60">
                    {new Date(m.createdAt).toLocaleString("es-AR")} · {m.status}
                  </p>
                </li>
              ))}
            </ul>
            <SendForm conversationId={current.id} />
          </>
        ) : (
          <p className="p-6 text-neutral-500">Elegí una conversación.</p>
        )}
      </section>
    </main>
  );
}
