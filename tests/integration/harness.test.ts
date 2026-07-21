import { describe, expect, it } from "vitest";
import { asAdmin, asUser, createTestUser } from "./db";

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
  });
});
