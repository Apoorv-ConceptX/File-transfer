import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./config";
const globalDb = globalThis as unknown as { toolkitPool?: Pool };
export function pool() {
  return (globalDb.toolkitPool ??= new Pool({
    connectionString: env("DATABASE_URL"),
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  }));
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  return (await pool().query<T>(sql, values)).rows;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
