// Crea dos organizaciones (para poder probar el aislamiento entre tenants)
// e imprime los ids que van en .env como sesión simulada.
import "dotenv/config";
import { Client } from "pg";

type OrgRow = { id: string; name: string; webhook_token: string };

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<OrgRow>(
      `INSERT INTO organizations (name) VALUES ('Acme'), ('Globex') RETURNING id, name, webhook_token`,
    );
    for (const org of rows) console.log(`${org.name.padEnd(8)} id=${org.id}  webhook_token=${org.webhook_token}`);
    console.log("\nPegá en .env:");
    console.log(`DEMO_USER_ID=${crypto.randomUUID()}`);
    console.log(`DEMO_ORGANIZATION_ID=${rows[0]?.id ?? ""}`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
