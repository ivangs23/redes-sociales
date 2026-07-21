import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ensures the currently authenticated user belongs to at least one
 * organization, creating one named after their email's local part if not.
 *
 * This makes org bootstrap self-healing: if bootstrap failed on a previous
 * signup (leaving an authenticated user with zero orgs), simply logging in
 * again retries it instead of leaving the account permanently stranded.
 *
 * The check-and-create is a single database transaction (see
 * `ensure_org_for_current_user`), so two concurrent calls for the same user
 * — e.g. a double-submitted login form — cannot race each other into
 * creating two organizations. The database is the boundary here, not this
 * function.
 */
export async function ensureOrgForUser(
  supabase: SupabaseClient,
  email: string,
): Promise<{ error: string } | null> {
  const orgName = email.split("@")[0] ?? "Mi organización";
  const { error } = await supabase.rpc("ensure_org_for_current_user", {
    org_name: orgName,
  });
  if (error) {
    return { error: "No se pudo crear tu organización. Inténtalo de nuevo." };
  }
  return null;
}
