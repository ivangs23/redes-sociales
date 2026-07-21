# Fase 0 — Fundación: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un usuario puede registrarse, obtener automáticamente su propia organización y ver un dashboard vacío, con Row Level Security demostrada por pruebas que confirman que una organización no puede leer los datos de otra.

**Architecture:** Next.js 16 App Router sobre Supabase. La frontera de seguridad es RLS en Postgres, no el código de aplicación: las tablas no tienen políticas de escritura y toda mutación pasa por funciones `SECURITY DEFINER`. La autenticación usa `@supabase/ssr` con cookies, y la protección de rutas se hace en el layout del servidor mediante `auth.getUser()`.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Supabase (Postgres + Auth + CLI local), Tailwind CSS 4, Biome, Vitest, Playwright, pnpm.

## Global Constraints

- Node `>=22.12.0`. Verificado en la máquina: `v22.22.2`.
- Gestor de paquetes: **pnpm** (`10.33.0`). Nunca `npm install` ni `yarn`.
- Supabase CLI `2.98.1` disponible en el PATH. Docker en marcha (verificado).
- TypeScript en modo `strict`. Prohibido `any` explícito y `@ts-ignore`.
- Lint y formato: **Biome**. El proyecto no usa ESLint ni Prettier.
- Toda tabla con datos de cliente lleva `org_id` y RLS activada.
- Ninguna tabla de negocio tiene políticas `INSERT`, `UPDATE` ni `DELETE` para el rol `authenticated`. Las escrituras pasan por funciones `SECURITY DEFINER` con `set search_path = public`.
- Instantes siempre en UTC (`timestamptz`).
- Los mensajes de commit se escriben en inglés, siguiendo Conventional Commits. La documentación va en español.
- Puerto de Postgres local de Supabase: `54322`. URL: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

**Fuera de alcance de esta fase, deliberadamente:** cualquier código que hable con Meta, la tabla `posts`, la cola de publicación, el composer y el calendario. Todo eso es la Fase 1a y tendrá su propio plan.

**Nota sobre middleware:** Next.js 16 reorganizó el fichero de middleware de raíz. Esta fase **no usa middleware**: la sesión se valida en el layout de servidor con `supabase.auth.getUser()`, que es suficiente y evita depender de una API en movimiento. El refresco proactivo de tokens en el borde se evaluará en la Fase 1a.

---

### Task 1: Andamiaje del proyecto y cadena de herramientas

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `biome.json`, `vitest.config.ts`, `.gitignore` (generados por el andamiaje y editados)
- Create: `src/lib/env.ts`
- Test: `src/lib/env.test.ts`

**Interfaces:**
- Consumes: nada. Es la primera tarea.
- Produces: `getRequiredEnv(name: string): string` — lanza `Error` si la variable no existe o está vacía. Lo usan las tareas 5 y 6.

- [ ] **Step 1: Generar el andamiaje de Next.js**

El repositorio ya contiene `docs/`. `create-next-app` exige un directorio vacío, así que se genera en un temporal y se mueve.

```bash
cd "/Users/ivangonzalez/Documents/Mis proyectos/redes-sociales"
pnpm dlx create-next-app@latest .tmp-scaffold \
  --typescript --tailwind --app --src-dir --no-eslint \
  --use-pnpm --import-alias "@/*" --turbopack --yes
rsync -a .tmp-scaffold/ . --exclude .git
rm -rf .tmp-scaffold
```

- [ ] **Step 2: Verificar que la versión mayor de Next es 16**

Run: `pnpm list next --depth 0`
Expected: una línea con `next 16.x.x`. Si la mayor no es 16, **detente y avisa** antes de continuar: el resto del plan asume App Router de Next 16.

- [ ] **Step 3: Sustituir la configuración de TypeScript por modo estricto**

