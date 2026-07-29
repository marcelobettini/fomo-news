# Contract: rutas HTTP de ciclo de vida de suscriptores

Rutas nuevas, agregadas al mismo servicio Fastify de la feature 2 (`src/http/app.ts`), junto a
`GET /news`. Ninguna de estas rutas toca la colección `news` ni la conexión de solo lectura de
esa feature (data-model.md, research.md §4).

## `POST /subscribers` (alta)

### Petición

Cuerpo JSON: `{ "email": "persona@ejemplo.com" }`.

### Respuestas

- **`202 Accepted`** — cuerpo fijo `{ "status": "ok" }`, **idéntico** sin importar si la
  dirección era nueva, ya estaba pendiente, o ya estaba activa (FR-017/SC-008). Internamente
  puede o no haberse enviado un mensaje (research.md §6); eso nunca se refleja en la respuesta.
- **`400 Bad Request`** — `{ "error": "invalid_email" }` cuando el formato de la dirección es
  inválido (FR-019). Distinguible del `202`, pero esto no filtra información sobre el estado de
  ninguna dirección real: rechaza por forma, antes de siquiera considerar si existe un
  suscriptor.
- **`429 Too Many Requests`** — emitido por `@fastify/rate-limit` cuando el origen (IP) supera
  `SIGNUP_RATE_LIMIT_MAX_PER_IP` en `SIGNUP_RATE_LIMIT_WINDOW_MS` (FR-016).

## `GET /subscribers/confirm/{token}` (confirmación)

Enlace de un solo uso enviado por correo; lo abre una persona en un navegador.

### Respuestas

- **`200 OK`** — token válido, vigente, primer uso: la suscripción pasa a `active` (FR-006).
- **`409 Conflict`** — el token corresponde a una suscripción que **ya está activa** (ya fue
  usado antes): "este enlace ya fue utilizado" (FR-004).
- **`410 Gone`** — el token existe pero venció (`now` ≥ `confirmationTokenExpiresAt`):
  "este enlace venció" (FR-005).
- **`404 Not Found`** — el token no corresponde a ningún documento (nunca existió, o ya fue
  purgado por el índice TTL tras un vencimiento antiguo — research.md §5). No se distingue de
  un token vencido y purgado hace tiempo; ambos casos son, en los hechos, "este enlace ya no es
  válido".

Ninguna de estas respuestas revela la dirección de correo asociada al token.

## `GET /subscribers/unsubscribe/{token}` y `POST /subscribers/unsubscribe/{token}` (baja)

Misma acción, dos métodos (research.md §8): `GET` para el enlace visible del cuerpo del
mensaje (lo abre una persona), `POST` para la baja de un clic invocada automáticamente por el
cliente de correo vía `List-Unsubscribe-Post` (RFC 8058) — mismo token, misma URL.

### Petición

- `GET`: sin cuerpo.
- `POST`: `Content-Type: application/x-www-form-urlencoded`, cuerpo `List-Unsubscribe=One-Click`
  (el valor no se interpreta; ver research.md §8).

### Respuesta

- **`200 OK`** en ambos métodos, siempre, tanto si el token correspondía a un suscriptor
  todavía presente (se elimina el documento y se registra la supresión — FR-010) como si ya
  no existía (baja repetida, token de una suscripción ya eliminada antes): la baja es
  idempotente y nunca informa cuál de los dos casos ocurrió (evita filtrar si una dirección
  estuvo alguna vez suscripta a partir de una segunda invocación del mismo enlace).

No existe una respuesta de error distinta para "token inexistente" en esta ruta a propósito:
a diferencia de la confirmación (donde distinguir vencido/usado es un requisito explícito), la
baja debe ser "un solo paso, sin confirmación adicional" siempre — introducir una rama de error
aquí solo agregaría fricción no pedida por la spec.

## `POST /webhooks/email` (señales del canal)

Ruta pública invocada por Resend, nunca por una persona. Entrega notificaciones de rebote y de
queja sobre mensajes ya enviados por este sistema.

### Petición

Cuerpo JSON firmado (esquema Svix, research.md §3): encabezados `svix-id`, `svix-timestamp`,
`svix-signature`. El cuerpo crudo (antes de parsear JSON) es el que participa en el cálculo de
la firma.

### Respuestas

- **`401 Unauthorized`** — firma ausente o inválida. El cuerpo **no se procesa** en este caso
  (research.md §3) — ninguna suscripción se ve afectada por un webhook no verificado.
- **`200 OK`** — firma válida. Comportamiento según el tipo de evento
  (`classifyChannelSignal`, data-model.md):
  - **fallo permanente** (dirección inválida de forma definitiva): se elimina el suscriptor
    correspondiente y se registra la supresión con motivo `hard_bounce` (FR-012).
  - **queja de no deseado**: mismo efecto, motivo `complaint` (FR-013).
  - **fallo transitorio**: sin efecto sobre ninguna suscripción (FR-014) — se responde `200`
    igual, para no provocar reintentos del proveedor sobre un evento ya procesado
    correctamente (aunque la decisión de negocio haya sido "no hacer nada").
  - **evento no relacionado con rebote/queja o sin dirección de destino correlacionable a un
    suscriptor conocido**: se ignora sin error (`200`) — no hay nada que desactivar.

## Fuera de este contrato

Ninguna otra ruta de suscriptores: sin listado, sin consulta de estado por dirección, sin panel
de administración (fuera de alcance de spec.md). El servicio sigue exponiendo únicamente
`GET /news` (feature 2) además de las rutas de esta sección.
