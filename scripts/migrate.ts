// Corre db/*.sql en orden dentro de una transacción. Sin ORM, a propósito.
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

async function main(): Promise<void> {
  const dir = path.join(process.cwd(), "db");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const file of files) {
      console.log(`→ ${file}`);
      await client.query(await readFile(path.join(dir, file), "utf8"));
    }
    await client.query("COMMIT");
    console.log("Migraciones aplicadas.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