Reemplaza el contenido de `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Instalar Biome y Vitest**

```bash
pnpm add -D @biomejs/biome@2 vitest@4 @vitejs/plugin-react vite-tsconfig-paths
pnpm biome init
```

- [ ] **Step 5: Configurar Biome**

Reemplaza `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.12/schema.json",
  "files": { "includes": ["src/**", "tests/**", "supabase/**/*.ts"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true, "suspicious": { "noExplicitAny": "error" } }
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 6: Configurar Vitest**

Crea `vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
```

- [ ] **Step 7: Definir los scripts de package.json**

Sustituye el bloque `"scripts"` de `package.json` por:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "biome check .",
  "lint:fix": "biome check --write .",
  "typecheck": "tsc --noEmit",
  "test:unit": "vitest run",
  "test:e2e": "playwright test",
  "db:start": "supabase start",
  "db:stop": "supabase stop",
  "db:reset": "supabase db reset"
}
```

Añade también, al mismo nivel que `"scripts"`:

```json
"engines": { "node": ">=22.12.0" }
```

- [ ] **Step 8: Escribir el test que falla**

Crea `src/lib/env.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { getRequiredEnv } from './env'

const KEY = 'TEST_ONLY_VARIABLE'

afterEach(() => {
  delete process.env[KEY]
})

describe('getRequiredEnv', () => {
  it('returns the value when the variable is set', () => {
    process.env[KEY] = 'hello'
    expect(getRequiredEnv(KEY)).toBe('hello')
  })

  it('throws naming the variable when it is missing', () => {
    expect(() => getRequiredEnv(KEY)).toThrow(KEY)
  })

  it('throws when the variable is an empty string', () => {
    process.env[KEY] = ''
    expect(() => getRequiredEnv(KEY)).toThrow(KEY)
  })
})
```

- [ ] **Step 9: Ejecutar el test y comprobar que falla**

Run: `pnpm test:unit`
Expected: FAIL. `Failed to resolve import "./env"`.

- [ ] **Step 10: Implementar el mínimo**

Crea `src/lib/env.ts`:

```ts
export function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}
```

- [ ] **Step 11: Ejecutar el test y comprobar que pasa**

Run: `pnpm test:unit`
Expected: PASS, 3 tests.

- [ ] **Step 12: Comprobar tipos y lint**

Run: `pnpm typecheck && pnpm lint`
Expected: ambos terminan sin errores. Si Biome señala formato, ejecuta `pnpm lint:fix` y repite.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with strict TS, Biome and Vitest"
```

---

### Task 2: Esquema de organizaciones con RLS

**Files:**
- Create: `supabase/config.toml` (generado por `supabase init`)
- Create: `supabase/migrations/20260721000000_orgs_and_memberships.sql`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces:
  - Tabla `public.orgs(id uuid, name text, plan text, created_at timestamptz)`
  - Tabla `public.memberships(org_id uuid, user_id uuid, role member_role, created_at timestamptz)`, clave primaria `(org_id, user_id)`
  - Función `public.is_org_member(target uuid) returns boolean`
  - Enum `public.member_role` con valores `'owner' | 'member'`
  - Estas tres las consumen las tareas 3, 4 y 6.

- [ ] **Step 1: Inicializar Supabase y arrancar la pila local**

```bash
supabase init
supabase start
```

Expected: al terminar imprime `API URL`, `DB URL`, `anon key` y `service_role key`. Anótalas, la Tarea 3 las necesita.

- [ ] **Step 2: Escribir la migración**

Crea `supabase/migrations/20260721000000_orgs_and_memberships.sql`:

```sql
create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'member');

create table public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  plan       text not null default 'free',
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

alter table public.orgs enable row level security;
alter table public.memberships enable row level security;

-- SECURITY DEFINER para que la política de orgs pueda leer memberships
-- sin quedar atrapada por la propia RLS de memberships (recursión).
create function public.is_org_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = target
      and m.user_id = auth.uid()
  );
$$;

create policy orgs_select_members
  on public.orgs for select to authenticated
  using (public.is_org_member(id));

create policy memberships_select_own
  on public.memberships for select to authenticated
  using (user_id = auth.uid());

-- Sin políticas de INSERT, UPDATE ni DELETE: toda escritura pasa por
-- funciones SECURITY DEFINER. Es intencionado, no un olvido.
```

