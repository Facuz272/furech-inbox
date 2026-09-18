-- Furech · Mini bandeja omnicanal
-- Migración 001: esquema base. Escrita a mano (sin ORM).
--
-- Modelo: organization 1─n contact 1─n conversation 1─n message
-- Todas las tablas hijas llevan organization_id de forma redundante:
-- permite filtrar por tenant sin JOINs y sirve de base para RLS a futuro.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TYPE channel AS ENUM ('whatsapp', 'telegram', 'webchat');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_status AS ENUM ('received', 'pending', 'sent', 'failed');

CREATE TABLE organizations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  -- Secreto que el proveedor manda en Authorization: Bearer. El webhook resuelve
  -- la organización desde acá: el cliente nunca envía un organization_id.
  webhook_token text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel         channel     NOT NULL,
  -- Identificador del contacto en el proveedor (nº de WhatsApp, chat_id de Telegram, visitor_id de webchat)
  external_id     text        NOT NULL,
  display_name    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Un contacto es único por (tenant, canal, id externo). Es la clave con la que
  -- el webhook hace el upsert "crear si no existe".
  CONSTRAINT contacts_org_channel_external_uniq UNIQUE (organization_id, channel, external_id),
  -- Target de las FKs compuestas de abajo (ver conversations).
  CONSTRAINT contacts_id_org_uniq UNIQUE (id, organization_id)
);

CREATE TABLE conversations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      uuid        NOT NULL,
  channel         channel     NOT NULL,
  -- Desnormalizado: siempre = max(created_at) de sus mensajes; se actualiza en cada insert.
  -- Es lo que hace barato ordenar la bandeja por "último mensaje".
  -- timestamptz(3): precisión de milisegundos, igual que Date en JS. Así el cursor de
  -- paginación (que viaja como ISO string) compara exacto y no saltea filas.
  last_message_at timestamptz(3) NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Decisión: una conversación abierta por contacto (sin estado open/closed en este alcance).
  CONSTRAINT conversations_contact_uniq UNIQUE (contact_id),
  -- FK compuesta: la DB garantiza que la conversación y su contacto son del MISMO tenant.
  -- Sin esto, la consistencia dependería solo del código de la app.
  CONSTRAINT conversations_contact_fk
    FOREIGN KEY (contact_id, organization_id) REFERENCES contacts (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT conversations_id_org_uniq UNIQUE (id, organization_id)
);

CREATE TABLE messages (
  id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid              NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid              NOT NULL,
  direction       message_direction NOT NULL,
  status          message_status    NOT NULL,
  body            text              NOT NULL,
  -- Id del mensaje en el proveedor. Obligatorio en inbound (es la clave de idempotencia),
  -- NULL en outbound hasta que el proveedor lo confirme.
  external_id     text,
  created_at      timestamptz(3)    NOT NULL DEFAULT now(), -- (3): ver conversations.last_message_at
  -- Idempotencia del webhook: el mismo mensaje reenviado por el proveedor
  -- choca acá y se descarta con ON CONFLICT DO NOTHING.
  -- Scope por conversación (que ya implica tenant y canal): distintos proveedores pueden repetir ids.
  -- NULL no colisiona en UNIQUE de Postgres, así que los outbound sin id no molestan.
  CONSTRAINT messages_external_id_uniq UNIQUE (conversation_id, external_id),
  -- Idem: un mensaje no puede apuntar a una conversación de otro tenant.
  CONSTRAINT messages_conversation_fk
    FOREIGN KEY (conversation_id, organization_id) REFERENCES conversations (id, organization_id) ON DELETE CASCADE
);

-- Índices -------------------------------------------------------------------

-- Bandeja: "conversaciones de MI organización ordenadas por último mensaje".
-- Cubre el WHERE y el ORDER BY del listado paginado en un solo índice.
CREATE INDEX conversations_org_last_message_idx
  ON conversations (organization_id, last_message_at DESC, id DESC);

-- Hilo de una conversación (y subquery del "último mensaje" en el listado).
CREATE INDEX messages_conversation_created_idx
  ON messages (conversation_id, created_at DESC, id DESC);

-- No hay índice aparte para contacts.organization_id: el UNIQUE (organization_id, channel,
-- external_id) ya es un B-tree que empieza por esa columna y cubre el filtro por tenant.
-- conversations.contact_id está cubierta por su UNIQUE.
