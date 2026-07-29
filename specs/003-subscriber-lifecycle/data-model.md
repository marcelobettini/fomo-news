# Data Model: Alta, confirmación y baja de suscriptores por correo electrónico

## Colecciones nuevas de este feature

Viven en el mismo cluster de Atlas que `news`, pero se acceden **exclusivamente** a través de
la credencial acotada `MONGODB_SUBSCRIBERS_URI` (research.md §4) — nunca desde la conexión de
solo lectura de la feature 2, que sigue sirviendo únicamente `news`.

### `subscribers`

Un documento por dirección de correo con relación vigente con el sistema (pendiente o activa).
Al darse de baja (por cualquier vía), el documento se **elimina** (FR-010) — no existe un
estado "inactivo" persistente.

| Campo | Tipo | Presente cuando | Significado |
|---|---|---|---|
| `_id` | string | siempre | correo normalizado (`trim` + minúsculas); clave natural, evita duplicados por construcción |
| `status` | `"pending"` \| `"active"` | siempre | estado del ciclo de vida (FR-002/FR-006) |
| `confirmationTokenHash` | string (hex, sha256) | siempre | resumen del token de confirmación vigente o ya usado; nunca el token en claro (protege contra activación por acceso a la base) |
| `confirmationTokenExpiresAt` | Date (UTC) | solo mientras `status === "pending"` | vencimiento del token vigente; índice TTL (research.md §5); se elimina (`$unset`) al activarse, así el TTL deja de aplicar |
| `unsubscribeTokenHash` | string (hex, sha256) | siempre | resumen del token de baja, estable durante toda la vida del documento (pendiente y activo) — FR-008, necesario desde el primer mensaje enviado (el de confirmación) |
| `lastRequestAt` | Date (UTC) | siempre | instante de la última solicitud de alta atendida para esta dirección; gobierna el cooldown de reenvío (research.md §6) |
| `activatedAt` | Date (UTC) | solo mientras `status === "active"` | instante exacto de confirmación (FR-006/FR-021); dato que consumirá la feature de envío periódico para no entregar noticias anteriores |
| `createdAt` | Date (UTC) | siempre | instante de la primera solicitud de alta para esta dirección |

**Índices**:
- `{ confirmationTokenExpiresAt: 1 }`, `{ expireAfterSeconds: 0 }` — TTL, housekeeping de
  pendientes abandonados (research.md §5).
- `{ confirmationTokenHash: 1 }`, único — búsqueda O(1) al confirmar; una colisión sería
  prácticamente imposible con sha256 sobre un token aleatorio de 256 bits, pero el índice
  único la vuelve además irrepresentable en la base.
- `{ unsubscribeTokenHash: 1 }`, único — misma razón, para la búsqueda al dar de baja.

**Transiciones de estado**:

```text
(sin documento) --alta--> pending --confirmación válida y vigente--> active
      ^                     |  |                                        |
      |                     |  +--vencimiento (TTL, housekeeping)--> (sin documento)
      |                     |
      +---------------------+-------------------- baja (cualquier vía) -----------> (sin documento)
```

Reglas de transición (mapeadas a FR-xxx de spec.md):

- `(sin documento) → pending`: alta para una dirección nunca antes registrada o ya limpiada
  tras baja/vencimiento (FR-001/FR-002/FR-011/FR-012).
- `pending → pending` (mismo documento): alta repetida para una dirección ya pendiente; sin
  cambio de estado. Si el cooldown ya venció, se reemplazan `confirmationTokenHash` /
  `confirmationTokenExpiresAt` y se reenvía; si no, no hay efecto observable (FR-015/research.md §6).
  `unsubscribeTokenHash` nunca se reemplaza en este caso.
- `pending → active`: uso válido, no vencido, del token de confirmación (FR-006). Se fija
  `activatedAt = now` y se quita `confirmationTokenExpiresAt`.
- `pending → active` (reintento del mismo token tras ya activarse): no cambia nada; se
  responde "ya usado" comparando `status === "active"` con el mismo `confirmationTokenHash`
  (FR-004).
- `pending → (sin documento)`: vencimiento sin confirmar, purgado por el índice TTL
  (research.md §5) — housekeeping, no una decisión tomada por request.
- `active → pending`: **no existe.** Una dirección activa nunca vuelve a pendiente por una
  alta repetida (FR-015); solo puede pasar a "sin documento" (baja) y desde ahí, en una
  solicitud de alta posterior, a un `pending` nuevo (FR-011/FR-012).
- `{pending, active} → (sin documento)`: baja, por cualquiera de las tres vías — solicitud
  propia, notificación de dirección permanentemente inválida, o queja de no deseado (FR-010,
  FR-012, FR-013). Siempre acompañada de un alta en `suppressions` (ver abajo).

### `suppressions`

Rastro mínimo, no reversible, que sobrevive a la baja — su único propósito es evitar reenviar
por error a una dirección recién dada de baja (FR-010); no bloquea ni condiciona una alta
futura de la misma persona (FR-011/FR-012 — la feature de envío periódico, fuera de este
alcance, es quien eventualmente consultará esta colección antes de despachar un mensaje).

