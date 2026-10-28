import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import pg from "pg";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL in .env.local");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  console.log("Database schema ready.");
} finally {
  await client.end();
}
