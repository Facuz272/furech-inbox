import { Pool, type QueryResultRow } from "pg";

// Un único Pool por proceso. En dev, Next recarga módulos: lo colgamos de globalThis
// para no abrir una conexión nueva en cada hot reload.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const pool: Pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;

// Wrapper tipado: el llamador declara la forma de la fila y recibe T[] sin `any`.
export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params as unknown[]);
  return result.rows;
}