| Campo | Tipo | Significado |
|---|---|---|
| `_id` | string (hex, HMAC-SHA256) | `HMAC-SHA256(correo normalizado, EMAIL_SUPPRESSION_HASH_SECRET)` (research.md §7); nunca el correo en texto claro ni un hash sin secreto |
| `reason` | `"unsubscribed"` \| `"hard_bounce"` \| `"complaint"` | vía que originó la baja (FR-012/FR-013 vs. baja propia) |
| `suppressedAt` | Date (UTC) | instante de la baja/desactivación |

Sin índice TTL: se conserva indefinidamente (Assumptions de spec.md) — es el mínimo dato no
reversible, de bajo costo de almacenamiento, y su valor protector no caduca.

## Entidades de núcleo (sin I/O, `src/core/`)

### `EmailMessage` / `EmailSender` (Artículo V — research.md §10)

Contrato entre el núcleo (que construye contenido) y el adaptador (que lo entrega), definido en
`src/adapters/emailSender.ts` pero **consumido** desde `src/core` solo como tipo, nunca
implementado ahí:

| Campo (`EmailMessage`) | Tipo | Significado |
|---|---|---|
| `to` | string | dirección de destino |
| `subject` | string | asunto |
| `text` | string | versión texto plano |
| `html` | string | versión HTML |
| `headers` | `Record<string, string>` | encabezados adicionales — para el mensaje de confirmación, `List-Unsubscribe` y `List-Unsubscribe-Post` (RFC 8058, research.md §8) |

`EmailSender` expone una única operación: `send(message: EmailMessage): Promise<void>`.

### Decisiones puras (`src/core/subscriberLifecycle.ts`)

Funciones sin I/O, testeables sin Mongo ni red, que encapsulan las reglas de negocio de esta
sección:

- `isConfirmationTokenExpired(expiresAt: Date, now: Date): boolean`
- `isResendCooldownElapsed(lastRequestAt: Date, now: Date, cooldownMs: number): boolean`
- `classifyChannelSignal(eventType: string, bounceSubtype?: string): "permanent" | "transient" | "complaint" | "ignored"`
  — traduce el vocabulario del proveedor a las tres categorías de negocio de FR-012/FR-013/FR-014;
  aísla el nombre exacto de los campos del proveedor a un solo punto del código.

### Formato de correo (`src/core/emailFormat.ts`)

`isValidEmailFormat(value: string): boolean` — validación sintáctica de dirección de correo
(FR-019), sin verificar existencia de dominio (Assumptions de spec.md). Sin dependencia
externa de validación (evita sumar `ajv-formats` u otra librería solo para este chequeo).

### Tokens (`src/core/tokens.ts`)

- `generateToken(): string` — origen de aleatoriedad criptográfica (`node:crypto.randomBytes`),
  codificado para viajar en una URL (base64url).
- `hashToken(rawToken: string): string` — `sha256` en hexadecimal, para persistir en vez del
  token en claro (FR-018 — imposible de adivinar o derivar del correo; y protege contra
  activación/baja por acceso directo a la base, requisito explícito del usuario).

## Configuración de entorno nueva de este feature

Extiende `src/config/serverEnv.ts` (mismo proceso HTTP que la feature 2, mismo tratamiento sin
defaults ocultos):

| Variable | Formato | Propósito |
|---|---|---|
| `MONGODB_SUBSCRIBERS_URI` | connection string de MongoDB | credencial acotada a `subscribers`/`suppressions` (research.md §4); nunca la misma que `MONGODB_READONLY_URI` ni que `MONGODB_URI` |
| `PUBLIC_BASE_URL` | URL absoluta (`https://...`) | base para construir los enlaces de confirmación y de baja embebidos en los mensajes |
| `EMAIL_PROVIDER_API_KEY` | string (secreto) | clave de la API de Resend (research.md §1/§2); nunca versionada |
| `EMAIL_SENDER_ADDRESS` | dirección de correo | remitente verificado del dominio propio (research.md §9) |
| `EMAIL_WEBHOOK_SIGNING_SECRET` | string (secreto) | secreto de verificación de firma de webhooks (research.md §3); nunca versionado |
| `EMAIL_SUPPRESSION_HASH_SECRET` | string (secreto) | secreto del HMAC de `suppressions._id` (research.md §7); nunca versionado; distinto del secreto de firma de webhooks |
| `CONFIRMATION_TOKEN_TTL_MS` | entero positivo, milisegundos | vencimiento corto del token de confirmación (FR-003/FR-005) |
| `SIGNUP_RESEND_COOLDOWN_MS` | entero positivo, milisegundos | cooldown de reenvío / límite de tasa por dirección de destino (research.md §6) |
| `SIGNUP_RATE_LIMIT_MAX_PER_IP` | entero positivo | límite de tasa por IP específico de `POST /subscribers` (FR-016), independiente de `RATE_LIMIT_MAX_PER_IP` de `GET /news` |
| `SIGNUP_RATE_LIMIT_WINDOW_MS` | entero positivo, milisegundos | ventana del límite anterior |

No hay variable nueva para el límite de tasa por dirección de destino: lo cubre
`SIGNUP_RESEND_COOLDOWN_MS` (research.md §6), evitando un segundo mecanismo redundante.

Variables reutilizadas sin cambios de la feature 2: `MONGODB_READONLY_URI`, `TIMEZONE`,
`PORT`, `RATE_LIMIT_MAX_PER_IP`, `RATE_LIMIT_WINDOW_MS`, `CACHE_TTL_MS`.