- [ ] **Step 3: Aplicar la migración**

Run: `pnpm db:reset`
Expected: termina con `Finished supabase db reset.` sin errores de SQL.

- [ ] **Step 4: Verificar que RLS está activa en ambas tablas**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"select tablename, rowsecurity from pg_tables where schemaname='public' order by tablename;"
```

Expected:

```
  tablename  | rowsecurity
-------------+-------------
 memberships | t
 orgs        | t
```

Si alguna muestra `f`, la migración está mal: corrígela y repite el paso 3.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat(db): add orgs and memberships with RLS enabled"
```

---

### Task 3: Arnés de pruebas de base de datos

**Files:**
- Create: `tests/integration/db.ts`
- Create: `.env.test`
- Modify: `.gitignore`
- Test: `tests/integration/harness.test.ts`

**Interfaces:**
- Consumes: `public.orgs`, `public.memberships` de la Tarea 2.
- Produces:
  - `createTestUser(email: string): Promise<string>` — crea un usuario en Supabase Auth y devuelve su `id`.
  - `asUser<T>(userId: string, fn: (sql: PoolClient) => Promise<T>): Promise<T>` — ejecuta `fn` dentro de una transacción con rol `authenticated` y `auth.uid()` igual a `userId`, y hace rollback al terminar.
  - `asAdmin<T>(fn: (sql: PoolClient) => Promise<T>): Promise<T>` — ejecuta `fn` como superusuario, saltándose RLS. Sin rollback.
  - Las tareas 4 y 5 dependen de las tres.

- [ ] **Step 1: Instalar dependencias**

```bash
pnpm add -D pg @types/pg dotenv
pnpm add @supabase/supabase-js
```

- [ ] **Step 2: Crear `.env.test` e ignorarlo**

Obtén las claves con `supabase status`. Crea `.env.test`:

```
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<pega aquí la service_role key de `supabase status`>
```

Añade a `.gitignore`:

```
.env.test
.env.local
```

**La `service_role` key salta toda la RLS. No debe llegar nunca al navegador ni a git.** Es admisible en `.env.test` porque la de Supabase local es una clave fija de desarrollo, sin valor fuera de tu máquina.

- [ ] **Step 3: Cargar `.env.test` en Vitest**

Modifica `vitest.config.ts`, añadiendo la carga al principio del fichero:

```ts
import react from '@vitejs/plugin-react'
import { config as loadEnv } from 'dotenv'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

loadEnv({ path: '.env.test' })

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
```

- [ ] **Step 4: Escribir el test que falla**

Crea `tests/integration/harness.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { asAdmin, asUser, createTestUser } from './db'

describe('test harness', () => {
  it('creates a user and exposes its id through auth.uid()', async () => {
    const userId = await createTestUser(`harness-${Date.now()}@example.test`)

    const seen = await asUser(userId, async (sql) => {
      const result = await sql.query<{ uid: string | null }>('select auth.uid() as uid')
      return result.rows[0]?.uid ?? null
    })

    expect(seen).toBe(userId)
  })

  it('rolls back writes made inside asUser', async () => {
    const orgId = await asAdmin(async (sql) => {
      const result = await sql.query<{ id: string }>(
        "insert into public.orgs (name) values ('rollback probe') returning id",
      )
      const row = result.rows[0]
      if (!row) throw new Error('insert returned no row')
      return row.id
    })

    const userId = await createTestUser(`rollback-${Date.now()}@example.test`)

    await asUser(userId, async (sql) => {
      await sql.query('set local role postgres')
      await sql.query('delete from public.orgs where id = $1', [orgId])
    })

    const stillThere = await asAdmin(async (sql) => {
      const result = await sql.query('select 1 from public.orgs where id = $1', [orgId])
      return result.rowCount
    })

    expect(stillThere).toBe(1)
  })
})
```

- [ ] **Step 5: Ejecutar el test y comprobar que falla**

Run: `pnpm test:unit tests/integration/harness.test.ts`
Expected: FAIL. `Failed to resolve import "./db"`.

- [ ] **Step 6: Implementar el arnés**

