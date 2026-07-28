# Data Model: Captura periódica de noticias con retención acotada y detección de pérdidas

Todas las fechas se almacenan como instantes UTC (tipo `Date` de MongoDB). Las decisiones de
negocio sobre "día local" se calculan al vuelo con `Intl`, nunca se persisten como fecha
local (Artículo VI).

## news

Representa la entidad **Noticia capturada** de spec.md.

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | string | El enlace al artículo original; identificador estable y único (assumption de spec.md). |
| `title` | string | Normalizado (espacios y saltos de línea colapsados). |
| `summary` | string | Tal como lo publica la fuente, sin la imagen inicial embebida; ningún otro contenido reescrito. |
| `link` | string | Igual a `_id`; se mantiene como campo explícito para legibilidad y para un futuro índice si hiciera falta. |
| `category` | string | Categoría declarada, normalizada; determina pertenencia a la categoría objetivo. |
| `publishedAt` | Date (UTC) | Fecha de publicación reportada por la fuente. |
| `updatedAt` | Date (UTC) | Fecha de última actualización; igual a `publishedAt` si la fuente no la provee. |
| `firstSeenAt` | Date (UTC) | Cuándo el ingestor la almacenó por primera vez (bookkeeping interno, no expuesto por spec). |
| `expiresAt` | Date (UTC) | `publishedAt` + retención configurada; campo objetivo del índice TTL. |

**Validation rules**:
- `_id`/`link` no vacío; una entrada sin enlace no puede procesarse (se cuenta como error de
  la corrida, no se almacena).
- `category` debe ser igual a la categoría objetivo configurada para que el documento exista
  (FR-005); no se almacenan entradas de otras categorías.
- `updatedAt >= publishedAt` no se fuerza: la fuente puede reportar cualquier orden; el
  sistema refleja lo que la fuente envía (FR-007), no lo corrige.

**State transitions**: `insert` (primera vez que se ve el enlace, cuenta como "nueva") →
`update` (enlace ya conocido, se refresca `summary`/`title`/`updatedAt`/`category`, nunca
vuelve a contar como nueva) → `expirada` (eliminada por el motor vía TTL sobre `expiresAt`,
sin intervención de código propio).

**Índices**:
- TTL: `{ expiresAt: 1 }` con `expireAfterSeconds: 0`.
- Índice único implícito en `_id`.

## runs

Representa la entidad **Registro de corrida de ingesta**.

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | ObjectId | Autogenerado. |
| `startedAt` | Date (UTC) | Momento de inicio de la corrida. |
| `finishedAt` | Date (UTC) | Momento de fin. |
| `status` | `"success" \| "failure"` | `failure` si `entriesSeen === 0`, si hubo error de red/parseo, o si no pudo tomar el lock. |
| `entriesSeen` | number | Tamaño total de la ventana devuelta por la fuente en esta corrida, antes de filtrar por categoría. |
| `entriesNew` | number | Cantidad de entradas de la categoría objetivo insertadas por primera vez. |
| `oldestEntryAt` | Date (UTC) | Fecha de publicación de la entrada más antigua presente en el feed en este momento (para calibrar la cadencia de ingesta). |
| `errors` | string[] | Vacío si no hubo errores. |
| `alarms` | string[] | Subconjunto de `"full-window-rotation"`, `"category-silence"`; vacío en operación normal. |
| `newCategoriesObserved` | string[] | Categorías vistas en esta corrida que no existían antes en `categories`. |
| `categoryMismatches` | number | Cantidad de entradas cuya categoría declarada difiere de la categoría de la ruta del enlace. |

**Validation rules**:
- Una corrida con `entriesSeen === 0` DEBE tener `status: "failure"` (FR-017; nunca
  `"success"` con cero resultados).
- `alarms` incluye `"full-window-rotation"` solo si `entriesNew === entriesSeen` y existe al
  menos una corrida previa con `status: "success"` (excepción de primera corrida, ver
  research.md §7).

**Índices**: ninguno obligatorio más allá de `_id`; consultas de calibración son de bajo
volumen y baja frecuencia (una por corrida).

## categories

Representa la entidad **Categoría observada**.

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | string | Nombre de categoría normalizado. |
| `firstSeenAt` | Date (UTC) | Primera vez vista en la fuente. |
| `lastSeenAt` | Date (UTC) | Última vez vista, se objetivo o no. |

**Validation rules**: se actualiza (upsert) por cada categoría vista en cada corrida, sea o
no la categoría objetivo (FR-012).

## raw_snapshots

Representa la entidad **Copia cruda de respuesta**.

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | ObjectId | Autogenerado. |
| `runId` | ObjectId | Referencia a `runs._id`. |
| `fetchedAt` | Date (UTC) | Momento de la descarga. |
| `rawBody` | string | Cuerpo de la respuesta tal como llegó de la fuente. |
| `expiresAt` | Date (UTC) | `fetchedAt` + período corto de diagnóstico configurado; TTL. |

**Índices**: TTL `{ expiresAt: 1 }` con `expireAfterSeconds: 0`, independiente del TTL de
`news`.

## state (singleton)

Estado auxiliar de bajo volumen que no encaja en las entidades anteriores; no es una entidad
de negocio de spec.md, es bookkeeping técnico para evaluar la alarma de ausencia prolongada
de categoría (research.md §8).

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | `"ingestor"` | Documento único. |
| `lastTargetCategoryObservedAt` | Date (UTC) | Última vez que se vio (nueva o no) una entrada de la categoría objetivo en la ventana de la fuente. |

## locks (mecanismo de exclusión mutua, no es una entidad de negocio)

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | `"ingestor"` | Documento único, nombre fijo del lock. |
| `acquiredAt` | Date (UTC) | Cuándo se tomó el lock. |
| `expiresAt` | Date (UTC) | TTL de respaldo por si el proceso termina sin liberar el lock (crash). |

## Relaciones

- `raw_snapshots.runId` referencia `runs._id` (1 a 1 por corrida exitosa en su descarga; una
  corrida fallida antes de recibir respuesta no genera snapshot).
- `news` y `categories` no se referencian entre sí; `categories` es un registro de
  vocabulario observado, no una relación con cada noticia.
- `state` y `locks` son estado técnico transversal, no referencian otras colecciones.
