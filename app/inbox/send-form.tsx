"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { ApiError, MessageDTO } from "@/lib/types";

// Único client component de /inbox: necesita estado local y llamar a la API.
export function SendForm({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json: MessageDTO | ApiError = await res.json();
      if (!res.ok) {
        setError("error" in json ? json.error : "Error al enviar");
        return;
      }
      setText("");
      router.refresh(); // re-renderiza el server component con el hilo actualizado
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2 border-t border-neutral-200 p-3">
      <input
        className="flex-1 rounded border border-neutral-300 px-3 py-2"
        placeholder="Escribí un mensaje…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={sending}
        maxLength={4000}
      />
      <button
        type="submit"
        disabled={sending || text.trim() === ""}
        className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-40"
      >
        Enviar
      </button>
      {error && <span className="self-center text-red-600">{error}</span>}
    </form>
  );
}
