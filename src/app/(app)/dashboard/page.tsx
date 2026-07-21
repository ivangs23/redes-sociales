import { createServerSupabase } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const { data: orgs } = await supabase.from("orgs").select("id, name").order("created_at");

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Panel</h1>
      <p className="mt-2 text-sm text-gray-500">Organización activa:</p>
      <ul className="mt-1">
        {(orgs ?? []).map((org) => (
          <li key={org.id} data-testid="org-name" className="font-medium">
            {org.name}
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-gray-500">Aún no hay cuentas de Instagram conectadas.</p>
    </main>
  );
}
