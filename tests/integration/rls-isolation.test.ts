import { beforeAll, describe, expect, it } from "vitest";
import { asAdmin, asUser, createTestUser } from "./db";

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

  it("refuses a direct insert into orgs", async () => {
    await expect(
      asUser(userB, (sql) => sql.query("insert into public.orgs (name) values ('Sneaky')")),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses a direct insert into memberships", async () => {
    await expect(
      asUser(userB, (sql) =>
        sql.query(
          "insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')",
          [orgA, userB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses to delete another org", async () => {
    await asUser(userB, async (sql) => {
      const result = await sql.query("delete from public.orgs where id = $1", [orgA]);
      expect(result.rowCount).toBe(0);
    });
  });
});
