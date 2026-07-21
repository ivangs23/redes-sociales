import { afterAll, describe, expect, it } from "vitest";
import { asAnon, asUser, cleanupTestUsers, createTestUser } from "./db";

afterAll(cleanupTestUsers);

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

  it("denies anon at the grant level, not just the internal auth check", async () => {
    // If anon still held EXECUTE, this would fail inside the function with
    // "not authenticated" (auth.uid() is null for anon). Revoking EXECUTE
    // from anon must reject the call before the function body ever runs,
    // so the error has to be Postgres' own permission-denied error instead.
    await expect(
      asAnon((sql) => sql.query("select public.create_org_for_current_user($1)", ["x"])),
    ).rejects.toThrow(/permission denied for function create_org_for_current_user/);
  });

  it("denies anon EXECUTE on is_org_member at the grant level", async () => {
    // is_org_member's defining migration never stripped its default PUBLIC
    // grant, so a revoke targeted only at anon would have been a no-op:
    // anon would still inherit EXECUTE through PUBLIC. This must fail with
    // Postgres' own permission-denied error, not run the function body.
    await expect(
      asAnon((sql) =>
        sql.query("select public.is_org_member($1)", ["00000000-0000-0000-0000-000000000000"]),
      ),
    ).rejects.toThrow(/permission denied for function is_org_member/);
  });
});

describe("ensure_org_for_current_user", () => {
  it("is idempotent: calling it twice returns the same org and one membership", async () => {
    const userId = await createTestUser(`ensure-${Date.now()}@example.test`);

    // `asUser` rolls back at the end of the callback, so both calls have to
    // happen inside the same callback to observe them against each other.
    const result = await asUser(userId, async (sql) => {
      const first = await sql.query<{ id: string }>(
        "select public.ensure_org_for_current_user($1) as id",
        ["Estudio Iván"],
      );
      const second = await sql.query<{ id: string }>(
        "select public.ensure_org_for_current_user($1) as id",
        ["Otro nombre"],
      );

      const firstId = first.rows[0]?.id;
      const secondId = second.rows[0]?.id;
      if (!firstId || !secondId) throw new Error("rpc returned no id");

      const memberships = await sql.query<{ role: string }>(
        "select role from public.memberships where org_id = $1 and user_id = $2",
        [firstId, userId],
      );

      return { firstId, secondId, membershipCount: memberships.rowCount };
    });

    expect(result.secondId).toBe(result.firstId);
    expect(result.membershipCount).toBe(1);
  });
});
