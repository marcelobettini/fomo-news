# Data Model: Endpoint público de solo lectura de noticias del día

## Reutilización del modelo de la feature 1

Este feature **no redeclara** el modelo de noticia. Lee la misma colección `news` que escribe
el ingestor y reutiliza el tipo `NewsDocument` ya definido en
[`src/adapters/repository.ts`](../../src/adapters/repository.ts) (feature 1):

| Campo | Tipo | Origen |
|---|---|---|
| `_id` | string (enlace) | feature 1 |
| `title` | string | feature 1 |
| `summary` | string | feature 1 |
| `link` | string | feature 1 |
| `category` | string | feature 1 |
| `publishedAt` | Date (UTC) | feature 1 |
| `updatedAt` | Date (UTC) | feature 1 |
| `firstSeenAt` | Date (UTC) | feature 1 |
| `expiresAt` | Date (UTC) | feature 1 |

Como el ingestor solo escribe en `news` las entradas que ya pasaron el filtro de
`TARGET_CATEGORY` (feature 1, `executeRun`), este feature **no necesita volver a filtrar por
categoría**: toda noticia en `news` ya pertenece a la categoría configurada. Esto es una
invariante heredada de la feature 1, documentada aquí para que no se reimplemente el filtro.

## Entidades nuevas de este feature

### PublicNews (forma de respuesta pública)

Transformación pura de `NewsDocument` → `PublicNews`, sin I/O, en `src/core/publicNews.ts`.
Implementa FR-003 (solo estos cuatro campos, nunca datos internos de bookkeeping):

| Campo | Tipo | Regla |
|---|---|---|
| `title` | string | igual a `NewsDocument.title`, sin transformación adicional (ya normalizado por feature 1) |
| `summary` | string | igual a `NewsDocument.summary` (ya limpio de imagen inicial por feature 1); NUNCA reescrito (Artículo VIII) |
| `link` | string | igual a `NewsDocument.link` (== `_id`) |
| `publishedAt` | string (ISO 8601, UTC) | igual a `NewsDocument.publishedAt`, serializado |

Explícitamente **excluidos**: `category` (siempre la configurada, conocida de antemano),
`updatedAt`, `firstSeenAt`, `expiresAt`, `_id` interno — ver spec.md, sección Assumptions.

### Rango del día en curso (`localDayRangeUtc`)

Salida pura de `src/core/localTime.ts` (extendido, no redeclarado):

| Campo | Tipo | Significado |
|---|---|---|
| `startUtc` | Date | instante UTC correspondiente al inicio (00:00:00) del día local vigente |
| `endUtc` | Date | el instante de la consulta (`now`); el filtro es `publishedAt < endUtc`, nunca un corte fijo |

Usado por `src/adapters/newsReader.ts` para construir el filtro
`{ publishedAt: { $gte: startUtc, $lt: endUtc } }` sobre `news`, ordenado
`{ publishedAt: -1 }` (FR-002).

### CacheSnapshot (estado interno del proceso, no persistido)

Vive únicamente en memoria del proceso HTTP (`src/http/cache.ts`); no es una colección de
MongoDB ni se comparte entre instancias. Implementa research.md §3:

| Campo | Tipo | Significado |
|---|---|---|
| `news` | `PublicNews[]` | conjunto ya mapeado, listo para serializar |
| `localDayKey` | string (`YYYY-MM-DD`) | día local para el que se calculó este snapshot; si el día local vigente cambia, el snapshot se invalida sin esperar el TTL |
| `etag` | string | `sha1` (hex) sobre una serialización estable de `news` |
| `refreshedAt` | Date | instante en que se generó este snapshot; alimenta `Last-Modified` |

**Transición de estado**: al recibir una petición, si no hay snapshot, si `localDayKey` ya no
coincide con el día local vigente, o si `refreshedAt` excede el TTL configurado, se refresca
consultando `newsReader` una vez y se recalcula `etag`. En cualquier otro caso se sirve el
snapshot existente sin tocar la base (research.md §3, FR de disponibilidad del spec).

## Configuración de entorno de este proceso (`src/config/serverEnv.ts`)

Variables propias del endpoint, obligatorias y validadas al arranque (mismo tratamiento sin
defaults ocultos que `src/config/env.ts` de la feature 1; reutiliza sus helpers
`requireString`/`requirePositiveIntMs`, exportados para este fin):

| Variable | Formato | Propósito |
|---|---|---|
| `MONGODB_READONLY_URI` | connection string de MongoDB | credencial de rol `read` exclusivamente (research.md §4) — nunca la misma que `MONGODB_URI` del ingestor |
| `TIMEZONE` | zona IANA `Área/Ciudad` | mismo formato y misma validación (`isValidIanaTimeZone`) que la feature 1; determina el corte de día local |
| `PORT` | entero positivo | puerto de escucha de Fastify |
| `RATE_LIMIT_MAX_PER_IP` | entero positivo | máximo de peticiones por IP dentro de la ventana (research.md §7) |
| `RATE_LIMIT_WINDOW_MS` | entero positivo, milisegundos | ventana de tiempo del límite de tasa |
| `CACHE_TTL_MS` | entero positivo, milisegundos | vigencia de la caché en memoria del conjunto del día (research.md §3) antes de refrescar contra MongoDB; agregada durante la implementación — no estaba en la tabla original de esta sección, es la misma decisión de research.md §3 hecha explícitamente configurable en vez de una constante embebida, igual que el resto de los umbrales del proyecto |

No hay variable para CORS: el origen permitido es fijo (`origin: true`), decidido en FR-014,
no configurable (research.md §8).
