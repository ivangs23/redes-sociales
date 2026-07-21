import { createClient } from "@supabase/supabase-js";
import { Client, Pool, type PoolClient } from "pg";
import { getRequiredEnv } from "@/lib/env";

const pool = new Pool({ connectionString: getRequiredEnv("SUPABASE_DB_URL") });

const admin = createClient(
  getRequiredEnv("SUPABASE_URL"),
  getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

export async function createTestUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "test-password-1234",
    email_confirm: true,
  });
  if (error) throw new Error(`createTestUser failed: ${error.message}`);
  return data.user.id;
}

/** Runs fn as the given authenticated user. Always rolls back. */
export async function asUser<T>(userId: string, fn: (sql: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config($1, $2, true)", [
      "request.jwt.claims",
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
    return await fn(client);
  } finally {
    try {
      await client.query("rollback");
    } finally {
      client.release();
    }
  }
}

/**
 * Runs fn as the anon role, connecting through the `authenticator` role the
 * way PostgREST does for real anon requests.
 *
 * This intentionally does NOT reuse the shared `pool` behind `asUser`. That
 * pool connects as `postgres`, and on this local dev Postgres image, running
 * `set local role anon` on a `postgres` session and then hitting a
 * function-EXECUTE permission denial for that role crashes the backend with
 * SIGSEGV — reproduced independently of any of this project's own functions,
 * so it is a defect in the local dev image/extensions, not in the schema.
 * The identical check performed through `authenticator` (the role PostgREST
 * actually connects as) behaves correctly and returns a normal permission-
 * denied error, matching what a real anon HTTP request receives. Always
 * rolls back.
 */
export async function asAnon<T>(fn: (sql: Client) => Promise<T>): Promise<T> {
  const url = new URL(getRequiredEnv("SUPABASE_DB_URL"));
  url.username = "authenticator";
  url.password = "postgres";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role anon");
    return await fn(client);
  } finally {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }
}

/** Runs fn as superuser, bypassing RLS. Commits, or rolls back and rethrows on error. */
export async function asAdmin<T>(fn: (sql: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    try {
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    client.release();
  }
}
