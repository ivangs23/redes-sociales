import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getRequiredEnv } from "@/lib/env";

export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(items) {
          try {
            for (const { name, value, options } of items) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component (e.g. a layout), which cannot write
            // cookies — Next.js throws here. This is expected when `getUser()`
            // triggers a token refresh outside a Server Action or Route Handler.
            // The refreshed session will be persisted the next time a Server
            // Action or Route Handler runs. Safe to ignore per the documented
            // Supabase SSR pattern.
          }
        },
      },
    },
  );
}