Crea `tests/integration/db.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { Pool, type PoolClient } from 'pg'
import { getRequiredEnv } from '@/lib/env'

const pool = new Pool({ connectionString: getRequiredEnv('SUPABASE_DB_URL') })

const admin = createClient(
  getRequiredEnv('SUPABASE_URL'),
  getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false } },
)

export async function createTestUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'test-password-1234',
    email_confirm: true,
  })
  if (error) throw new Error(`createTestUser failed: ${error.message}`)
  return data.user.id
}

/** Runs fn as the given authenticated user. Always rolls back. */
export async function asUser<T>(
  userId: string,
  fn: (sql: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ])
    await client.query('set local role authenticated')
    return await fn(client)
  } finally {
    await client.query('rollback')
    client.release()
  }
}

/** Runs fn as superuser, bypassing RLS. Commits. */
export async function asAdmin<T>(fn: (sql: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}
```

- [ ] **Step 7: Ejecutar el test y comprobar que pasa**

Run: `pnpm test:unit tests/integration/harness.test.ts`
Expected: PASS, 2 tests.

Si el primer test devuelve `null` en lugar del `userId`, la causa es que `set_config` se aplicó fuera de la transacción: comprueba que `begin` va antes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test(db): add Postgres harness for RLS integration tests"
```

---

### Task 4: Creación de organización mediante función SECURITY DEFINER

**Files:**
- Create: `supabase/migrations/20260721000100_create_org_rpc.sql`
- Test: `tests/integration/create-org.test.ts`

**Interfaces:**
- Consumes: `asUser`, `asAdmin`, `createTestUser` de la Tarea 3. `orgs`, `memberships` de la Tarea 2.
- Produces: RPC `public.create_org_for_current_user(org_name text) returns uuid`. La consume la Tarea 6 vía `supabase.rpc('create_org_for_current_user', { org_name })`.

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/integration/create-org.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { asUser, createTestUser } from './db'

describe('create_org_for_current_user', () => {
  it('creates the org and makes the caller its owner', async () => {
    const userId = await createTestUser(`owner-${Date.now()}@example.test`)

    const result = await asUser(userId, async (sql) => {
      const created = await sql.query<{ id: string }>(
        'select public.create_org_for_current_user($1) as id',
        ['Estudio Iván'],
      )
      const orgId = created.rows[0]?.id
      if (!orgId) throw new Error('rpc returned no id')

      const org = await sql.query<{ name: string; plan: string }>(
        'select name, plan from public.orgs where id = $1',
        [orgId],
      )
      const membership = await sql.query<{ role: string }>(
        'select role from public.memberships where org_id = $1 and user_id = $2',
        [orgId, userId],
      )
      return { org: org.rows[0], membership: membership.rows[0] }
    })

    expect(result.org).toEqual({ name: 'Estudio Iván', plan: 'free' })
    expect(result.membership).toEqual({ role: 'owner' })
  })

  it('rejects a blank name', async () => {
    const userId = await createTestUser(`blank-${Date.now()}@example.test`)

    await expect(
      asUser(userId, (sql) =>
        sql.query('select public.create_org_for_current_user($1)', ['   ']),
      ),
    ).rejects.toThrow()
  })

  it('cannot be called without an authenticated user', async () => {
    await expect(
      asUser('00000000-0000-0000-0000-000000000000', async (sql) => {
        await sql.query('select set_config($1, $2, true)', ['request.jwt.claims', '{}'])
        return sql.query('select public.create_org_for_current_user($1)', ['Ghost'])
      }),
    ).rejects.toThrow(/not authenticated/)
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `pnpm test:unit tests/integration/create-org.test.ts`
Expected: FAIL. `function public.create_org_for_current_user(unknown) does not exist`.

- [ ] **Step 3: Escribir la migración**

Crea `supabase/migrations/20260721000100_create_org_rpc.sql`:

```sql
create function public.create_org_for_current_user(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller  uuid := auth.uid();
  new_org uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  insert into public.orgs (name)
  values (trim(org_name))
  returning id into new_org;

  insert into public.memberships (org_id, user_id, role)
  values (new_org, caller, 'owner');

  return new_org;
end;
$$;

revoke all on function public.create_org_for_current_user(text) from public;
grant execute on function public.create_org_for_current_user(text) to authenticated;
```

- [ ] **Step 4: Aplicar y ejecutar los tests**

```bash
pnpm db:reset
pnpm test:unit tests/integration/create-org.test.ts
```

Expected: PASS, 3 tests.

El test del nombre en blanco pasa gracias al `check (length(trim(name)) > 0)` de la Tarea 2, que la función respeta porque `trim` deja la cadena vacía.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): add create_org_for_current_user security definer rpc"
```

---

### Task 5: Pruebas de aislamiento entre organizaciones

**Files:**
- Test: `tests/integration/rls-isolation.test.ts`

**Interfaces:**
- Consumes: `asUser`, `asAdmin`, `createTestUser` de la Tarea 3. El RPC de la Tarea 4.
- Produces: nada de código. Produce la garantía de la que depende todo el modelo multi-inquilino.

Esta tarea no añade funcionalidad. Existe porque una filtración de datos entre clientes es el fallo que hunde el producto, y la única defensa que sobrevive a un error de código es una prueba que lo demuestre.

- [ ] **Step 1: Escribir las pruebas**

Crea `tests/integration/rls-isolation.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { asAdmin, asUser, createTestUser } from './db'

let userA: string
let userB: string
let orgA: string

beforeAll(async () => {
  const stamp = Date.now()
  userA = await createTestUser(`iso-a-${stamp}@example.test`)
  userB = await createTestUser(`iso-b-${stamp}@example.test`)

  orgA = await asAdmin(async (sql) => {
    const org = await sql.query<{ id: string }>(
      "insert into public.orgs (name) values ('Org A') returning id",
    )
    const id = org.rows[0]?.id
    if (!id) throw new Error('seed failed')
    await sql.query(
      "insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')",
      [id, userA],
    )
    return id
  })
})

describe('RLS isolation', () => {
  it('lets a member read their own org', async () => {
    const rows = await asUser(userA, async (sql) => {
      const result = await sql.query('select id from public.orgs where id = $1', [orgA])
      return result.rowCount
    })
    expect(rows).toBe(1)
  })

  it('hides an org from a non-member', async () => {
    const rows = await asUser(userB, async (sql) => {
      const result = await sql.query('select id from public.orgs where id = $1', [orgA])
      return result.rowCount
    })
    expect(rows).toBe(0)
  })

  it('hides memberships of other users', async () => {
    const rows = await asUser(userB, async (sql) => {
      const result = await sql.query('select user_id from public.memberships')
      return result.rowCount
    })
    expect(rows).toBe(0)
  })

  it('refuses a direct insert into orgs', async () => {
    await expect(
      asUser(userB, (sql) =>
        sql.query("insert into public.orgs (name) values ('Sneaky')"),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('refuses a direct insert into memberships', async () => {
    await expect(
      asUser(userB, (sql) =>
        sql.query(
          "insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')",
          [orgA, userB],
        ),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('refuses to delete another org', async () => {
    await asUser(userB, async (sql) => {
      const result = await sql.query('delete from public.orgs where id = $1', [orgA])
      expect(result.rowCount).toBe(0)
    })
  })
})
```

- [ ] **Step 2: Ejecutar y verificar**

Run: `pnpm test:unit tests/integration/rls-isolation.test.ts`
Expected: PASS, 6 tests.

Todas deben pasar a la primera: las políticas de la Tarea 2 ya son correctas. Si alguna falla, **no ajustes el test** — la política es lo que está mal.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/rls-isolation.test.ts
git commit -m "test(db): prove cross-org isolation under RLS"
```

---

### Task 6: Autenticación y dashboard protegido

**Files:**
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/client.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/login/credentials.ts`
- Create: `src/app/(auth)/login/actions.ts`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/dashboard/page.tsx`
- Create: `.env.local`
- Test: `src/app/(auth)/login/credentials.test.ts`

**Interfaces:**
- Consumes: `getRequiredEnv` de la Tarea 1. El RPC `create_org_for_current_user` de la Tarea 4.
- Produces:
  - `createServerSupabase(): Promise<SupabaseClient>` — cliente de servidor con cookies. Lo usará la Fase 1a.
  - `signUpAction(formData: FormData): Promise<{ error: string } | never>` — registra, crea la organización y redirige a `/dashboard`.
  - `signInAction(formData: FormData): Promise<{ error: string } | never>`
  - `parseCredentials(formData: FormData): { email: string; password: string } | { error: string }` — validación pura, exportada desde `credentials.ts`. Es lo que se prueba unitariamente.

**Por qué `parseCredentials` vive en su propio fichero:** un módulo marcado con `'use server'` obliga a que **todos** sus exports sean funciones asíncronas. `parseCredentials` es síncrona, así que exportarla desde `actions.ts` rompe la compilación. Va en `credentials.ts`, sin directiva.

- [ ] **Step 1: Instalar `@supabase/ssr` y crear `.env.local`**

```bash
pnpm add @supabase/ssr
```

Crea `.env.local` con los valores de `supabase status`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key de `supabase status`>
```

Solo la clave `anon` va con prefijo `NEXT_PUBLIC_`. **La `service_role` no aparece nunca en este fichero**: cualquier variable `NEXT_PUBLIC_` se incrusta en el bundle del navegador.

- [ ] **Step 2: Escribir el test que falla**

Crea `src/app/(auth)/login/credentials.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseCredentials } from './credentials'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

describe('parseCredentials', () => {
  it('accepts a valid email and password', () => {
    expect(parseCredentials(form({ email: 'a@b.com', password: 'longenough' }))).toEqual({
      email: 'a@b.com',
      password: 'longenough',
    })
  })

  it('trims and lowercases the email', () => {
    expect(parseCredentials(form({ email: '  A@B.COM ', password: 'longenough' }))).toEqual({
      email: 'a@b.com',
      password: 'longenough',
    })
  })

  it('rejects a malformed email', () => {
    expect(parseCredentials(form({ email: 'nope', password: 'longenough' }))).toEqual({
      error: 'Introduce un correo electrónico válido.',
    })
  })

  it('rejects a password under 8 characters', () => {
    expect(parseCredentials(form({ email: 'a@b.com', password: 'short' }))).toEqual({
      error: 'La contraseña debe tener al menos 8 caracteres.',
    })
  })

  it('rejects missing fields', () => {
    expect(parseCredentials(form({}))).toEqual({
      error: 'Introduce un correo electrónico válido.',
    })
  })
})
```

- [ ] **Step 3: Ejecutar y comprobar que falla**

Run: `pnpm test:unit src/app/`
Expected: FAIL. `Failed to resolve import "./credentials"`.

- [ ] **Step 4: Crear los clientes de Supabase**

Crea `src/lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getRequiredEnv } from '@/lib/env'

export async function createServerSupabase() {
  const cookieStore = await cookies()

  return createServerClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(items) {
          for (const { name, value, options } of items) {
            cookieStore.set(name, value, options)
          }
        },
      },
    },
  )
}
```

Crea `src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'
import { getRequiredEnv } from '@/lib/env'

export function createBrowserSupabase() {
  return createBrowserClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  )
}
```

- [ ] **Step 5: Escribir la validación pura**

Crea `src/app/(auth)/login/credentials.ts` (sin directiva `'use server'`):

```ts
export type Credentials = { email: string; password: string }
export type ParseResult = Credentials | { error: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseCredentials(formData: FormData): ParseResult {
  const rawEmail = formData.get('email')
  const rawPassword = formData.get('password')
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  const password = typeof rawPassword === 'string' ? rawPassword : ''

  if (!EMAIL_PATTERN.test(email)) {
    return { error: 'Introduce un correo electrónico válido.' }
  }
  if (password.length < 8) {
    return { error: 'La contraseña debe tener al menos 8 caracteres.' }
  }
  return { email, password }
}
```

- [ ] **Step 5b: Escribir las acciones de servidor**

Crea `src/app/(auth)/login/actions.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { parseCredentials } from './credentials'

export async function signUpAction(formData: FormData): Promise<{ error: string }> {
  const parsed = parseCredentials(formData)
  if ('error' in parsed) return parsed

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signUp(parsed)
  if (error) return { error: error.message }

  const orgName = parsed.email.split('@')[0] ?? 'Mi organización'
  const { error: rpcError } = await supabase.rpc('create_org_for_current_user', {
    org_name: orgName,
  })
  if (rpcError) return { error: rpcError.message }

  redirect('/dashboard')
}

export async function signInAction(formData: FormData): Promise<{ error: string }> {
  const parsed = parseCredentials(formData)
  if ('error' in parsed) return parsed

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword(parsed)
  if (error) return { error: 'Correo o contraseña incorrectos.' }

  redirect('/dashboard')
}
```

`redirect()` lanza internamente en Next, por eso las funciones nunca devuelven en el camino de éxito. El tipo de retorno declara solo el caso de error.

- [ ] **Step 6: Ejecutar los tests unitarios**

Run: `pnpm test:unit src/app/`
Expected: PASS, 5 tests.

- [ ] **Step 7: Crear la página de login**

Crea `src/app/(auth)/login/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { signInAction, signUpAction } from './actions'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)

  async function handle(action: (data: FormData) => Promise<{ error: string }>, data: FormData) {
    const result = await action(data)
    setError(result.error)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Entrar</h1>
      <form className="flex flex-col gap-4">
        <input
          name="email"
          type="email"
          placeholder="Correo electrónico"
          aria-label="Correo electrónico"
          className="rounded border px-3 py-2"
        />
        <input
          name="password"
          type="password"
          placeholder="Contraseña"
          aria-label="Contraseña"
          className="rounded border px-3 py-2"
        />
        <button
          type="submit"
          formAction={(data) => handle(signInAction, data)}
          className="rounded bg-black px-3 py-2 text-white"
        >
          Entrar
        </button>
        <button
          type="submit"
          formAction={(data) => handle(signUpAction, data)}
          className="rounded border px-3 py-2"
        >
          Crear cuenta
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </main>
  )
}
```

- [ ] **Step 8: Crear el layout protegido y el dashboard**

Crea `src/app/(app)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) redirect('/login')

  return <div className="min-h-screen">{children}</div>
}
```

Se usa `getUser()`, no `getSession()`: `getUser()` valida el token contra el servidor de Supabase, mientras que `getSession()` se fía de la cookie, que el cliente puede manipular.

Crea `src/app/(app)/dashboard/page.tsx`:

```tsx
import { createServerSupabase } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createServerSupabase()
  const { data: orgs } = await supabase.from('orgs').select('id, name').order('created_at')

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
      <p className="mt-8 text-sm text-gray-500">
        Aún no hay cuentas de Instagram conectadas.
      </p>
    </main>
  )
}
```

La consulta no filtra por `org_id`: no hace falta, porque la RLS de la Tarea 2 ya devuelve solo las organizaciones del usuario. Ese es exactamente el punto de tener la frontera en la base de datos.

- [ ] **Step 9: Comprobación manual**

```bash
pnpm dev
```

Abre `http://localhost:3000/dashboard`.
Expected: redirige a `/login`. Crea una cuenta con un correo cualquiera y una contraseña de 8 caracteres o más. Expected: aterrizas en `/dashboard` y ves tu organización, nombrada con la parte del correo anterior a la arroba.

- [ ] **Step 10: Comprobar tipos, lint y toda la suite**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: sin errores y 19 tests en verde — 3 de `env`, 2 del arnés, 3 del RPC, 6 de aislamiento, 5 de credenciales.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(auth): add email auth, org bootstrap on signup and protected dashboard"
```

---

### Task 7: Prueba E2E e integración continua

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/auth.spec.ts`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: la aplicación completa de las tareas 1 a 6.
- Produces: `pnpm test:e2e` en verde y un CI que ejecuta lint, tipos, unitarias, integración y E2E en cada push.

- [ ] **Step 1: Instalar Playwright**

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: Configurar Playwright**

Crea `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

- [ ] **Step 3: Escribir la prueba E2E**

Crea `tests/e2e/auth.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('an anonymous visitor is sent to login', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login$/)
})

