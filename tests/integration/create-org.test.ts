import { describe, expect, it } from "vitest";
import { asUser, createTestUser } from "./db";

describe("create_org_for_current_user", () => {
  it("creates the org and makes the caller its owner", async () => {
    const userId = await createTestUser(`owner-${Date.now()}@example.test`);

    const result = await asUser(userId, async (sql) => {
      const created = await sql.query<{ id: string }>(
        "select public.create_org_for_current_user($1) as id",
        ["Estudio Iván"],
      );
      const orgId = created.rows[0]?.id;
      if (!orgId) throw new Error("rpc returned no id");

      const org = await sql.query<{ name: string; plan: string }>(
        "select name, plan from public.orgs where id = $1",
        [orgId],
      );
      const membership = await sql.query<{ role: string }>(
        "select role from public.memberships where org_id = $1 and user_id = $2",
        [orgId, userId],
      );
      return { org: org.rows[0], membership: membership.rows[0] };
    });

    expect(result.org).toEqual({ name: "Estudio Iván", plan: "free" });
    expect(result.membership).toEqual({ role: "owner" });
  });

  it("rejects a blank name", async () => {
    const userId = await createTestUser(`blank-${Date.now()}@example.test`);

    await expect(
      asUser(userId, (sql) => sql.query("select public.create_org_for_current_user($1)", ["   "])),
    ).rejects.toThrow();
  });

  it("cannot be called without an authenticated user", async () => {
    await expect(
      asUser("00000000-0000-0000-0000-000000000000", async (sql) => {
        await sql.query("select set_config($1, $2, true)", ["request.jwt.claims", "{}"]);
        return sql.query("select public.create_org_for_current_user($1)", ["Ghost"]);
      }),
    ).rejects.toThrow(/not authenticated/);
  });
});
