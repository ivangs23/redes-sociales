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
