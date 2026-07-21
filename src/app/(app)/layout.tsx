import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  return <div className="min-h-screen">{children}</div>;
}
