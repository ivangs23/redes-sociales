# Fase 1a-1 — Motor de publicación: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un post programado para dentro de un minuto acaba en estado `publicado` sin intervención, atravesando el ciclo completo de contenedor, sondeo y publicación contra `MockAdapter` — y un corte de red simulado entre el contenedor y la publicación **no** produce dos publicaciones.

**Architecture:** Toda la API de Meta vive detrás de `InstagramPort`, con dos implementaciones intercambiables por variable de entorno. El estado de cada post vive en Postgres; la cola toma trabajo con `FOR UPDATE SKIP LOCKED` y la idempotencia se apoya en el `container_id` persistido antes de publicar. La lógica de transición de estados es una función pura, probada sin base de datos.

**Tech Stack:** Next.js 16 (Route Handler para el cron), TypeScript strict, Supabase Postgres, Vitest, Biome, pnpm.

## Global Constraints

Heredados de la Fase 0, todos vigentes:

- Node `>=22.12.0`. Gestor de paquetes **pnpm** únicamente.
- TypeScript `strict`. Prohibido `any` explícito y `@ts-ignore`.
- Lint y formato con **Biome**.
- Toda tabla con datos de cliente lleva `org_id` y RLS activada.
- Ninguna tabla tiene políticas `INSERT`, `UPDATE` ni `DELETE` para el rol `authenticated`. Las escrituras del usuario pasan por funciones `SECURITY DEFINER` con `set search_path = public`.
- Instantes siempre en UTC (`timestamptz`).
- Supabase local en el rango `5442x`: API `54421`, Postgres `54422`. Servidor de desarrollo en el `3100`.
- No hay `psql` en el host: usar `docker exec supabase_db_redes-sociales psql -U postgres -c "..."`.
- Mensajes de commit en inglés siguiendo Conventional Commits; documentación en español.

Nuevos, propios de esta fase:

- **Ninguna llamada a `graph.facebook.com` fuera de `src/core/instagram/`.** Es la regla que permite construir esta fase entera sin App de Meta aprobada.
- El adaptador se elige con `INSTAGRAM_ADAPTER`, que acepta `mock` o `graph`. En esta fase solo se implementa `mock`; pedir `graph` debe fallar de forma explícita, no silenciosa.
- El worker de la cola es la única pieza que cambia `posts.estado`. Ningún otro código escribe esa columna.

**Fuera de alcance de este plan, deliberadamente:** `GraphAdapter` real, OAuth con Instagram, composer, calendario, carruseles, analítica, inbox. Los carruseles llegan en la Fase 1b; el composer y el calendario, en el plan hermano `fase-1a-2`.

---

### Task 1: Esquema de cuentas, medios y posts

**Files:**
- Create: `supabase/migrations/20260722000000_posts_and_media.sql`
- Test: `tests/integration/posts-schema.test.ts`

**Interfaces:**
- Consumes: `public.orgs`, `public.memberships`, `public.is_org_member(uuid)` de la Fase 0. El arnés `asUser` / `asAdmin` / `createTestUser` / `cleanupTestUsers` de `tests/integration/db.ts`.
- Produces: tablas `ig_accounts`, `media_assets`, `posts`, `post_assets`, `publish_attempts`, y el enum `public.post_state`. Las consumen todas las tareas siguientes.

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/integration/posts-schema.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asAdmin, asUser, cleanupTestUsers, createTestUser } from './db'

let userA: string
let userB: string
let orgA: string
let postA: string

beforeAll(async () => {
  const stamp = Date.now()
  userA = await createTestUser(`posts-a-${stamp}@example.test`)
  userB = await createTestUser(`posts-b-${stamp}@example.test`)

  const seeded = await asAdmin(async (sql) => {
    const org = await sql.query<{ id: string }>(
      "insert into public.orgs (name) values ('Posts Org') returning id",
    )
    const orgId = org.rows[0]?.id
    if (!orgId) throw new Error('seed failed')
    await sql.query(
      "insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')",
      [orgId, userA],
    )
    const account = await sql.query<{ id: string }>(
      `insert into public.ig_accounts (org_id, ig_user_id, username, encrypted_token, expires_at)
       values ($1, 'ig-1', 'suarex', 'cipher', now() + interval '60 days') returning id`,
      [orgId],
    )
    const accountId = account.rows[0]?.id
    if (!accountId) throw new Error('account seed failed')
    const post = await sql.query<{ id: string }>(
      `insert into public.posts (org_id, ig_account_id, kind, caption, publish_at)
       values ($1, $2, 'image', 'hola', now() + interval '1 hour') returning id`,
      [orgId, accountId],
    )
    const postId = post.rows[0]?.id
    if (!postId) throw new Error('post seed failed')
    return { orgId, postId }
  })

  orgA = seeded.orgId
  postA = seeded.postId
})

afterAll(async () => {
  await asAdmin(async (sql) => {
    await sql.query('delete from public.orgs where id = $1', [orgA])
  })
  await cleanupTestUsers()
})

