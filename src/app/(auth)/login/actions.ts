"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseCredentials } from "./credentials";
import { ensureOrgForUser } from "./ensure-org";

export async function signUpAction(formData: FormData): Promise<{ error: string }> {
  const parsed = parseCredentials(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signUp(parsed);
  // Deliberately non-committal: under autoconfirm, a distinct message here
  // would reveal whether the email is already registered.
  if (error) return { error: "No se pudo crear la cuenta. Inténtalo de nuevo." };

  const orgError = await ensureOrgForUser(supabase, parsed.email);
  if (orgError) return orgError;

  redirect("/dashboard");
}

export async function signInAction(formData: FormData): Promise<{ error: string }> {
  const parsed = parseCredentials(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed);
  if (error) return { error: "Correo o contraseña incorrectos." };

  const orgError = await ensureOrgForUser(supabase, parsed.email);
  if (orgError) return orgError;

  redirect("/dashboard");
}
