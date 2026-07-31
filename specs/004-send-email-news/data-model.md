# Data Model: Entrega de noticias por correo a suscriptores

## Colección nueva de este feature

### `deliveries`

Vive en el mismo cluster de Atlas que `news`/`subscribers`, accedida por el notifier a través
de `MONGODB_NOTIFIER_URI` (research.md §10) y, solo para el borrado en cascada al eliminarse un
suscriptor, por el proceso HTTP de la feature 3 a través de `MONGODB_SUBSCRIBERS_URI` con su
rol ampliado (research.md §9). Un documento por combinación efectivamente entregada de noticia,
suscriptor y canal — su **existencia** es lo que hace que una noticia deje de estar pendiente
para ese suscriptor; nunca se actualiza, solo se crea (una vez) o se borra (al eliminarse el
suscriptor).

| Campo | Tipo | Significado |
|---|---|---|
| `_id` | `ObjectId` | identidad técnica, sin significado de negocio |
| `subscriberId` | string | correo normalizado del suscriptor; mismo valor que `subscribers._id` (feature 3) |
| `newsId` | string | enlace de la noticia; mismo valor que `news._id` (feature 1) |
| `channel` | `"email"` | fijo en este alcance (Artículo V: el campo existe para que un canal futuro no requiera cambiar el modelo, no porque haya más de uno hoy) |
| `deliveredAt` | Date (UTC) | instante en que el canal confirmó la entrega (FR-011) |

**Índices**:
- `{ subscriberId: 1, newsId: 1, channel: 1 }`, único — hace irrepresentable un segundo
  registro para la misma combinación (research.md §3, FR-013); la escritura es un `insertOne`
  que trata el error `11000` como éxito idempotente, no un `findOne` previo.
- `{ subscriberId: 1 }` — usado por el borrado en cascada al eliminarse un suscriptor
  (`deleteMany({ subscriberId })`, research.md §9); el índice único compuesto ya cubre esta
  consulta como prefijo, así que no hace falta un índice adicional separado.

**Ciclo de vida**:

```text
(sin documento) --EmailSender.send() devuelve "confirmed"--> existe, inmutable
      ^
      |
      +-- se elimina junto con el suscriptor (baja, supresión) --> (sin documento)
```

No hay transición de vuelta a "sin documento" salvo la eliminación del suscriptor — una entrega
ya confirmada nunca se revierte por una actualización posterior de la noticia (FR-016).

## Reutilización de entidades existentes (sin redeclarar)

- **`news`** (`src/adapters/repository.ts`, feature 1): se reutiliza `NewsDocument` tal cual —
  solo interesan `_id` (= `newsId`) y `publishedAt`. La colección ya contiene únicamente la
  categoría objetivo (el ingestor filtra antes de escribir), así que "elegible si pertenece a
  la categoría configurada" (FR-002) no requiere ningún filtro adicional en esta feature — mismo
  razonamiento ya documentado en `newsReader.ts` (feature 2).
- **`subscribers`** (`src/adapters/subscriberRepository.ts`, feature 3): se reutiliza
  `SubscriberDocument` tal cual — solo interesan `_id` (= `subscriberId`), `status` y
  `activatedAt`. Se agrega una función de lectura nueva, aditiva:
  `getActiveSubscribers(db): Promise<Pick<SubscriberDocument, "_id" | "activatedAt">[]>`
  (`status === "active"` únicamente — FR-017).
- **`EmailMessage`/`EmailSender`** (`src/adapters/emailSender.ts`, feature 3): se reutiliza tal
  cual, con el único cambio genérico de tipo de retorno descrito en research.md §7.

## Cambios a módulos ya existentes de features anteriores

Ninguno de estos cambios altera el comportamiento observable ya construido; son aditivos o,
donde modifican algo existente, están justificados en research.md (§7, §8, §9) y no rompen
ningún test ya escrito de esas features (se actualizan junto con el código que tocan).

