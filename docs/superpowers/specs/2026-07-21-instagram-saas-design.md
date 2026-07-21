# Diseño: SaaS de gestión de Instagram

**Fecha:** 2026-07-21
**Estado:** aprobado, pendiente de plan de implementación
**Autor:** Iván González Suárez

> Repositorio propio del producto, independiente de `suarex-website`.

---

## 1. Contexto y decisiones de producto

Herramienta SaaS pública para programar y publicar contenido en Instagram, con
analítica e inbox en fases posteriores.

| Decisión | Valor |
|---|---|
| Modelo | SaaS público, los clientes se registran |
| Propuesta de valor | Precio bajo y simplicidad, en español, para pequeños negocios y freelancers |
| Competencia | Metricool, Later, Buffer, Hootsuite |
| Stack | Next.js 16 (App Router) + Supabase + Vercel |
| Recursos | Una persona, a tiempo parcial |
| Cobro | Fuera del MVP. Stripe llega en la Fase 4 |
| Estado en Meta | Nada creado a fecha de hoy |

### Restricciones de la plataforma Meta

Condicionan el diseño entero y no son negociables:

- No existe una API que cubra "todas las herramientas de Instagram". Meta expone
  **Instagram Graph API** (publicación, comentarios, insights) y **Messenger API
  for Instagram** (mensajes directos).
- Requiere cuenta Business o Creator, una App de Meta, verificación de empresa y
  App Review para permisos de producción.
- **Sin API:** Stories interactivas completas, seguir y dejar de seguir, likes de
  terceros, búsqueda ilimitada de hashtags.
- El scraping o la automatización no oficial provocan el baneo de la cuenta del
  cliente. Queda descartado de forma permanente.
- Límite aproximado de 50 publicaciones por cuenta cada 24 horas.

### Elección del método de login (a verificar antes del plan)

Meta ofrece dos caminos:

1. **Facebook Login clásico** — exige que el cliente tenga una Página de Facebook
   vinculada a su cuenta de Instagram.
2. **Instagram API with Instagram Login** — el cliente entra con su usuario de
   Instagram, sin Página.

Se elige el segundo por la menor fricción de onboarding. **Acción previa al plan:**
verificar contra la documentación vigente de Meta qué permisos de publicación,
insights y mensajería soporta este camino, y si cubre las Fases 2, 3 y 5. Si no
cubre alguna, se revisa esta decisión antes de escribir código de OAuth.

---

## 2. Arquitectura

Repositorio nuevo, independiente de `suarex-website`.

```
apps/web            Next.js 16 App Router
  app/(marketing)   público
  app/(app)         dashboard, protegido
  app/api/webhooks  Meta, y Stripe en fase futura
core/
  instagram/        InstagramPort + MockAdapter + GraphAdapter
  scheduling/       cola, reintentos, ventanas horarias
  media/            subida, validación, transcodificado
  accounts/         OAuth, custodia de tokens, refresco
db/                 migraciones Supabase (SQL declarativo)
```

### Regla arquitectónica principal

**Ninguna llamada a `graph.facebook.com` fuera de `core/instagram/`.** El resto de
la aplicación habla con `InstagramPort`, nunca con Meta directamente.

Esto sostiene dos propiedades:

- El desarrollo avanza sin App de Meta aprobada, usando `MockAdapter`.
- Un cambio de la API de Meta queda contenido en un directorio.

```ts
interface InstagramPort {
  createMediaContainer(input: MediaInput): Promise<ContainerId>
  getContainerStatus(id: ContainerId): Promise<ContainerStatus>
  publishContainer(id: ContainerId): Promise<PublishedMediaId>
  getAccount(token: AccessToken): Promise<AccountProfile>
}

type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR'
```

La selección de implementación se hace por variable de entorno
(`INSTAGRAM_ADAPTER=mock|graph`), resuelta en un único punto de composición.

### Multitenancy

Una organización por cliente. Toda tabla de datos lleva `org_id` y una política
RLS de Supabase que filtra por la pertenencia del usuario autenticado.

La RLS es la frontera de seguridad real: un fallo en el código de la aplicación no
debe poder exponer datos de otra organización.

### Custodia de tokens