describe('posts schema', () => {
  it('defaults a new post to the borrador state', async () => {
    const state = await asUser(userA, async (sql) => {
      const result = await sql.query<{ state: string }>(
        'select state from public.posts where id = $1',
        [postA],
      )
      return result.rows[0]?.state
    })
    expect(state).toBe('borrador')
  })

  it('hides another org posts', async () => {
    const rows = await asUser(userB, async (sql) => {
      const result = await sql.query('select id from public.posts where id = $1', [postA])
      return result.rowCount
    })
    expect(rows).toBe(0)
  })

  it('hides another org instagram accounts', async () => {
    const rows = await asUser(userB, async (sql) => {
      const result = await sql.query('select id from public.ig_accounts where org_id = $1', [orgA])
      return result.rowCount
    })
    expect(rows).toBe(0)
  })

  it('never exposes the encrypted token to a member', async () => {
    await expect(
      asUser(userA, (sql) => sql.query('select encrypted_token from public.ig_accounts')),
    ).rejects.toThrow(/permission denied/)
  })

  it('refuses a direct insert into posts', async () => {
    await expect(
      asUser(userA, (sql) =>
        sql.query(
          `insert into public.posts (org_id, ig_account_id, kind, caption, publish_at)
           values ($1, $1, 'image', 'x', now())`,
          [orgA],
        ),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('rejects an unknown state', async () => {
    await expect(
      asAdmin((sql) =>
        sql.query('update public.posts set state = $1 where id = $2', ['inventado', postA]),
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `pnpm test:unit tests/integration/posts-schema.test.ts`
Expected: FAIL. `relation "public.ig_accounts" does not exist`.

- [ ] **Step 3: Escribir la migración**

Crea `supabase/migrations/20260722000000_posts_and_media.sql`:

```sql
create type public.post_state as enum (
  'borrador', 'programado', 'subiendo', 'listo', 'publicado', 'fallido', 'cancelado'
);

create type public.post_kind as enum ('image', 'reel', 'carousel');

create table public.ig_accounts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  ig_user_id      text not null,
  username        text not null,
  encrypted_token text not null,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (org_id, ig_user_id)
);

create table public.media_assets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  storage_path  text not null,
  mime_type     text not null,
  width         integer,
  height        integer,
  duration_ms   integer,
  created_at    timestamptz not null default now()
);

create table public.posts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs (id) on delete cascade,
  ig_account_id  uuid not null references public.ig_accounts (id) on delete cascade,
  kind           public.post_kind not null,
  caption        text not null default '',
  publish_at     timestamptz not null,
  state          public.post_state not null default 'borrador',
  container_id   text,
  ig_media_id    text,
  attempts       integer not null default 0,
  last_error     text,
  locked_until   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index posts_due_idx on public.posts (publish_at) where state = 'programado';
create index posts_org_idx on public.posts (org_id, publish_at);

create table public.post_assets (
  post_id         uuid not null references public.posts (id) on delete cascade,
  media_asset_id  uuid not null references public.media_assets (id) on delete cascade,
  position        integer not null,
  primary key (post_id, position)
);

create table public.publish_attempts (
  id          bigserial primary key,
  post_id     uuid not null references public.posts (id) on delete cascade,
  attempt     integer not null,
  request     jsonb,
  response    jsonb,
  created_at  timestamptz not null default now()
);

create index publish_attempts_post_idx on public.publish_attempts (post_id, created_at);

alter table public.ig_accounts    enable row level security;
alter table public.media_assets   enable row level security;
alter table public.posts          enable row level security;
alter table public.post_assets    enable row level security;
alter table public.publish_attempts enable row level security;

create policy ig_accounts_select_members  on public.ig_accounts  for select to authenticated using (public.is_org_member(org_id));
create policy media_assets_select_members on public.media_assets for select to authenticated using (public.is_org_member(org_id));
create policy posts_select_members        on public.posts        for select to authenticated using (public.is_org_member(org_id));

create policy post_assets_select_members on public.post_assets for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.is_org_member(p.org_id)));

create policy publish_attempts_select_members on public.publish_attempts for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.is_org_member(p.org_id)));

-- El token cifrado no se expone ni a los miembros de la organización: solo el
-- código de servidor, que actúa con service_role, puede leerlo.
revoke select (encrypted_token) on public.ig_accounts from authenticated;
```

- [ ] **Step 4: Aplicar y ejecutar**

```bash
pnpm db:reset
pnpm test:unit tests/integration/posts-schema.test.ts
```

Expected: PASS, 6 tests.

Si el test del token falla porque la consulta devuelve datos en vez de lanzar, el `revoke` a nivel de columna no se aplicó: comprueba que va después del `create table` y que el rol es exactamente `authenticated`.

- [ ] **Step 5: Commit**

```bash
git add supabase tests
git commit -m "feat(db): add instagram accounts, media, posts and publish attempts"
```

---

### Task 2: InstagramPort y MockAdapter

**Files:**
- Create: `src/core/instagram/port.ts`
- Create: `src/core/instagram/mock-adapter.ts`
- Create: `src/core/instagram/index.ts`
- Test: `src/core/instagram/mock-adapter.test.ts`

**Interfaces:**
- Consumes: `getRequiredEnv` de `@/lib/env`.
- Produces:
  - `type ContainerId = string`, `type PublishedMediaId = string`, `type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR'`
  - `type MediaInput = { kind: 'image' | 'reel'; mediaUrl: string; caption: string }`
  - `interface InstagramPort` con `createMediaContainer`, `getContainerStatus`, `publishContainer`, `getAccount`
  - `class InstagramError extends Error` con `code: string` y `retryable: boolean`
  - `createMockAdapter(script?: MockScript): InstagramPort`
  - `getInstagramPort(): InstagramPort` desde `index.ts`
  - Las tareas 4 y 5 dependen de todo lo anterior.

- [ ] **Step 1: Escribir el test que falla**

Crea `src/core/instagram/mock-adapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createMockAdapter } from './mock-adapter'
import { InstagramError } from './port'

const input = { kind: 'image', mediaUrl: 'https://example.test/a.jpg', caption: 'hola' } as const

describe('createMockAdapter', () => {
  it('creates a container and finishes immediately by default', async () => {
    const port = createMockAdapter()
    const container = await port.createMediaContainer(input)
    expect(container).toMatch(/^mock-container-/)
    expect(await port.getContainerStatus(container)).toBe('FINISHED')
  })

  it('publishes a finished container and returns a media id', async () => {
    const port = createMockAdapter()
    const container = await port.createMediaContainer(input)
    const media = await port.publishContainer(container)
    expect(media).toMatch(/^mock-media-/)
  })

  it('reports IN_PROGRESS for the configured number of polls, then FINISHED', async () => {
    const port = createMockAdapter({ pollsBeforeFinished: 2 })
    const container = await port.createMediaContainer(input)
    expect(await port.getContainerStatus(container)).toBe('IN_PROGRESS')
    expect(await port.getContainerStatus(container)).toBe('IN_PROGRESS')
    expect(await port.getContainerStatus(container)).toBe('FINISHED')
  })

  it('reports ERROR when the script says the container fails', async () => {
    const port = createMockAdapter({ containerOutcome: 'ERROR' })
    const container = await port.createMediaContainer(input)
    expect(await port.getContainerStatus(container)).toBe('ERROR')
  })

  it('refuses to publish a container that is not finished', async () => {
    const port = createMockAdapter({ pollsBeforeFinished: 5 })
    const container = await port.createMediaContainer(input)
    await expect(port.publishContainer(container)).rejects.toThrow(InstagramError)
  })

  it('refuses to publish the same container twice', async () => {
    const port = createMockAdapter()
    const container = await port.createMediaContainer(input)
    await port.publishContainer(container)
    await expect(port.publishContainer(container)).rejects.toThrow(/already published/)
  })

  it('throws a retryable error when the script simulates a network drop on publish', async () => {
    const port = createMockAdapter({ failPublishWith: 'network' })
    const container = await port.createMediaContainer(input)
    await expect(port.publishContainer(container)).rejects.toMatchObject({ retryable: true })
  })

  it('throws a non-retryable error when the token is expired', async () => {
    const port = createMockAdapter({ failPublishWith: 'expired-token' })
    const container = await port.createMediaContainer(input)
    await expect(port.publishContainer(container)).rejects.toMatchObject({ retryable: false })
  })

  it('throws a retryable error when the daily quota is exhausted', async () => {
    const port = createMockAdapter({ dailyQuota: 0 })
    await expect(port.createMediaContainer(input)).rejects.toMatchObject({
      code: 'quota-exhausted',
      retryable: true,
    })
  })

  it('returns a stable account profile', async () => {
    const port = createMockAdapter()
    const account = await port.getAccount('any-token')
    expect(account).toEqual({ igUserId: 'mock-ig-user', username: 'mock_account' })
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `pnpm test:unit src/core/instagram/`
Expected: FAIL. No se resuelve `./mock-adapter`.

- [ ] **Step 3: Escribir el puerto**

Crea `src/core/instagram/port.ts`:

```ts
export type ContainerId = string
export type PublishedMediaId = string
export type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR'

export type MediaInput = {
  kind: 'image' | 'reel'
  mediaUrl: string
  caption: string
}

export type AccountProfile = {
  igUserId: string
  username: string
}

/**
 * The only surface through which the application may reach Instagram.
 * Nothing outside src/core/instagram may call graph.facebook.com directly.
 */
export interface InstagramPort {
  createMediaContainer(input: MediaInput): Promise<ContainerId>
  getContainerStatus(id: ContainerId): Promise<ContainerStatus>
  publishContainer(id: ContainerId): Promise<PublishedMediaId>
  getAccount(token: string): Promise<AccountProfile>
}

export class InstagramError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable: boolean) {
    super(message)
    this.name = 'InstagramError'
    this.code = code
    this.retryable = retryable
  }
}
```

- [ ] **Step 4: Escribir el adaptador simulado**

Crea `src/core/instagram/mock-adapter.ts`:

```ts
import {
  type AccountProfile,
  type ContainerId,
  type ContainerStatus,
  InstagramError,
  type InstagramPort,
  type MediaInput,
  type PublishedMediaId,
} from './port'

export type MockScript = {
  /** How many getContainerStatus calls report IN_PROGRESS before FINISHED. */
  pollsBeforeFinished?: number
  /** Terminal status the container reaches. Defaults to FINISHED. */
  containerOutcome?: 'FINISHED' | 'ERROR'
  /** Simulated failure raised by publishContainer. */
  failPublishWith?: 'network' | 'expired-token'
  /** Remaining publishes allowed in the rolling 24h window. */
  dailyQuota?: number
}

type ContainerRecord = {
  polls: number
  published: boolean
}

let counter = 0

function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

export function createMockAdapter(script: MockScript = {}): InstagramPort {
  const pollsBeforeFinished = script.pollsBeforeFinished ?? 0
  const containerOutcome = script.containerOutcome ?? 'FINISHED'
  const containers = new Map<ContainerId, ContainerRecord>()
  let quota = script.dailyQuota ?? 50

  function record(id: ContainerId): ContainerRecord {
    const found = containers.get(id)
    if (!found) {
      throw new InstagramError('unknown-container', `Unknown container ${id}`, false)
    }
    return found
  }

  return {
    async createMediaContainer(_input: MediaInput): Promise<ContainerId> {
      if (quota <= 0) {
        throw new InstagramError(
          'quota-exhausted',
          'Daily publishing quota exhausted for this account',
          true,
        )
      }
      const id = nextId('mock-container')
      containers.set(id, { polls: 0, published: false })
      return id
    },

    async getContainerStatus(id: ContainerId): Promise<ContainerStatus> {
      const container = record(id)
      if (container.polls < pollsBeforeFinished) {
        container.polls += 1
        return 'IN_PROGRESS'
      }
      return containerOutcome
    },

    async publishContainer(id: ContainerId): Promise<PublishedMediaId> {
      const container = record(id)
      if (container.published) {
        throw new InstagramError('already-published', `Container ${id} already published`, false)
      }
      if (container.polls < pollsBeforeFinished) {
        throw new InstagramError('not-finished', `Container ${id} is not finished`, true)
      }
      if (script.failPublishWith === 'network') {
        throw new InstagramError('network', 'Simulated network drop while publishing', true)
      }
      if (script.failPublishWith === 'expired-token') {
        throw new InstagramError('expired-token', 'The access token has expired', false)
      }
      container.published = true
      quota -= 1
      return nextId('mock-media')
    },

    async getAccount(_token: string): Promise<AccountProfile> {
      return { igUserId: 'mock-ig-user', username: 'mock_account' }
    },
  }
}
```

- [ ] **Step 5: Escribir el punto de composición**

Crea `src/core/instagram/index.ts`:

```ts
import { createMockAdapter } from './mock-adapter'
import type { InstagramPort } from './port'

export * from './port'

/**
 * Resolves the adapter from INSTAGRAM_ADAPTER. The graph adapter does not
 * exist yet — asking for it must fail loudly rather than silently mocking
 * real publishing.
 */
export function getInstagramPort(): InstagramPort {
  const choice = process.env.INSTAGRAM_ADAPTER ?? 'mock'
  if (choice === 'mock') return createMockAdapter()
  if (choice === 'graph') {
    throw new Error('INSTAGRAM_ADAPTER=graph is not implemented yet (Phase 2)')
  }
  throw new Error(`Unknown INSTAGRAM_ADAPTER: ${choice}`)
}
```

- [ ] **Step 6: Ejecutar los tests**

Run: `pnpm test:unit src/core/instagram/`
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add src/core/instagram
git commit -m "feat(instagram): add InstagramPort with a failure-simulating mock adapter"
```

---

### Task 3: Máquina de estados como función pura

**Files:**
- Create: `src/core/scheduling/state-machine.ts`
- Test: `src/core/scheduling/state-machine.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type PostState = 'borrador' | 'programado' | 'subiendo' | 'listo' | 'publicado' | 'fallido' | 'cancelado'`
  - `type PostEvent = 'schedule' | 'claim' | 'container-ready' | 'published' | 'fail' | 'retry' | 'cancel'`
  - `nextState(current: PostState, event: PostEvent): PostState` — lanza `Error` en una transición no permitida
  - `MAX_ATTEMPTS = 3`
  - `backoffMs(attempt: number): number`
  - Las consume la Tarea 5.

- [ ] **Step 1: Escribir el test que falla**

Crea `src/core/scheduling/state-machine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { backoffMs, MAX_ATTEMPTS, nextState } from './state-machine'

describe('nextState', () => {
  it('walks the happy path from borrador to publicado', () => {
    expect(nextState('borrador', 'schedule')).toBe('programado')
    expect(nextState('programado', 'claim')).toBe('subiendo')
    expect(nextState('subiendo', 'container-ready')).toBe('listo')
    expect(nextState('listo', 'published')).toBe('publicado')
  })

  it('moves to fallido from either working state', () => {
    expect(nextState('subiendo', 'fail')).toBe('fallido')
    expect(nextState('listo', 'fail')).toBe('fallido')
  })

  it('returns a failed post to the queue on retry', () => {
    expect(nextState('fallido', 'retry')).toBe('programado')
  })

  it('allows cancelling from borrador, programado and fallido', () => {
    expect(nextState('borrador', 'cancel')).toBe('cancelado')
    expect(nextState('programado', 'cancel')).toBe('cancelado')
    expect(nextState('fallido', 'cancel')).toBe('cancelado')
  })

  it('treats publicado as terminal', () => {
    expect(() => nextState('publicado', 'cancel')).toThrow(/publicado/)
    expect(() => nextState('publicado', 'retry')).toThrow(/publicado/)
  })

  it('treats cancelado as terminal', () => {
    expect(() => nextState('cancelado', 'claim')).toThrow(/cancelado/)
  })

  it('refuses to claim a post that is not scheduled', () => {
    expect(() => nextState('borrador', 'claim')).toThrow(/borrador/)
  })

  it('refuses to publish a post whose container is not ready', () => {
    expect(() => nextState('subiendo', 'published')).toThrow(/subiendo/)
  })
})

describe('backoffMs', () => {
  it('grows with each attempt', () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(2))
    expect(backoffMs(2)).toBeLessThan(backoffMs(3))
  })

  it('starts at one minute', () => {
    expect(backoffMs(1)).toBe(60_000)
  })

  it('caps at fifteen minutes', () => {
    expect(backoffMs(99)).toBe(900_000)
  })
})

describe('MAX_ATTEMPTS', () => {
  it('is three', () => {
    expect(MAX_ATTEMPTS).toBe(3)
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `pnpm test:unit src/core/scheduling/`
Expected: FAIL. No se resuelve `./state-machine`.

- [ ] **Step 3: Implementar**

Crea `src/core/scheduling/state-machine.ts`:

```ts
export type PostState =
  | 'borrador'
  | 'programado'
  | 'subiendo'
  | 'listo'
  | 'publicado'
  | 'fallido'
  | 'cancelado'

export type PostEvent =
  | 'schedule'
  | 'claim'
  | 'container-ready'
  | 'published'
  | 'fail'
  | 'retry'
  | 'cancel'

export const MAX_ATTEMPTS = 3

const BASE_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 900_000

const TRANSITIONS: Record<PostState, Partial<Record<PostEvent, PostState>>> = {
  borrador: { schedule: 'programado', cancel: 'cancelado' },
  programado: { claim: 'subiendo', cancel: 'cancelado' },
  subiendo: { 'container-ready': 'listo', fail: 'fallido' },
  listo: { published: 'publicado', fail: 'fallido' },
  publicado: {},
  fallido: { retry: 'programado', cancel: 'cancelado' },
  cancelado: {},
}

export function nextState(current: PostState, event: PostEvent): PostState {
  const target = TRANSITIONS[current][event]
  if (!target) {
    throw new Error(`Illegal transition: cannot apply "${event}" to a post in state "${current}"`)
  }
  return target
}

/** Exponential backoff, one minute doubling up to a fifteen minute ceiling. */
export function backoffMs(attempt: number): number {
  const grown = BASE_BACKOFF_MS * 2 ** (attempt - 1)
  return Math.min(grown, MAX_BACKOFF_MS)
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `pnpm test:unit src/core/scheduling/`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/scheduling
git commit -m "feat(scheduling): add the post state machine and retry backoff"
```

---

### Task 4: Toma de trabajo con SKIP LOCKED

**Files:**
- Create: `supabase/migrations/20260722000100_claim_due_posts.sql`
- Test: `tests/integration/claim-due-posts.test.ts`

**Interfaces:**
- Consumes: las tablas de la Tarea 1. El enum `post_state`.
- Produces: `public.claim_due_posts(batch_size integer, lock_seconds integer)` que devuelve filas `(id uuid, org_id uuid, ig_account_id uuid, kind public.post_kind, caption text, attempts integer)`. La consume la Tarea 5.

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/integration/claim-due-posts.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asAdmin, cleanupTestUsers, createTestUser } from './db'

let orgId: string
let accountId: string
let ownerId: string

async function seedPost(minutesFromNow: number): Promise<string> {
  return asAdmin(async (sql) => {
    const result = await sql.query<{ id: string }>(
      `insert into public.posts (org_id, ig_account_id, kind, caption, publish_at, state)
       values ($1, $2, 'image', 'x', now() + ($3 || ' minutes')::interval, 'programado')
       returning id`,
      [orgId, accountId, String(minutesFromNow)],
    )
    const id = result.rows[0]?.id
    if (!id) throw new Error('seed failed')
    return id
  })
}

beforeAll(async () => {
  ownerId = await createTestUser(`claim-${Date.now()}@example.test`)
  const seeded = await asAdmin(async (sql) => {
    const org = await sql.query<{ id: string }>(
      "insert into public.orgs (name) values ('Claim Org') returning id",
    )
    const oid = org.rows[0]?.id
    if (!oid) throw new Error('seed failed')
    await sql.query(
      "insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')",
      [oid, ownerId],
    )
    const account = await sql.query<{ id: string }>(
      `insert into public.ig_accounts (org_id, ig_user_id, username, encrypted_token, expires_at)
       values ($1, 'ig-claim', 'claim', 'cipher', now() + interval '60 days') returning id`,
      [oid],
    )
    const aid = account.rows[0]?.id
    if (!aid) throw new Error('seed failed')
    return { oid, aid }
  })
  orgId = seeded.oid
  accountId = seeded.aid
})

afterAll(async () => {
  await asAdmin(async (sql) => {
    await sql.query('delete from public.orgs where id = $1', [orgId])
  })
  await cleanupTestUsers()
})

describe('claim_due_posts', () => {
  it('claims a post whose publish_at has passed', async () => {
    const postId = await seedPost(-1)
    const claimed = await asAdmin(async (sql) => {
      const result = await sql.query<{ id: string }>(
        'select id from public.claim_due_posts(10, 60)',
      )
      return result.rows.map((row) => row.id)
    })
    expect(claimed).toContain(postId)
  })

  it('leaves a post whose publish_at is still in the future', async () => {
    const postId = await seedPost(30)
    const claimed = await asAdmin(async (sql) => {
      const result = await sql.query<{ id: string }>(
        'select id from public.claim_due_posts(10, 60)',
      )
      return result.rows.map((row) => row.id)
    })
    expect(claimed).not.toContain(postId)
  })

  it('moves a claimed post to subiendo and stamps locked_until', async () => {
    const postId = await seedPost(-1)
    await asAdmin((sql) => sql.query('select * from public.claim_due_posts(10, 60)'))
    const row = await asAdmin(async (sql) => {
      const result = await sql.query<{ state: string; locked_until: Date | null }>(
        'select state, locked_until from public.posts where id = $1',
        [postId],
      )
      return result.rows[0]
    })
    expect(row?.state).toBe('subiendo')
    expect(row?.locked_until).not.toBeNull()
  })

  it('does not hand the same post to two concurrent claimers', async () => {
    const postId = await seedPost(-1)

    const [first, second] = await Promise.all([
      asAdmin(async (sql) => {
        const result = await sql.query<{ id: string }>(
          'select id from public.claim_due_posts(10, 60)',
        )
        return result.rows.map((row) => row.id)
      }),
      asAdmin(async (sql) => {
        const result = await sql.query<{ id: string }>(
          'select id from public.claim_due_posts(10, 60)',
        )
        return result.rows.map((row) => row.id)
      }),
    ])

    const timesClaimed = [...first, ...second].filter((id) => id === postId).length
    expect(timesClaimed).toBe(1)
  })

  it('respects the batch size', async () => {
    await seedPost(-1)
    await seedPost(-1)
    await seedPost(-1)
    const claimed = await asAdmin(async (sql) => {
      const result = await sql.query('select id from public.claim_due_posts(2, 60)')
      return result.rowCount
    })
    expect(claimed).toBe(2)
  })

  it('reclaims a post whose lock has expired', async () => {
    const postId = await seedPost(-1)
    await asAdmin((sql) => sql.query('select * from public.claim_due_posts(10, 60)'))
    await asAdmin((sql) =>
      sql.query(
        "update public.posts set state = 'programado', locked_until = now() - interval '1 minute' where id = $1",
        [postId],
      ),
    )
    const claimed = await asAdmin(async (sql) => {
      const result = await sql.query<{ id: string }>(
        'select id from public.claim_due_posts(10, 60)',
      )
      return result.rows.map((row) => row.id)
    })
    expect(claimed).toContain(postId)
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `pnpm test:unit tests/integration/claim-due-posts.test.ts`
Expected: FAIL. `function public.claim_due_posts(integer, integer) does not exist`.

- [ ] **Step 3: Escribir la migración**

Crea `supabase/migrations/20260722000100_claim_due_posts.sql`:

```sql
create function public.claim_due_posts(batch_size integer, lock_seconds integer)
returns table (
  id            uuid,
  org_id        uuid,
  ig_account_id uuid,
  kind          public.post_kind,
  caption       text,
  attempts      integer
)
language sql
security definer
set search_path = public
as $$
  with due as (
    select p.id
    from public.posts p
    where p.state = 'programado'
      and p.publish_at <= now()
      and (p.locked_until is null or p.locked_until < now())
    order by p.publish_at
    limit batch_size
    -- SKIP LOCKED impide que dos ejecuciones solapadas del cron tomen el
    -- mismo post: la segunda simplemente no lo ve.
    for update skip locked
  )
  update public.posts p
  set state = 'subiendo',
      locked_until = now() + (lock_seconds || ' seconds')::interval,
      updated_at = now()
  from due
  where p.id = due.id
  returning p.id, p.org_id, p.ig_account_id, p.kind, p.caption, p.attempts;
$$;

revoke all on function public.claim_due_posts(integer, integer) from public, anon, authenticated;
```

Nadie salvo `service_role` y `postgres` puede llamarla: la cola es trabajo de servidor, no una operación de usuario.

- [ ] **Step 4: Aplicar y ejecutar**

```bash
pnpm db:reset
pnpm test:unit tests/integration/claim-due-posts.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase tests
git commit -m "feat(scheduling): claim due posts with FOR UPDATE SKIP LOCKED"
```

---

### Task 5: El worker de publicación

**Files:**
- Create: `src/core/scheduling/worker.ts`
- Test: `tests/integration/worker.test.ts`

**Interfaces:**
- Consumes: `claim_due_posts` de la Tarea 4. `InstagramPort`, `InstagramError` de la Tarea 2. `nextState`, `MAX_ATTEMPTS`, `backoffMs` de la Tarea 3.
- Produces: `runPublishCycle(deps: WorkerDeps): Promise<CycleReport>`, donde `WorkerDeps = { sql: PoolClient; port: InstagramPort; batchSize?: number }` y `CycleReport = { claimed: number; published: number; failed: number }`. La consume la Tarea 6.

Esta es la tarea donde vive la idempotencia. El orden de las operaciones no es negociable: **el `container_id` se persiste antes de publicar**, y todo reintento comprueba primero si ese contenedor ya produjo un `ig_media_id`.

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/integration/worker.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMockAdapter } from '@/core/instagram/mock-adapter'
import { runPublishCycle } from '@/core/scheduling/worker'
import { asAdmin, cleanupTestUsers, createTestUser } from './db'

let orgId: string
let accountId: string
let ownerId: string

async function seedDuePost(): Promise<string> {
  return asAdmin(async (sql) => {
    const result = await sql.query<{ id: string }>(
      `insert into public.posts (org_id, ig_account_id, kind, caption, publish_at, state)
       values ($1, $2, 'image', 'hola', now() - interval '1 minute', 'programado')
       returning id`,
      [orgId, accountId],
    )
    const id = result.rows[0]?.id
    if (!id) throw new Error('seed failed')
    return id
  })
}

async function readPost(postId: string) {
  return asAdmin(async (sql) => {
    const result = await sql.query<{
      state: string
      container_id: string | null
      ig_media_id: string | null
      attempts: number
      last_error: string | null
    }>(
      'select state, container_id, ig_media_id, attempts, last_error from public.posts where id = $1',
      [postId],
    )
    return result.rows[0]
  })
}

beforeAll(async () => {
  ownerId = await createTestUser(`worker-${Date.now()}@example.test`)
  const seeded = await asAdmin(async (sql) => {
    const org = await sql.query<{ id: string }>(
      "insert into public.orgs (name) values ('Worker Org') returning id",
    )
    const oid = org.rows[0]?.id
    if (!oid) throw new Error('seed failed')
    await sql.query(
      "insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')",
      [oid, ownerId],
    )
    const account = await sql.query<{ id: string }>(
      `insert into public.ig_accounts (org_id, ig_user_id, username, encrypted_token, expires_at)
       values ($1, 'ig-worker', 'worker', 'cipher', now() + interval '60 days') returning id`,
      [oid],
    )
    const aid = account.rows[0]?.id
    if (!aid) throw new Error('seed failed')
    return { oid, aid }
  })
  orgId = seeded.oid
  accountId = seeded.aid
})

afterAll(async () => {
  await asAdmin(async (sql) => {
    await sql.query('delete from public.orgs where id = $1', [orgId])
  })
  await cleanupTestUsers()
})

describe('runPublishCycle', () => {
  it('publishes a due post end to end', async () => {
    const postId = await seedDuePost()
    const report = await asAdmin((sql) =>
      runPublishCycle({ sql, port: createMockAdapter() }),
    )

    expect(report.published).toBe(1)
    const post = await readPost(postId)
    expect(post?.state).toBe('publicado')
    expect(post?.ig_media_id).toMatch(/^mock-media-/)
    expect(post?.container_id).toMatch(/^mock-container-/)
  })

  it('records an attempt row for every cycle it touches a post', async () => {
    const postId = await seedDuePost()
    await asAdmin((sql) => runPublishCycle({ sql, port: createMockAdapter() }))
    const attempts = await asAdmin(async (sql) => {
      const result = await sql.query('select id from public.publish_attempts where post_id = $1', [
        postId,
      ])
      return result.rowCount
    })
    expect(attempts).toBeGreaterThan(0)
  })

  it('returns a still-processing container to the queue instead of stranding it', async () => {
    const postId = await seedDuePost()
    await asAdmin((sql) =>
      runPublishCycle({ sql, port: createMockAdapter({ pollsBeforeFinished: 99 }) }),
    )
    const post = await readPost(postId)
    // Back to `programado`, not parked in `subiendo`: claim_due_posts only
    // sees `programado`, so anything left in `subiendo` is never polled again.
    expect(post?.state).toBe('programado')
    expect(post?.container_id).not.toBeNull()
    expect(post?.attempts).toBe(0)
  })

  it('reuses the stored container when it polls again on a later cycle', async () => {
    const postId = await seedDuePost()
    await asAdmin((sql) =>
      runPublishCycle({ sql, port: createMockAdapter({ pollsBeforeFinished: 99 }) }),
    )
    const firstPass = await readPost(postId)

    await asAdmin((sql) =>
      sql.query("update public.posts set publish_at = now() - interval '1 minute' where id = $1", [
        postId,
      ]),
    )
    await asAdmin((sql) => runPublishCycle({ sql, port: createMockAdapter() }))

    const secondPass = await readPost(postId)
    expect(secondPass?.container_id).toBe(firstPass?.container_id)
    expect(secondPass?.state).toBe('publicado')
  })

  it('does not publish twice when the network drops after the container is created', async () => {
    const postId = await seedDuePost()

    // First cycle: the container is created, then publishing "drops".
    await asAdmin((sql) =>
      runPublishCycle({ sql, port: createMockAdapter({ failPublishWith: 'network' }) }),
    )

    const afterDrop = await readPost(postId)
    expect(afterDrop?.container_id).not.toBeNull()
    expect(afterDrop?.ig_media_id).toBeNull()

    // Second cycle with a healthy port: it must reuse the stored container,
    // not create a second one.
    await asAdmin((sql) =>
      sql.query("update public.posts set state = 'programado', locked_until = null where id = $1", [
        postId,
      ]),
    )
    await asAdmin((sql) => runPublishCycle({ sql, port: createMockAdapter() }))

    const afterRetry = await readPost(postId)
    expect(afterRetry?.container_id).toBe(afterDrop?.container_id)
    expect(afterRetry?.state).toBe('publicado')
  })

  it('never republishes a post that already has an ig_media_id', async () => {
    const postId = await seedDuePost()
    await asAdmin((sql) => runPublishCycle({ sql, port: createMockAdapter() }))
    const first = await readPost(postId)

    await asAdmin((sql) =>
      sql.query("update public.posts set state = 'programado', locked_until = null where id = $1", [
        postId,
      ]),
    )
    await asAdmin((sql) => runPublishCycle({ sql, port: createMockAdapter() }))

    const second = await readPost(postId)
    expect(second?.ig_media_id).toBe(first?.ig_media_id)
    expect(second?.state).toBe('publicado')
  })

  it('fails a post immediately on a non-retryable error', async () => {
    const postId = await seedDuePost()
    await asAdmin((sql) =>
      runPublishCycle({ sql, port: createMockAdapter({ failPublishWith: 'expired-token' }) }),
    )
    const post = await readPost(postId)
    expect(post?.state).toBe('fallido')
    expect(post?.last_error).toMatch(/expired-token/)
  })

  it('gives up after MAX_ATTEMPTS retryable failures', async () => {
    const postId = await seedDuePost()

    for (let cycle = 0; cycle < 4; cycle += 1) {
      await asAdmin((sql) =>
        sql.query(
          "update public.posts set state = 'programado', locked_until = null where id = $1 and state <> 'fallido'",
          [postId],
        ),
      )
      await asAdmin((sql) =>
        runPublishCycle({ sql, port: createMockAdapter({ containerOutcome: 'ERROR' }) }),
      )
    }

    const post = await readPost(postId)
    expect(post?.state).toBe('fallido')
    expect(post?.attempts).toBeGreaterThanOrEqual(3)
  })

  it('reports zero work when nothing is due', async () => {
    const report = await asAdmin((sql) =>
      runPublishCycle({ sql, port: createMockAdapter() }),
    )
    expect(report.claimed).toBe(0)
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `pnpm test:unit tests/integration/worker.test.ts`
Expected: FAIL. No se resuelve `@/core/scheduling/worker`.

- [ ] **Step 3: Implementar el worker**

Crea `src/core/scheduling/worker.ts`:

```ts
import type { PoolClient } from 'pg'
import { InstagramError, type InstagramPort } from '@/core/instagram/port'
import { backoffMs, MAX_ATTEMPTS } from './state-machine'

export type WorkerDeps = {
  sql: PoolClient
  port: InstagramPort
  batchSize?: number
}

export type CycleReport = {
  claimed: number
  published: number
  failed: number
}

type ClaimedPost = {
  id: string
  kind: 'image' | 'reel' | 'carousel'
  caption: string
  attempts: number
}

type StoredPost = {
  container_id: string | null
  ig_media_id: string | null
}

const LOCK_SECONDS = 300
const DEFAULT_BATCH = 10

async function recordAttempt(
  sql: PoolClient,
  postId: string,
  attempt: number,
  response: unknown,
): Promise<void> {
  await sql.query(
    'insert into public.publish_attempts (post_id, attempt, response) values ($1, $2, $3)',
    [postId, attempt, JSON.stringify(response)],
  )
}

async function markFailed(
  sql: PoolClient,
  postId: string,
  attempts: number,
  message: string,
): Promise<void> {
  await sql.query(
    `update public.posts
     set state = 'fallido', attempts = $2, last_error = $3, locked_until = null, updated_at = now()
     where id = $1`,
    [postId, attempts, message],
  )
}

async function rescheduleRetry(
  sql: PoolClient,
  postId: string,
  attempts: number,
  message: string,
): Promise<void> {
  await sql.query(
    `update public.posts
     set state = 'programado',
         attempts = $2,
         last_error = $3,
         publish_at = now() + ($4 || ' milliseconds')::interval,
         locked_until = null,
         updated_at = now()
     where id = $1`,
    [postId, attempts, message, String(backoffMs(attempts))],
  )
}

async function handleFailure(
  sql: PoolClient,
  post: ClaimedPost,
  error: unknown,
): Promise<'failed' | 'retrying'> {
  const attempts = post.attempts + 1
  const retryable = error instanceof InstagramError ? error.retryable : true
  const code = error instanceof InstagramError ? error.code : 'unknown'
  const message = `${code}: ${error instanceof Error ? error.message : String(error)}`

  await recordAttempt(sql, post.id, attempts, { error: message })

  if (!retryable || attempts >= MAX_ATTEMPTS) {
    await markFailed(sql, post.id, attempts, message)
    return 'failed'
  }
  await rescheduleRetry(sql, post.id, attempts, message)
  return 'retrying'
}

/**
 * Publishes one batch of due posts.
 *
 * The ordering here is the whole point: the container id is persisted before
 * any publish is attempted, and a post that already carries an ig_media_id is
 * never published again. Without both, a network drop between creating the
 * container and publishing it posts twice to a customer's account.
 */
export async function runPublishCycle(deps: WorkerDeps): Promise<CycleReport> {
  const { sql, port } = deps
  const batchSize = deps.batchSize ?? DEFAULT_BATCH

  const claimedResult = await sql.query<ClaimedPost>(
    'select id, kind, caption, attempts from public.claim_due_posts($1, $2)',
    [batchSize, LOCK_SECONDS],
  )
  const claimed = claimedResult.rows

  let published = 0
  let failed = 0

  for (const post of claimed) {
    try {
      const storedResult = await sql.query<StoredPost>(
        'select container_id, ig_media_id from public.posts where id = $1',
        [post.id],
      )
      const stored = storedResult.rows[0]

      // Already published in an earlier cycle whose result never got written
      // back. Reconcile instead of publishing again.
      if (stored?.ig_media_id) {
        await sql.query(
          "update public.posts set state = 'publicado', locked_until = null, updated_at = now() where id = $1",
          [post.id],
        )
        published += 1
        continue
      }

      if (post.kind === 'carousel') {
        throw new InstagramError('unsupported-kind', 'Carousels arrive in Phase 1b', false)
      }

      let containerId = stored?.container_id ?? null

      if (!containerId) {
        containerId = await port.createMediaContainer({
          kind: post.kind,
          mediaUrl: 'https://example.invalid/pending-media',
          caption: post.caption,
        })
        // Persisted before any publish attempt. This is the idempotency anchor.
        await sql.query(
          'update public.posts set container_id = $2, updated_at = now() where id = $1',
          [post.id, containerId],
        )
      }

      const status = await port.getContainerStatus(containerId)

      if (status === 'IN_PROGRESS') {
        // Hand it back to the queue rather than leaving it in `subiendo`:
        // claim_due_posts only picks up `programado`, so a post parked in
        // `subiendo` would never be polled again. The container id stays, so
        // the next cycle resumes instead of creating a second container.
        // This is a poll, not a failure — `attempts` is deliberately untouched.
        await sql.query(
          `update public.posts
           set state = 'programado',
               publish_at = now() + interval '30 seconds',
               locked_until = null,
               updated_at = now()
           where id = $1`,
          [post.id],
        )
        continue
      }

      if (status === 'ERROR') {
        throw new InstagramError('container-error', 'The media container failed to process', true)
      }

      await sql.query(
        "update public.posts set state = 'listo', updated_at = now() where id = $1",
        [post.id],
      )

      const mediaId = await port.publishContainer(containerId)

      await sql.query(
        `update public.posts
         set state = 'publicado', ig_media_id = $2, locked_until = null, updated_at = now()
         where id = $1`,
        [post.id, mediaId],
      )
      await recordAttempt(sql, post.id, post.attempts + 1, { mediaId })
      published += 1
    } catch (error) {
      const outcome = await handleFailure(sql, post, error)
      if (outcome === 'failed') failed += 1
    }
  }

  return { claimed: claimed.length, published, failed }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `pnpm test:unit tests/integration/worker.test.ts`
Expected: PASS, 9 tests.

El test de la doble publicación es el que importa. Si falla, no toques el test: el orden de las escrituras del worker es lo que está mal.

- [ ] **Step 5: Ejecutar la suite completa**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit`
Expected: sin errores, todo en verde.

- [ ] **Step 6: Commit**

```bash
git add src/core/scheduling tests/integration/worker.test.ts
git commit -m "feat(scheduling): add the publish worker with container-based idempotency"
```

---

### Task 6: Endpoint de cron

**Files:**
- Create: `src/app/api/cron/publish/route.ts`
- Create: `vercel.json`
- Modify: `.env.example`
- Test: `src/app/api/cron/publish/route.test.ts`

**Interfaces:**
- Consumes: `runPublishCycle` de la Tarea 5. `getInstagramPort` de la Tarea 2. `getRequiredEnv` de `@/lib/env`.
- Produces: `GET /api/cron/publish`, protegido por cabecera `Authorization: Bearer <CRON_SECRET>`. Responde `200` con el `CycleReport` en JSON, o `401` sin credencial válida.

- [ ] **Step 1: Escribir el test que falla**

Crea `src/app/api/cron/publish/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isAuthorized } from './route'

const SECRET = 'test-cron-secret'

beforeEach(() => {
  process.env.CRON_SECRET = SECRET
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

function requestWith(header: string | null): Request {
  const headers = new Headers()
  if (header !== null) headers.set('authorization', header)
  return new Request('http://localhost/api/cron/publish', { headers })
}

describe('isAuthorized', () => {
  it('accepts the configured bearer token', () => {
    expect(isAuthorized(requestWith(`Bearer ${SECRET}`))).toBe(true)
  })

  it('rejects a missing header', () => {
    expect(isAuthorized(requestWith(null))).toBe(false)
  })

  it('rejects a wrong token', () => {
    expect(isAuthorized(requestWith('Bearer nope'))).toBe(false)
  })

  it('rejects the right token without the Bearer scheme', () => {
    expect(isAuthorized(requestWith(SECRET))).toBe(false)
  })

  it('rejects a token that is a prefix of the secret', () => {
    expect(isAuthorized(requestWith(`Bearer ${SECRET.slice(0, -1)}`))).toBe(false)
  })

  it('throws when CRON_SECRET is not configured, rather than allowing the request', () => {
    delete process.env.CRON_SECRET
    expect(() => isAuthorized(requestWith('Bearer anything'))).toThrow(/CRON_SECRET/)
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `pnpm test:unit src/app/api/`
Expected: FAIL. No se resuelve `./route`.

- [ ] **Step 3: Implementar el route handler**

Crea `src/app/api/cron/publish/route.ts`:

```ts
import { timingSafeEqual } from 'node:crypto'
import { Pool } from 'pg'
import { getInstagramPort } from '@/core/instagram'
import { runPublishCycle } from '@/core/scheduling/worker'
import { getRequiredEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getRequiredEnv('SUPABASE_DB_URL') })
  }
  return pool
}

/**
 * Compares the bearer token in constant time. A missing CRON_SECRET throws
 * rather than defaulting to open — an unprotected endpoint that publishes to
 * customer accounts is worse than a broken one.
 */
export function isAuthorized(request: Request): boolean {
  const secret = getRequiredEnv('CRON_SECRET')
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return false

  const provided = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(secret)
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const client = await getPool().connect()
  try {
    const report = await runPublishCycle({ sql: client, port: getInstagramPort() })
    return Response.json(report)
  } finally {
    client.release()
  }
}
```

- [ ] **Step 4: Declarar el cron**

Crea `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/publish", "schedule": "* * * * *" }]
}
```

- [ ] **Step 5: Documentar las variables**

Añade a `.env.example`:

```
SUPABASE_DB_URL=
CRON_SECRET=
INSTAGRAM_ADAPTER=mock
```

Y a `.env.local`, para desarrollo, la URL de Postgres local y un secreto cualquiera. Recuerda que `.env.local` está en `.gitignore`.

- [ ] **Step 6: Ejecutar los tests**

Run: `pnpm test:unit src/app/api/`
Expected: PASS, 6 tests.

- [ ] **Step 7: Comprobación manual del ciclo completo**

```bash
pnpm dev --port 3100
```

En otra terminal, con un post programado en el pasado ya sembrado en la base de datos:

```bash
curl -s -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)" \
  http://localhost:3100/api/cron/publish
```

Expected: un JSON como `{"claimed":1,"published":1,"failed":0}`. Sin la cabecera, `{"error":"unauthorized"}` con estado 401.

- [ ] **Step 8: Verificación final y commit**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e`
Expected: todo en verde.

```bash
git add -A
git commit -m "feat(scheduling): expose the publish cycle as a protected cron endpoint"
```

---

## Criterios de aceptación de la Fase 1a-1

- [ ] Un post `programado` cuya hora ya pasó llega a `publicado` en un ciclo, contra `MockAdapter`.
- [ ] Dos ejecuciones concurrentes de la cola nunca toman el mismo post.
- [ ] Un fallo de red simulado entre crear el contenedor y publicarlo **no** produce dos publicaciones: el segundo ciclo reutiliza el `container_id` guardado.
- [ ] Un post que ya tiene `ig_media_id` nunca se vuelve a publicar.
- [ ] Un error no reintentable falla el post de inmediato; uno reintentable lo hace tras 3 intentos, con espera creciente.
- [ ] Un contenedor que sigue procesándose devuelve el post a `programado` con su `container_id` intacto, sin marcarlo como fallido ni gastar un intento — y el ciclo siguiente lo retoma en lugar de crear un segundo contenedor.
- [ ] Toda tabla nueva tiene RLS y una prueba que confirma que la organización B no ve los datos de la A.
- [ ] El token cifrado no es legible ni por los miembros de la organización.
- [ ] El endpoint de cron rechaza una petición sin el secreto correcto.
- [ ] `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e` pasa en local y en CI.

## Lo que este plan deja preparado y no resuelve

- **La URL del medio.** El worker envía un `mediaUrl` de marcador. Conectarlo a Supabase Storage con URL firmada es trabajo del plan hermano, que introduce la subida real desde el composer.
- **La cuota diaria.** `MockAdapter` la simula, pero nada comprueba todavía la cuota real antes de encolar. Entra con `GraphAdapter`, en la Fase 2.
- **El cifrado del token.** La columna se llama `encrypted_token` y nadie salvo el servidor la lee, pero el cifrado en sí llega con OAuth, en la Fase 2. Hasta entonces solo hay datos de prueba.