| Módulo | Feature dueña | Cambio |
|---|---|---|
| `src/adapters/lock.ts` | 1 | `LOCK_ID` deja de ser una constante fija; `acquireLock`/`releaseLock`/`ensureLockIndexes` reciben `lockId: string` como parámetro. El ingestor pasa `"ingestor"` (sin cambio de comportamiento); el notifier pasa `"notifier"`. |
| `src/adapters/repository.ts` | 1 | se agrega `getNewsPublishedAfter(db, sinceInstant: Date): Promise<NewsDocument[]>` (orden descendente por `publishedAt`) — aditiva, nada existente cambia. |
| `src/adapters/subscriberRepository.ts` | 3 | se agrega `getActiveSubscribers` (arriba); `deleteAndSuppress` se extiende para además `deliveries.deleteMany({ subscriberId: params.email })` en la misma llamada (research.md §9). |
| `src/core/tokens.ts` | 3 | se agrega `deriveUnsubscribeToken(email: string, secret: string): string` (HMAC-SHA256, base64url) (research.md §8). |
| `src/http/routes/subscribers.ts` | 3 | al dar de alta/reemitir, usa `deriveUnsubscribeToken(email, UNSUBSCRIBE_TOKEN_SECRET)` en vez de `generateToken()` para el token de baja; `reissueConfirmationToken` deja de recibir/rotar `unsubscribeTokenHash` (research.md §8). |
| `src/adapters/subscriberRepository.ts` (tipo `ReissueConfirmationTokenParams`) | 3 | pierde el campo `unsubscribeTokenHash` (ya no rota). |
| `src/adapters/emailSender.ts` | 3 | `EmailSender.send()` pasa de `Promise<void>` a `Promise<EmailSendResult>` (research.md §7); `createConsoleEmailSender` (agregado en esta misma conversación para pruebas locales) devuelve `"confirmed"`. |
| `src/http/routes/subscribers.ts` | 3 | único call-site existente de `emailSender.send()`: pasa a comprobar el resultado devuelto (`if (result !== "confirmed") throw ...`) en vez de depender de una excepción (research.md §7). |
| `tests/http/testHelpers.ts` | 2/3 | `makeFakeEmailSender` acepta un resultado configurable (por defecto `"confirmed"`), para que los tests existentes seguir pasando sin cambios y los nuevos de esta feature puedan simular fallo/ambigüedad. |

## Entidades de núcleo nuevas (sin I/O, `src/core/`)

### Elegibilidad y selección (`src/core/digestEligibility.ts`)

- `isNewsEligible(news: { publishedAt: Date }, subscriberActivatedAt: Date, maxPendingAgeMs: number, now: Date): boolean`
  — `publishedAt > subscriberActivatedAt` (FR-018) y `now - publishedAt <= maxPendingAgeMs`
  (FR-002, "no más antigua que un período máximo").
- `selectPendingNews<T extends { newsId: string }>(eligible: readonly T[], deliveredNewsIds: ReadonlySet<string>): T[]`
  — resta en memoria (research.md §4, FR-003/FR-004).
- `selectForMessage<T>(pendingSortedByPublishedDesc: readonly T[], maxPerMessage: number): { included: T[]; truncated: boolean }`
  — tope por mensaje (FR-009); los excluidos no se tocan, siguen pendientes.

### Ventana horaria (`src/core/sendWindow.ts`)

- `isWithinSendWindow(now: Date, timeZone: string, startLocal: string, endLocal: string): boolean`
  (research.md §5, FR-005). `startLocal`/`endLocal` en formato `"HH:MM"`.

### Coherencia de configuración (`src/core/retentionCoherence.ts`)

- `assertRetentionCoherent(params: { newsRetentionMs: number; maxSendIntervalMs: number; maxPendingAgeMs: number }): void`
  — lanza si `newsRetentionMs <= maxSendIntervalMs + maxPendingAgeMs` (research.md §6, FR-020).

### Contenido del mensaje (`src/core/digestEmail.ts`)

