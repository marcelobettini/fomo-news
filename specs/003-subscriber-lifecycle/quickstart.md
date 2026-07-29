# Quickstart: validar alta, confirmación y baja de suscriptores

Valida el ciclo completo de extremo a extremo contra el mismo proceso HTTP de la feature 2
(`src/server.ts`), ahora con las rutas de suscriptores agregadas. Requiere un dominio verificado
en Resend con los registros DNS ya propagados (research.md §9) para los pasos que envían correo
real; el resto se puede validar con la caja de pruebas HTTP (`fastify.inject()`), sin red.

## Prerrequisitos

1. Dominio verificado en Resend, con SPF/DKIM/DMARC publicados y propagados (research.md §9).
   Sin esto, el paso 3 (envío real) falla o queda pendiente — verificar con la propia
   herramienta de verificación de dominio de Resend antes de continuar.
2. Usuario de Atlas con el rol acotado a `subscribers`/`suppressions` ya creado (research.md
   §4), y su connection string en `MONGODB_SUBSCRIBERS_URI`.
3. `.env.server` completo, incluyendo las variables nuevas de data-model.md (`PUBLIC_BASE_URL`,
   `EMAIL_PROVIDER_API_KEY`, `EMAIL_SENDER_ADDRESS`, `EMAIL_WEBHOOK_SIGNING_SECRET`,
   `EMAIL_SUPPRESSION_HASH_SECRET`, `CONFIRMATION_TOKEN_TTL_MS`, `SIGNUP_RESEND_COOLDOWN_MS`,
   `SIGNUP_RATE_LIMIT_MAX_PER_IP`, `SIGNUP_RATE_LIMIT_WINDOW_MS`).
4. `npm run build && npm run serve` (arranca el proceso HTTP con las variables de
   `.env.server`).

## 1. Alta

```bash
curl -i -X POST http://localhost:$PORT/subscribers \
  -H 'Content-Type: application/json' \
  -d '{"email":"tu-correo-de-prueba@ejemplo.com"}'
```

**Esperado**: `202 Accepted`, cuerpo `{"status":"ok"}` (contracts/subscriber-http-contract.md).
Repetir el mismo comando inmediatamente: misma respuesta, y **no** debe llegar un segundo
correo (research.md §6, `SIGNUP_RESEND_COOLDOWN_MS` sin vencer todavía).

**Verificación en base** (colección `subscribers`, vía la credencial acotada): debe existir un
documento con `status: "pending"` para esa dirección.

## 2. Confirmación

Revisar la bandeja del correo de prueba: debe haber llegado un mensaje con un enlace de
confirmación (`{PUBLIC_BASE_URL}/subscribers/confirm/{token}`) y, en el cuerpo y en los
encabezados, un enlace/acción de baja (`List-Unsubscribe`, `List-Unsubscribe-Post`).

```bash
curl -i http://localhost:$PORT/subscribers/confirm/<token del correo>
```

**Esperado**: `200 OK`. Repetir el mismo comando: ahora `409 Conflict` (FR-004, enlace ya
usado).

**Verificación en base**: el documento pasa a `status: "active"`, con `activatedAt` presente y
`confirmationTokenExpiresAt` ausente.

**Vencimiento** (validación alternativa, sin esperar el TTL real): repetir el paso 1 con otra
dirección de prueba, y en la base de test/staging adelantar manualmente
`confirmationTokenExpiresAt` a un instante pasado antes de llamar a `confirm`; debe responder
`410 Gone` (FR-005).

## 3. Baja

```bash
curl -i http://localhost:$PORT/subscribers/unsubscribe/<unsubscribe-token del correo>
```

**Esperado**: `200 OK`. Repetir el mismo comando: sigue siendo `200 OK` (idempotente,
contracts/subscriber-http-contract.md).

**Verificación en base**: el documento en `subscribers` ya no existe; existe un documento
nuevo en `suppressions` con `reason: "unsubscribed"` cuyo `_id` no es reconocible como la
dirección de correo (research.md §7).

**Baja de un clic**: repetir con `-X POST -H 'Content-Type: application/x-www-form-urlencoded' -d 'List-Unsubscribe=One-Click'`
sobre un token de baja fresco (nueva alta + confirmación) — mismo resultado que el `GET`.

## 4. Resuscripción tras baja

Repetir el paso 1 con la misma dirección usada en el paso 3.

**Esperado**: se comporta como una alta nueva — `202 Accepted`, llega un nuevo correo con un
nuevo enlace de confirmación, y la suscripción **no** queda activa hasta confirmar de nuevo
(FR-011/FR-012).

## 5. Señales del canal (webhook)

Sin depender de que Resend genere un rebote real, se puede construir la firma a mano para
probar la verificación (research.md §3):

```bash
BODY='{"type":"email.bounced","data":{"bounce_type":"Permanent","to":["tu-correo-de-prueba@ejemplo.com"]}}'
TIMESTAMP=$(date +%s)
SVIX_ID="msg_test"
SIGNED_CONTENT="${SVIX_ID}.${TIMESTAMP}.${BODY}"
SIGNATURE=$(printf '%s' "$SIGNED_CONTENT" | openssl dgst -sha256 -hmac "$EMAIL_WEBHOOK_SIGNING_SECRET" -binary | base64)

curl -i -X POST http://localhost:$PORT/webhooks/email \
  -H "svix-id: $SVIX_ID" \
  -H "svix-timestamp: $TIMESTAMP" \
  -H "svix-signature: v1,$SIGNATURE" \
  -H 'Content-Type: application/json' \
  -d "$BODY"
```

**Esperado**: `200 OK`, y el suscriptor correspondiente (si estaba activo) queda eliminado con
una supresión `reason: "hard_bounce"` (FR-012).

**Firma inválida**: repetir cambiando un carácter de `SIGNATURE` — debe responder `401` y no
tocar ningún documento (research.md §3).

**Fallo transitorio**: repetir con `"bounce_type":"Transient"` sobre un suscriptor activo —
`200 OK`, pero el suscriptor sigue `active`, sin cambios (FR-014).

## Referencias

- Formato exacto de peticiones/respuestas: `contracts/subscriber-http-contract.md`.
- Esquema de datos y variables de entorno: `data-model.md`.
- Justificación de cada decisión técnica: `research.md`.
