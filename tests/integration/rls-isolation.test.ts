import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAdmin, asUser, cleanupTestUsers, createTestUser } from "./db";

let userA: string;
let userB: string;
let orgA: string;

beforeAll(async () => {
  const stamp = Date.now();
  userA = await createTestUser(`iso-a-${stamp}@example.test`);
  userB = await createTestUser(`iso-b-${stamp}@example.test`);

  orgA = await asAdmin(async (sql) => {
    const org = await sql.query<{ id: string }>(
      "insert into public.orgs (name) values ('Org A') returning id",
    );
    const id = org.rows[0]?.id;
    if (!id) throw new Error("seed failed");
    await sql.query(
      "insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')",
      [id, userA],
    );
    return id;
  });
});

afterAll(async () => {
  // Deleting userA/userB cascades to their memberships, but `orgA` was
  // seeded directly via asAdmin (committed, not rolled back) and is not
  // referenced by auth.users, so it survives a user delete and must be
  // removed explicitly.
  await asAdmin((sql) => sql.query("delete from public.orgs where id = $1", [orgA]));
  await cleanupTestUsers();
});

describe("RLS isolation", () => {
  it("lets a member read their own org", async () => {
    const rows = await asUser(userA, async (sql) => {
      const result = await sql.query("select id from public.orgs where id = $1", [orgA]);
      return result.rowCount;
    });
    expect(rows).toBe(1);
  });

  it("hides an org from a non-member", async () => {
    const rows = await asUser(userB, async (sql) => {
      const result = await sql.query("select id from public.orgs where id = $1", [orgA]);
      return result.rowCount;
    });
    expect(rows).toBe(0);
  });

  it("hides memberships of other users", async () => {
    const rows = await asUser(userB, async (sql) => {
      const result = await sql.query("select user_id from public.memberships");
      return result.rowCount;
    });
    expect(rows).toBe(0);
  });

  // authenticated holds no INSERT/UPDATE/DELETE grant on public.orgs or
  // public.memberships (see
  // supabase/migrations/20260721000500_explicit_table_grants.sql): every
  // write attempt below is rejected by the grant check itself, before RLS
  // is ever consulted. That is a stronger guarantee than an RLS denial —
  // there is no policy to misconfigure, because the ACL has no matching
  // entry at all. Writes go exclusively through the SECURITY DEFINER
  // functions (create_org_for_current_user, ensure_org_for_current_user).

  it("refuses a direct insert into orgs", async () => {
    await expect(
      asUser(userB, (sql) => sql.query("insert into public.orgs (name) values ('Sneaky')")),
    ).rejects.toThrow(/permission denied for table orgs/);
  });

  it("refuses a direct insert into memberships", async () => {
    await expect(
      asUser(userB, (sql) =>
        sql.query(
          "insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')",
          [orgA, userB],
        ),
      ),
    ).rejects.toThrow(/permission denied for table memberships/);
  });

  it("refuses to delete another org", async () => {
    // Not scoped to "another org": authenticated has no DELETE grant on
    // public.orgs at all, so this is rejected regardless of which org id is
    // targeted or whether userB is a member of it.
    await expect(
      asUser(userB, (sql) => sql.query("delete from public.orgs where id = $1", [orgA])),
    ).rejects.toThrow(/permission denied for table orgs/);
  });

  it("refuses to update another org", async () => {
    // Same story as the delete above: no UPDATE grant exists for
    // authenticated on public.orgs, so the write is blocked at the ACL
    // check before RLS row-scoping would even come into play.
    await expect(
      asUser(userB, (sql) =>
        sql.query("update public.orgs set name = 'Hijacked' where id = $1", [orgA]),
      ),
    ).rejects.toThrow(/permission denied for table orgs/);
  });
});
