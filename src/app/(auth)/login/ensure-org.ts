import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ensures the currently authenticated user belongs to at least one
 * organization, creating one named after their email's local part if not.
 *
 * This makes org bootstrap self-healing: if `create_org_for_current_user`
 * failed on a previous signup (leaving an authenticated user with zero
 * orgs), simply logging in again retries the bootstrap instead of leaving
 * the account permanently stranded.
 *
 * The membership check relies on RLS: an authenticated user can always
 * read their own `memberships` rows, which is enough to tell whether an
 * org already exists for them without needing elevated privileges.
 */
export async function ensureOrgForUser(
  supabase: SupabaseClient,
  email: string,
): Promise<{ error: string } | null> {
  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("org_id")
    .limit(1);
  if (membershipError) {
    return { error: "No se pudo verificar tu organización. Inténtalo de nuevo." };
  }
  if (memberships && memberships.length > 0) {
    return null;
  }

  const orgName = email.split("@")[0] ?? "Mi organización";
  const { error: rpcError } = await supabase.rpc("create_org_for_current_user", {
    org_name: orgName,
  });
  if (rpcError) {
    return { error: "No se pudo crear tu organización. Inténtalo de nuevo." };
  }
  return null;
}