- Los tokens de acceso de Instagram **nunca** llegan al navegador.
- Se guardan cifrados, en una tabla sin políticas de lectura para el rol
  `authenticated`. Solo el código de servidor los descifra.
- Los tokens de larga duración de Meta caducan a los 60 días. Una tarea programada
  los refresca a los 50 días y avisa al usuario si el refresco falla.

---

## 3. Modelo de datos

Todas las tablas llevan `org_id` y RLS.

```
orgs              id, nombre, plan
memberships       org_id, user_id, rol
ig_accounts       org_id, ig_user_id, username, token_cifrado, expira_en
media_assets      org_id, ruta_storage, tipo, ancho, alto, duracion, estado
posts             org_id, ig_account_id, tipo, caption, publicar_en,
                  estado, container_id, ig_media_id, intentos, ultimo_error
post_assets       post_id, media_asset_id, orden
publish_attempts  post_id, intento, request, response, creado_en
```

`posts.tipo` ∈ `image | reel | carousel`.

`publish_attempts` es obligatoria, no opcional: es la única fuente de verdad para
diagnosticar un fallo de publicación ocurrido de madrugada en la cuenta de un
cliente.

### Máquina de estados del post

```
borrador → programado → subiendo → listo → publicado
                            ↓        ↓
                          fallido ← fallido → cancelado
```

`cancelado` es alcanzable desde `borrador`, `programado` y `fallido`. Un post
`publicado` es terminal.

---

## 4. Flujo de publicación

Publicar en Instagram son dos operaciones, no una:

1. El medio debe estar accesible en una **URL pública** que los servidores de Meta
   puedan descargar. Se sirve desde Supabase Storage mediante URL firmada de vida
   corta.
2. `createMediaContainer` devuelve un `container_id`, que **se persiste antes de
   continuar**.
3. Los vídeos y reels se procesan de forma asíncrona. Se sondea
   `getContainerStatus` hasta `FINISHED`. Puede tardar minutos.
4. `publishContainer` devuelve el `ig_media_id` definitivo.

### Idempotencia

**El paso 4 no es idempotente.** Reintentarlo a ciegas tras un fallo de red publica
el post dos veces en la cuenta del cliente.

Mitigación, ya reflejada en el modelo de datos:

- `container_id` se persiste antes de invocar la publicación.
- Todo reintento comprueba primero si ese contenedor ya produjo un `ig_media_id`.
- Un post con `ig_media_id` no vacío nunca se vuelve a publicar.

### Cola

- Vercel Cron dispara cada minuto.
- La toma de trabajo usa `SELECT ... FOR UPDATE SKIP LOCKED`, que impide que dos
  ejecuciones solapadas procesen el mismo post.
- Reintentos con espera creciente, máximo 3. Agotados, el post pasa a `fallido` y
  se notifica al usuario.
- La cuota diaria de la cuenta (aprox. 50 publicaciones / 24 h) se comprueba antes
  de encolar, no después de que Meta rechace.

### Carruseles

Cada imagen genera su propio contenedor hijo y después un contenedor padre que los
agrupa. Por su mayor número de partes móviles se aplaza a la Fase 1b, una vez que
imagen y reel funcionan por separado.

---

## 5. Interfaz del MVP

Cinco pantallas:

1. **Conectar cuenta** — OAuth con Instagram, perfil vinculado, estado del token.
2. **Composer** — subida de medio, caption, cuenta, fecha y hora. Previsualización
   fiel al feed. Validación previa al guardado: proporción, duración, tamaño y
   longitud del caption. Fallar aquí es barato; fallar dentro de Meta es opaco.
3. **Calendario** — vistas mensual y semanal, arrastrar para reprogramar, color por
   estado.
4. **Cola e historial** — estado, error legible y reintento. Es la pantalla de
   soporte del producto.
5. **Ajustes** — organización, miembros, zona horaria.

### Zonas horarias

Todo instante se almacena en UTC y se presenta en la zona horaria del cliente. Es
la fuente de errores más común en un programador de publicaciones y se fija desde
la primera migración.

### Errores