test('a new user signs up and lands on their own org', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`

  await page.goto('/login')
  await page.getByLabel('Correo electrónico').fill(email)
  await page.getByLabel('Contraseña').fill('test-password-1234')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()

  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByTestId('org-name')).toHaveText(email.split('@')[0] as string)
})

test('a malformed email shows an error and stays on login', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Correo electrónico').fill('nope')
  await page.getByLabel('Contraseña').fill('test-password-1234')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()

  await expect(page.getByRole('alert')).toHaveText('Introduce un correo electrónico válido.')
  await expect(page).toHaveURL(/\/login$/)
})
```

- [ ] **Step 4: Ejecutar las pruebas E2E**

```bash
supabase start
pnpm test:e2e
```

Expected: PASS, 3 tests.

Si la segunda falla porque Supabase exige confirmar el correo, desactiva la confirmación en desarrollo añadiendo a `supabase/config.toml`, bajo `[auth.email]`:

```toml
enable_confirmations = false
```

Después `supabase stop && supabase start`, y repite.

- [ ] **Step 5: Crear el workflow de CI**

Crea `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - run: supabase start

      - name: Export Supabase credentials
        run: |
          echo "SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres" >> .env.test
          echo "SUPABASE_URL=$(supabase status -o env | grep '^API_URL=' | cut -d= -f2- | tr -d '\"')" >> .env.test
          echo "SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '\"')" >> .env.test
          echo "NEXT_PUBLIC_SUPABASE_URL=$(supabase status -o env | grep '^API_URL=' | cut -d= -f2- | tr -d '\"')" >> .env.local
          echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(supabase status -o env | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '\"')" >> .env.local

      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:unit

      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
```

- [ ] **Step 6: Escribir el README**

Crea `README.md`:

````markdown
# redes-sociales

SaaS de programación y publicación en Instagram. Diseño en
[`docs/superpowers/specs`](docs/superpowers/specs).

## Requisitos

- Node >= 22.12
- pnpm 10
- Supabase CLI
- Docker en ejecución

## Arranque

```bash
pnpm install
supabase start          # imprime las claves locales
cp .env.example .env.local   # rellena con la anon key
pnpm dev
```

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor de desarrollo |
| `pnpm lint` | Biome |
| `pnpm typecheck` | TypeScript |
| `pnpm test:unit` | Vitest: unitarias e integración con Postgres |
| `pnpm test:e2e` | Playwright |
| `pnpm db:reset` | Reaplica todas las migraciones |

## Reglas de arquitectura

1. Ninguna llamada a `graph.facebook.com` fuera de `core/instagram/`.
2. Toda tabla con datos de cliente lleva `org_id` y RLS.
3. Ninguna tabla tiene políticas de escritura: se escribe vía funciones
   `SECURITY DEFINER`.
4. La clave `service_role` nunca sale del servidor ni entra en git.
````

Crea también `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

- [ ] **Step 7: Verificación final completa**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e`
Expected: todo en verde. 19 unitarias e integración, 3 E2E.

- [ ] **Step 8: Commit y push**

```bash
git add -A
git commit -m "ci: add Playwright e2e suite and GitHub Actions pipeline"
git push
```

---

## Criterios de aceptación de la Fase 0

- [ ] Un visitante anónimo que abre `/dashboard` acaba en `/login`.
- [ ] Registrarse crea la organización y la pertenencia como `owner`, en una sola operación atómica.
- [ ] El dashboard muestra la organización del usuario sin filtrar por `org_id` en el código de aplicación.
- [ ] Un usuario de la organización B no lee ni una fila de la A, demostrado por pruebas.
- [ ] Ninguna tabla acepta escrituras directas del rol `authenticated`.
- [ ] `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e` pasa en local y en CI.
