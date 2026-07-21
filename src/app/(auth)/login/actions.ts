"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseCredentials } from "./credentials";

export async function signUpAction(formData: FormData): Promise<{ error: string }> {
  const parsed = parseCredentials(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signUp(parsed);
  if (error) return { error: error.message };

  const orgName = parsed.email.split("@")[0] ?? "Mi organización";
  const { error: rpcError } = await supabase.rpc("create_org_for_current_user", {
    org_name: orgName,
  });
  if (rpcError) return { error: rpcError.message };

  redirect("/dashboard");
}

export async function signInAction(formData: FormData): Promise<{ error: string }> {
  const parsed = parseCredentials(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed);
  if (error) return { error: "Correo o contraseña incorrectos." };

  redirect("/dashboard");
}