Meta devuelve códigos crípticos. Una tabla de traducción convierte cada código
conocido en un mensaje accionable en español con una acción sugerida. Los códigos
desconocidos se muestran con su valor original y se registran para incorporarlos.

### Diseño visual

Tailwind y shadcn/ui. Sin sistema de diseño propio en la Fase 1.

---

## 6. Estrategia de pruebas

`MockAdapter` es el entorno de desarrollo completo mientras Meta no apruebe la App.
Por tanto debe simular los fallos reales, no solo el camino feliz:

- Contenedor en `IN_PROGRESS` durante varios sondeos antes de terminar.
- Contenedor que termina en `ERROR` sin explicación útil.
- Token caducado a mitad de operación.
- Cuota diaria agotada.
- Corte de red entre crear el contenedor y publicarlo (caso de doble publicación).

### Niveles

- **Unitarias (Vitest)** — máquina de estados, ventanas horarias, validación de
  medios, traducción de errores. Sin red.
- **Integración** — cola completa contra Postgres local de Supabase con
  `MockAdapter`. Cubre `SKIP LOCKED` bajo concurrencia y la idempotencia de los
  reintentos.
- **E2E (Playwright)** — un único camino: conectar cuenta, componer, programar,
  verificar publicado.
- **Contrato** — conjunto reducido ejecutado manualmente contra la API real de Meta
  con una cuenta de pruebas. Detecta la deriva entre `GraphAdapter` y
  `MockAdapter`. Sin estas pruebas, el mock acaba mintiendo.

### Pruebas de RLS

Cada tabla con `org_id` necesita una prueba que confirme que un usuario de la
organización A no puede leer filas de la organización B.

---

## 7. Fases

Antes de escribir código, y en paralelo a él: crear la App de Meta, iniciar la
verificación de empresa y preparar una cuenta Instagram Business de pruebas. Son
trámites con plazos ajenos que condicionan el lanzamiento.

| Fase | Contenido | Bloqueada por Meta |
|---|---|---|
| 0 | Repo, Supabase, auth, orgs, RLS y sus pruebas | No |
| 1a | `InstagramPort` + `MockAdapter`, cola, composer, calendario. Imagen y reel | No |
| 1b | Carruseles, tratamiento de errores ampliado | No |
| 2 | `GraphAdapter` real, OAuth, pruebas de contrato | Sí — App Review de publicación |
| 3 | Analítica: insights de cuenta y post, informes | Sí — permisos de lectura |
| 4 | Stripe, planes, límites por plan | No |
| 5 | Inbox de mensajes directos y comentarios, webhooks | Sí — permisos más restrictivos |

Las Fases 0 y 1 concentran la mayor parte del trabajo y no dependen de Meta. La
Fase 2 consiste en conectar un adaptador ya diseñado, no en reescribir la
aplicación.

---

## 8. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Meta rechaza el App Review | Alta | Preparar el vídeo de demostración y el caso de uso con antelación. Solicitar los permisos mínimos |
| Doble publicación en la cuenta de un cliente | Media | Idempotencia por `container_id`, incorporada al modelo de datos |
| Cambio de la API de Meta | Media | El adaptador confina el impacto a `core/instagram/` |
| La Fase 1 se alarga por trabajar a tiempo parcial | Alta | La Fase 1a es deliberadamente mínima: una cuenta, un medio, un post |
| Filtración de datos entre organizaciones | Baja / impacto crítico | RLS más pruebas dedicadas por tabla |

---

## 9. Fuera de alcance

Declarado de forma explícita para evitar la expansión silenciosa:

- Stories.
- TikTok y cualquier otra red social.
- Edición de vídeo dentro del producto.
- Bandeja de equipo con asignación y flujos de aprobación.
- Aplicación móvil nativa.

---

## 10. Criterios de éxito de la Fase 1

- Un usuario crea su organización, entra y ve un estado vacío coherente.
- Programa un post con imagen y otro con reel, y ambos alcanzan el estado
  `publicado` contra `MockAdapter`.
- Un fallo simulado de red entre contenedor y publicación **no** produce dos
  publicaciones.
- La suite de RLS pasa para todas las tablas con `org_id`.
- El calendario refleja las horas en la zona horaria del usuario, con los datos
  almacenados en UTC.
