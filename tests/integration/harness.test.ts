import { afterAll, describe, expect, it } from "vitest";
import { asAdmin, asUser, cleanupTestUsers, createTestUser } from "./db";

afterAll(cleanupTestUsers);

describe("test harness", () => {
  it("creates a user and exposes its id through auth.uid()", async () => {
    const userId = await createTestUser(`harness-${Date.now()}@example.test`);

    const seen = await asUser(userId, async (sql) => {
      const result = await sql.query<{ uid: string | null }>("select auth.uid() as uid");
      return result.rows[0]?.uid ?? null;
    });

    expect(seen).toBe(userId);
  });

  it("rolls back writes made inside asUser", async () => {
    const orgId = await asAdmin(async (sql) => {
      const result = await sql.query<{ id: string }>(
        "insert into public.orgs (name) values ('rollback probe') returning id",
      );
      const row = result.rows[0];
      if (!row) throw new Error("insert returned no row");
      return row.id;
    });

    try {
      const userId = await createTestUser(`rollback-${Date.now()}@example.test`);

      await asUser(userId, async (sql) => {
        await sql.query("set local role postgres");
        await sql.query("delete from public.orgs where id = $1", [orgId]);
      });

      const stillThere = await asAdmin(async (sql) => {
        const result = await sql.query("select 1 from public.orgs where id = $1", [orgId]);
        return result.rowCount;
      });

      expect(stillThere).toBe(1);
    } finally {
      await asAdmin(async (sql) => {
        await sql.query("delete from public.orgs where id = $1", [orgId]);
      });
    }
  });

  it("switches the current_role to authenticated inside asUser", async () => {
    const userId = await createTestUser(`role-${Date.now()}@example.test`);

    const role = await asUser(userId, async (sql) => {
      const result = await sql.query<{ current_role: string }>("select current_role");
      return result.rows[0]?.current_role ?? null;
    });

    expect(role).toBe("authenticated");
  });

  it("rejects inserts into public.orgs as authenticated (no insert policy)", async () => {
    const userId = await createTestUser(`insert-rls-${Date.now()}@example.test`);

    await expect(
      asUser(userId, async (sql) => {
        await sql.query("insert into public.orgs (name) values ('should be rejected')");
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});
