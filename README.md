# Furech · Mini bandeja omnicanal

Next.js 15 (App Router) · TypeScript strict · PostgreSQL (Neon) · SQL a mano con `pg` · zod en los bordes.

## Cómo levantarlo

```bash
npm install
cp .env.example .env     # completar DATABASE_URL
npm run db:migrate       # aplica db/*.sql en una transacción
npm run db:seed          # crea 2 organizaciones e imprime ids + webhook_token → pegar DEMO_* en .env
npm run dev
```

`npm run build` · `typecheck` · `lint` · `test` (integración contra la DB del `.env`).

```bash
curl -X POST localhost:3000/api/webhooks/whatsapp -H "Authorization: Bearer <webhook_token>" \
  -H "content-type: application/json" -d '{"messageId":"wamid.1","from":{"id":"+5491155550001","name":"Ana"},"text":"Hola"}'
# repetirlo → 200 {"outcome":"duplicate"}, sin insertar
curl "localhost:3000/api/conversations?limit=20"
curl -X POST localhost:3000/api/conversations/<id>/messages -H "content-type: application/json" -d '{"text":"Hola Ana"}'
```

Mapa: [`db/001_init.sql`](db/001_init.sql) · [`lib/webhook.ts`](lib/webhook.ts) (entrante) · [`lib/conversations.ts`](lib/conversations.ts) (listado + hilo + saliente) · [`lib/provider.ts`](lib/provider.ts) (stub) · [`tests/webhook-idempotency.test.ts`](tests/webhook-idempotency.test.ts) (opcional 6) · [`app/inbox`](app/inbox) (opcional 5, hecho después del time-box).

## Decisiones

**1. Idempotencia en la base, no en la app.** `UNIQUE (conversation_id, external_id)` + `INSERT … ON CONFLICT DO NOTHING RETURNING id`. Si no vuelve fila era un duplicado: respondo **200** (no 409) para que el proveedor deje de reintentar. Todo en una transacción; dos reintentos simultáneos no compiten porque el segundo espera el lock del índice único hasta que el primero commitea (un `SELECT` + `if` sí tendría esa carrera). El test cubre 5 entregas concurrentes.

**2. El tenant nunca viene del cliente, tampoco en el webhook.** Las rutas de usuario usan `getSession()`. Pero un webhook no tiene sesión —lo llama WhatsApp—, así que cada organización tiene un `webhook_token` secreto que viaja en `Authorization: Bearer` y el servidor resuelve a `organization_id`: el cliente manda una *credencial*, nunca un id. Al enviar un saliente, el `SELECT` filtra por la org de la sesión; una conversación ajena responde 404 igual que una inexistente, para no filtrar ids.

**3. Listado: una query y cursor, no offset.** `LEFT JOIN LATERAL (… ORDER BY created_at DESC LIMIT 1)` trae conversación + contacto + último mensaje de una vez (el N+1 sería una query por fila). Paginación keyset sobre `(last_message_at, id)`: en una bandeja viva, el offset repite o saltea filas cuando entra un mensaje entre páginas. `limit + 1` para saber si hay siguiente sin `COUNT`; cursor malformado → 400.

**Índices** (detalle en el SQL): `conversations (organization_id, last_message_at DESC, id DESC)` cubre exactamente el `WHERE` + `ORDER BY` del listado; `messages (conversation_id, created_at DESC, id DESC)` sirve al hilo y a la subquery LATERAL; `contacts (organization_id, channel, external_id)` UNIQUE es la clave del upsert del webhook. `organization_id` redundante en todas las tablas hijas: filtrar sin JOIN y base para RLS.

**Otras.** `timestamptz(3)` en `created_at` / `last_message_at`: `Date` en JS tiene milisegundos, `timestamptz` microsegundos; probando encontré que el cursor (ISO string) podía saltear una fila en esos microsegundos. `last_message_at` es siempre `max(created_at)` de sus mensajes, así coincide con el `lastMessage` embebido. El saliente se persiste `pending` y commitea **antes** de llamar al proveedor: no sostengo una conexión esperando un servicio externo y un fallo queda como `failed` reintentable. Una conversación por contacto (`UNIQUE (contact_id)`), sin estados en este alcance.

## Qué quedó afuera / con 2 h más

- Dentro de las 2 h elegí el test. `/inbox` lo agregué después, fuera del time-box: server component que llama a `listConversations`/`listMessages` directo (sin fetch a mi propia API), selección por `?c=<id>`, y un único client component para el form de envío que hace `router.refresh()`.
- **Adapters por proveedor**: asumo un payload normalizado; WhatsApp Cloud API y Telegram tienen shapes distintos.
- **Firma del webhook** (HMAC / secret token) además del bearer. **`GET /api/conversations/[id]/messages`** paginado. **Reintentos** del saliente y webhook de estado (`delivered`/`read`). **RLS** como segunda defensa. Tabla de migraciones aplicadas (hoy `db:migrate` no es re-ejecutable).

## Preguntas que hubiera hecho

¿Cómo esperan que el webhook resuelva la organización si `getSession()` es de usuario? · ¿Una conversación por contacto para siempre, o se cierran y abren? · ¿El id de mensaje del proveedor es único global o por cuenta? · ¿Los payloads llegan normalizados por un gateway propio o hay que parsear el nativo de cada proveedor?

## Herramientas de IA

Usé **Claude Code (Opus 5)** durante toda la prueba como par: le pasé el enunciado, definimos juntos el modelo y las decisiones de arriba, y generó el código punto por punto mientras yo revisaba, preguntaba y probaba con `curl` contra Neon. También lo usé para el scaffolding, una batería de 36 pruebas end-to-end (que encontró el bug de precisión de timestamps) y este README. Todo lo entregado lo entiendo y puedo defenderlo línea por línea.
