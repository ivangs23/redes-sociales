import { createClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";
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
    await client.query("rollback");
    client.release();
  }
}

/** Runs fn as superuser, bypassing RLS. Commits. */
export async function asAdmin<T>(fn: (sql: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
