// Stub de autenticación pedido por el enunciado.
// La organización SIEMPRE sale de acá: nunca de query, body ni headers.
// En producción esto leería la cookie/JWT y resolvería el tenant del usuario.

export type Session = {
  userId: string;
  organizationId: string;
};

export async function getSession(): Promise<Session> {
  const userId = process.env.DEMO_USER_ID;
  const organizationId = process.env.DEMO_ORGANIZATION_ID;
  if (!userId || !organizationId) {
    throw new Error("DEMO_USER_ID / DEMO_ORGANIZATION_ID no configurados (ver .env.example)");
  }
  return { userId, organizationId };
}