- `buildDigestEmail(params: { to: string; items: readonly { title: string; summary: string; link: string }[]; unsubscribeUrl: string; truncated: boolean; publicNewsUrl: string }): EmailMessage`
  — construcción pura (Artículo VIII/V), mismo molde que `confirmationEmail.ts`: HTML + texto
  plano + `List-Unsubscribe`/`List-Unsubscribe-Post`. Si `truncated`, agrega una línea que
  señala `publicNewsUrl` como dónde ver el resto (FR-009).

### Orquestación testeable (`src/notifier.ts`)

- `runDigestOnce(deps: RunDigestDeps): Promise<RunDigestSummary>` — la corrida completa (leer
  suscriptores activos, leer noticias en ventana de antigüedad, por cada suscriptor calcular
  pendientes/armar mensaje/enviar/registrar), parametrizada por `db`, `emailSender`, `now` y la
  configuración ya cargada — nunca lee `process.env` ni llama `new Date()` (research.md §2/§13).
  `RunDigestSummary` es un resumen agregado sin direcciones de correo
  (`{ subscribersProcessed, messagesSent, itemsDelivered, sendFailures, sendAmbiguous }`), apto
  para loguearse (Artículo IV, "las direcciones nunca en bitácoras").

## Configuración de entorno nueva de este feature

Proceso propio, `.env.notifier` — mismo tratamiento sin defaults ocultos que `.env`/`.env.server`:

| Variable | Formato | Propósito |
|---|---|---|
| `MONGODB_NOTIFIER_URI` | connection string de MongoDB | credencial acotada: lectura de `news`/`subscribers`, lectura-escritura de `deliveries`/`locks` (research.md §10); nunca la misma que `MONGODB_URI`, `MONGODB_READONLY_URI` ni `MONGODB_SUBSCRIBERS_URI` |
| `TIMEZONE` | nombre de zona IANA (nunca offset) | igual formato/validación que en las features 1-3; usado por la ventana horaria (Artículo VI) |
| `PUBLIC_BASE_URL` | URL absoluta | base para el enlace de baja y el enlace a la consulta pública dentro del mensaje; mismo valor que en `.env.server` |
| `EMAIL_PROVIDER_API_KEY` | string (secreto) | clave de Resend; mismo proveedor que la feature 3 |
| `EMAIL_SENDER_ADDRESS` | dirección de correo | remitente verificado; mismo dominio que la feature 3 |
| `UNSUBSCRIBE_TOKEN_SECRET` | string (secreto) | secreto compartido con `.env.server` para derivar el token de baja de forma determinística (research.md §8); nunca versionado |
| `SEND_WINDOW_START_LOCAL` | `"HH:MM"`, 24 horas | inicio de la ventana horaria permitida, hora local (FR-005) |
| `SEND_WINDOW_END_LOCAL` | `"HH:MM"`, 24 horas | fin de la ventana horaria permitida, hora local; se asume `>= SEND_WINDOW_START_LOCAL` (research.md §5) |
| `MAX_PENDING_AGE_MS` | entero positivo, milisegundos | vencimiento máximo de antigüedad para que una noticia siga siendo elegible (FR-002) |
| `MAX_NEWS_PER_MESSAGE` | entero positivo | tope de noticias por mensaje (FR-009) |
| `MAX_SEND_INTERVAL_MS` | entero positivo, milisegundos | intervalo máximo esperado entre invocaciones de cron; usado solo por la validación de coherencia (research.md §6) |
| `NEWS_RETENTION_MS` | entero positivo, milisegundos | mismo significado que en `.env` del ingestor, duplicado aquí para la validación de coherencia (research.md §6) |

Variable nueva en `.env.server` (feature 3, no en `.env.notifier`... salvo la ya listada
arriba): `UNSUBSCRIBE_TOKEN_SECRET` (mismo valor que en `.env.notifier` — es un secreto
compartido entre ambos procesos, research.md §8).
