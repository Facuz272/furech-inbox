# Furech · Mini bandeja omnicanal

Next.js 15 (App Router) · TypeScript strict · PostgreSQL (Neon) · SQL a mano con `pg`.

## Cómo levantarlo

```bash
npm install
cp .env.example .env        # completar DATABASE_URL (Postgres; probado con Neon)
npm run db:migrate          # aplica db/*.sql en una transacción
npm run db:seed             # crea 2 organizaciones e imprime ids + webhook_token
#   → pegar DEMO_USER_ID y DEMO_ORGANIZATION_ID en .env (simulan la sesión)
npm run dev
```

`npm run build` · `npm run typecheck` · `npm run lint` · `npm test` (integración contra la DB del `.env`).

Probar a mano:

```bash
# mensaje entrante (el token lo imprime el seed)
curl -X POST localhost:3000/api/webhooks/whatsapp -H "Authorization: Bearer <webhook_token>" \
  -H "content-type: application/json" \
  -d '{"messageId":"wamid.1","from":{"id":"+5491155550001","name":"Ana"},"text":"Hola"}'
# reenviarlo → 200 {"outcome":"duplicate"} sin insertar
curl "localhost:3000/api/conversations?limit=20"
curl -X POST localhost:3000/api/conversations/<id>/messages -H "content-type: application/json" -d '{"text":"Hola Ana"}'
```

## Qué hay

| | |
|---|---|
| Schema | [`db/001_init.sql`](db/001_init.sql) — 4 tablas, enums, constraints e índices comentados en el propio SQL |
| `POST /api/webhooks/[channel]` | [`lib/webhook.ts`](lib/webhook.ts) — valida con zod, upsert contacto/conversación, inserta mensaje idempotente |
| `GET /api/conversations` | [`lib/conversations.ts`](lib/conversations.ts) — una sola query, cursor keyset |
| `POST /api/conversations/[id]/messages` | mismo archivo — persiste `pending`, llama al stub [`lib/provider.ts`](lib/provider.ts), marca `sent` |
| Opcional elegido | [`tests/webhook-idempotency.test.ts`](tests/webhook-idempotency.test.ts) — reenvío secuencial y 5 entregas concurrentes |

## Decisiones

**1. Idempotencia en la base, no en la app.** `UNIQUE (conversation_id, external_id)` en `messages` + `INSERT … ON CONFLICT DO NOTHING RETURNING id`. Si no vuelve fila, era un duplicado y respondo **200** (no 409) para que el proveedor deje de reintentar. Todo corre en una transacción; si dos reintentos llegan a la vez, el segundo espera el lock del índice único hasta que el primero commitea y recién ahí ve el conflicto. Un `SELECT` previo + `if` tendría esa carrera. `last_message_at` solo se actualiza cuando el mensaje fue realmente nuevo.

**2. El tenant nunca viene del cliente, tampoco en el webhook.** Las rutas de usuario usan `getSession()`. Pero un webhook no tiene sesión: lo llama WhatsApp/Telegram. Cada organización tiene un `webhook_token` secreto que el proveedor manda en `Authorization: Bearer` y el servidor resuelve a `organization_id` en la DB. El cliente envía una *credencial*, nunca un id. Además, al enviar un mensaje saliente el `SELECT` filtra por `organization_id` de la sesión: una conversación de otro tenant responde 404, igual que una inexistente, para no filtrar ids.

**3. Listado: una query y cursor en vez de offset.** `LEFT JOIN LATERAL (… ORDER BY created_at DESC LIMIT 1)` trae conversación + contacto + último mensaje de una sola vez (el N+1 sería una query por conversación). Paginación keyset sobre `(last_message_at, id)`: en una bandeja que recibe mensajes, el offset repite o saltea filas cuando cambia el orden entre páginas. Pido `limit + 1` para saber si hay siguiente página sin `COUNT`. Un cursor malformado es 400, no "primera página" en silencio.

**Índices** (justificación completa en el SQL): `conversations (organization_id, last_message_at DESC, id DESC)` cubre exactamente el `WHERE` + `ORDER BY` del listado; `messages (conversation_id, created_at DESC, id DESC)` sirve al hilo y a la subquery LATERAL; `contacts (organization_id, channel, external_id)` es UNIQUE y es la clave del upsert del webhook; `contacts (organization_id)` porque Postgres no indexa FKs solo. Todas las tablas hijas llevan `organization_id` redundante para filtrar sin JOIN y dejar lista una futura RLS.

**Otras:** `pg` con SQL crudo en vez de ORM, coherente con "schema a mano" y sin capa que explicar. Una conversación por contacto (`UNIQUE (contact_id)`) — sin estados open/closed en este alcance. El mensaje saliente se guarda `pending` y se commitea **antes** de llamar al proveedor, para no sostener una conexión abierta esperando un servicio externo y para que un fallo quede como `failed` reintentable.

## Qué quedó afuera y qué haría con 2 h más

- **Pantalla `/inbox`**: elegí el test. Con más tiempo: server component que llama a `listConversations` directo (sin fetch a mi propia API), lista + panel del hilo, y un client component solo para el form de envío.
- **Adapters por proveedor**: hoy el webhook asume un payload normalizado; en la realidad WhatsApp Cloud API y Telegram tienen shapes distintos y va un adapter por canal antes de `inboundMessageSchema`.
- **Verificación de firma** del webhook (HMAC de WhatsApp, secret token de Telegram) además del bearer.
- **`GET /api/conversations/[id]/messages`** paginado para el hilo.
- **Reintentos del envío saliente** (cola/job) y webhook de estado del proveedor (`delivered`/`read`).
- **RLS en Postgres** con `SET app.organization_id` como segunda línea de defensa detrás del `WHERE`.
- Tabla de migraciones aplicadas (hoy el script corre todo `db/*.sql` y no es re-ejecutable).

## Preguntas que hubiera hecho

- ¿Cómo esperan que un webhook resuelva la organización, si `getSession()` es de usuario? Asumí token por organización.
- ¿Una conversación por contacto para siempre, o se cierran y se abren nuevas? Cambia el UNIQUE y el upsert.
- ¿El id de mensaje del proveedor es único global o por cuenta? Define el scope de la clave de idempotencia.
- ¿Los proveedores ya llegan normalizados por un gateway propio o hay que parsear el payload nativo de cada uno?

## Herramientas de IA

Usé **Claude Code (Opus 5)** durante toda la prueba, como par: le pasé el enunciado, definimos juntos el modelo de datos y las decisiones de arriba, y generó el código punto por punto mientras yo revisaba cada pieza, hacía preguntas y probaba con `curl` contra Neon. También lo usé para el scaffolding, el smoke test y este README. Todo lo entregado lo entiendo y puedo defenderlo línea por línea; los comentarios en el código y en el SQL son las mismas explicaciones que discutimos.
