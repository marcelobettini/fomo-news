---

description: "Task list for Alta, confirmación y baja de suscriptores por correo electrónico"
---

# Tasks: Alta, confirmación y baja de suscriptores por correo electrónico

**Input**: Design documents from `/specs/003-subscriber-lifecycle/`

**Prerequisites**: plan.md, spec.md, data-model.md, research.md, contracts/, quickstart.md

**Tests**: Requeridas por plan.md (Testing: `node:test` + `fastify.inject()` contra
`mongodb-memory-server`, con un doble en memoria de `EmailSender`) y por el input explícito del
usuario a `/speckit-plan` ("Cubrir al menos el ciclo completo de alta, confirmación y baja;
reutilización de un token ya usado; token vencido; solicitudes repetidas para la misma
dirección; verificación de firma de notificaciones, incluyendo el rechazo de una firma
inválida; y que un fallo transitorio no desactive suscripciones"). Cada historia de usuario
incluye sus propios tests HTTP.

**Organization**: Tareas agrupadas por historia de usuario para permitir implementación y
prueba independiente de cada una.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: A qué historia de usuario pertenece (US1, US2, US3, US4)
- Cada tarea incluye la ruta de archivo exacta

## Path Conventions

Mismo proyecto único y mismo proceso HTTP de la feature 2 (`src/server.ts`, `src/http/`). Se
extienden `src/config/serverEnv.ts` y `tests/http/testHelpers.ts`; se agregan módulos nuevos y
separados en `src/core/`, `src/adapters/` y `src/http/routes/` (plan.md, Project Structure). No
se toca `src/main.ts`, `src/adapters/repository.ts`, `src/adapters/newsReader.ts` ni
`src/http/routes/news.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: arrancar cuanto antes los dos pasos operativos externos con demora de propagación
o de aprovisionamiento (research.md §4/§9), y dejar listos los nombres de variables de entorno
nuevas. Ninguno de los dos primeros bloquea el desarrollo del código (los tests usan
`mongodb-memory-server` y un `EmailSender` de prueba, no Atlas ni Resend reales —
research.md §11), pero sí bloquean cualquier validación end-to-end real (quickstart.md) y el
despliegue, así que se inician primero a propósito.

- [ ] T001 Verificar el dominio propio en el panel de Resend y publicar los registros DNS de
      autenticación de remitente resultantes (SPF, DKIM, DMARC) en el proveedor de DNS del
      dominio (research.md §9). Sin dependencias de código; se arranca primero por la demora de
      propagación DNS, que puede tardar horas.
- [ ] T002 [P] Crear en Atlas un rol personalizado con `find`/`insert`/`update`/`remove`
      acotado únicamente a las colecciones `subscribers` y `suppressions` (sin ningún privilegio
      sobre `news`, `runs`, `categories`, `state` ni `raw_snapshots`), crear un usuario de base
      de datos dedicado con ese rol, y obtener su connection string (research.md §4). Paso
      operativo externo al repositorio, independiente de T001.
- [X] T003 [P] Agregar a `.env.server.example` los nombres (sin valores) de las diez variables
      nuevas de este feature: `MONGODB_SUBSCRIBERS_URI`, `PUBLIC_BASE_URL`,
      `EMAIL_PROVIDER_API_KEY`, `EMAIL_SENDER_ADDRESS`, `EMAIL_WEBHOOK_SIGNING_SECRET`,
      `EMAIL_SUPPRESSION_HASH_SECRET`, `CONFIRMATION_TOKEN_TTL_MS`,
      `SIGNUP_RESEND_COOLDOWN_MS`, `SIGNUP_RATE_LIMIT_MAX_PER_IP`,
      `SIGNUP_RATE_LIMIT_WINDOW_MS` (data-model.md), con un comentario breve por variable igual
      al estilo ya usado en el archivo para las variables de la feature 2.

**Checkpoint**: dominio en verificación y rol de Atlas en creación (procesos externos en curso,
sin bloquear lo siguiente); `.env.server.example` documenta ya las diez variables nuevas.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: infraestructura común (núcleo puro, adaptadores, configuración y wiring del
proceso HTTP) que las 4 historias de usuario necesitan

**⚠️ CRITICAL**: ninguna historia de usuario puede empezar hasta terminar esta fase

- [X] T004 [P] Implementar `src/core/emailFormat.ts`: `isValidEmailFormat(value: string): boolean`,
      validación sintáctica de correo sin verificar existencia de dominio, sin dependencia
      externa (FR-019, data-model.md)
- [X] T005 [P] Implementar `src/core/tokens.ts`: `generateToken()` (aleatoriedad criptográfica
      vía `node:crypto.randomBytes`, codificado base64url para viajar en una URL) y
      `hashToken(rawToken)` (`sha256` hexadecimal) (FR-018, data-model.md)
- [X] T006 [P] Implementar `src/core/subscriberLifecycle.ts`: `isConfirmationTokenExpired(expiresAt, now)`,
      `isResendCooldownElapsed(lastRequestAt, now, cooldownMs)`, y
      `classifyChannelSignal(eventType, bounceSubtype?)` → `"permanent" | "transient" | "complaint" | "ignored"`
      (data-model.md, research.md §5/§6)
- [X] T007 [P] Implementar `src/core/confirmationEmail.ts`: `buildConfirmationEmail(params): EmailMessage`
      puro — arma asunto, texto plano, HTML y encabezados `List-Unsubscribe`/
      `List-Unsubscribe-Post` (RFC 8058) a partir de la URL de confirmación y la URL de baja ya
      calculadas; el correo de confirmación incluye el enlace de baja desde el primer mensaje
      enviado (FR-008, research.md §8/§10)
- [X] T008 [P] Implementar `src/adapters/emailSender.ts`: interfaz `EmailMessage`/`EmailSender`
      (una sola operación `send`) y `createResendEmailSender(apiKey, senderAddress): EmailSender`
      sobre la API HTTP de Resend vía `fetch` nativo, sin el SDK oficial (research.md §1/§2/§10)
- [X] T009 Implementar `src/adapters/subscriberRepository.ts`: conexión de lectura-escritura
      acotada (`connect(mongoSubscribersUri)`, reutilizando el `connect()` genérico de
      `src/adapters/repository.ts`), `ensureSubscriberIndexes(db)` (TTL sobre
      `confirmationTokenExpiresAt`, únicos sobre `confirmationTokenHash` y
      `unsubscribeTokenHash`), y las operaciones de `subscribers`/`suppressions` de
      data-model.md: `findByEmail`, `findByConfirmationTokenHash`, `findByUnsubscribeTokenHash`,
      `createPending`, `reissueConfirmationToken`, `activate`, `deleteAndSuppress` (con el HMAC
      de `EMAIL_SUPPRESSION_HASH_SECRET`, research.md §7) (depende de T005 para las formas de
      hash que persiste, sin llamarlo directamente)
- [X] T010 [P] Extender `src/config/serverEnv.ts` con las diez variables nuevas de T003
      (`MONGODB_SUBSCRIBERS_URI`, `PUBLIC_BASE_URL`, `EMAIL_PROVIDER_API_KEY`,
      `EMAIL_SENDER_ADDRESS`, `EMAIL_WEBHOOK_SIGNING_SECRET`, `EMAIL_SUPPRESSION_HASH_SECRET`,
      `CONFIRMATION_TOKEN_TTL_MS`, `SIGNUP_RESEND_COOLDOWN_MS`,
      `SIGNUP_RATE_LIMIT_MAX_PER_IP`, `SIGNUP_RATE_LIMIT_WINDOW_MS`), reutilizando
      `requireString`/`requirePositiveInt`/`requirePositiveIntMs` de `src/config/env.ts`, sin
      valores por defecto ocultos (data-model.md)
- [X] T011 Extender `AppConfig` y `buildApp` en `src/http/app.ts`: acepta la segunda conexión de
      Mongo (`subscribersDb`), el `EmailSender`, y la configuración nueva de T010; todavía sin
      registrar ninguna ruta de suscriptores (depende de T008, T009, T010)
- [X] T012 Extender `src/server.ts`: abre también la conexión de lectura-escritura acotada
      (`subscriberRepository.connect`, T009) y construye el `EmailSender` real (T008), pasando
      ambos a `buildApp` (T011); cierra ambas conexiones de Mongo de forma ordenada ante
      `SIGTERM`/`SIGINT`, junto con la ya existente de solo lectura (depende de T009, T008, T010,
      T011)
- [X] T013 [P] Extender `tests/http/testHelpers.ts`: helpers para sembrar/limpiar documentos de
      `subscribers`/`suppressions` de prueba, y una fábrica `makeFakeEmailSender()` que
      implementa `EmailSender` guardando los mensajes "enviados" en un arreglo, sin red
      (research.md §11) (depende de T008, T009 para los tipos)

**Checkpoint**: `npm run build` compila; `node --env-file=.env.server dist/src/server.js`
levanta el proceso con ambas conexiones de Mongo y el `EmailSender` real construidos (ninguna
ruta de suscriptores responde todavía — 404 esperado); `testHelpers.ts` puede sembrar/limpiar
las colecciones nuevas y fabricar un `EmailSender` de prueba.

---

## Phase 3: User Story 1 - Alta con consentimiento verificado (doble opt-in) (Priority: P1) 🎯 MVP

**Goal**: cualquier persona solicita el alta con su correo; queda en estado pendiente; solo al
usar el enlace de confirmación de un solo uso y vencimiento corto la suscripción se activa y
queda registrado el instante de activación.

**Independent Test**: solicitar el alta con una dirección nueva, verificar que el `EmailSender`
de prueba capturó exactamente un mensaje de confirmación y que el documento queda `pending`;
usar el token del mensaje capturado y verificar que el documento pasa a `active` con
`activatedAt`; reutilizar el mismo token y verificar `409`; sembrar un documento pendiente con
`confirmationTokenExpiresAt` en el pasado y verificar `410` al confirmarlo.

### Tests for User Story 1

- [X] T014 [P] [US1] Test: `POST /subscribers` con una dirección nueva devuelve `202`
      `{"status":"ok"}`, crea un documento `pending` en `subscribers`, y el `EmailSender` de
      prueba capturó exactamente un mensaje cuyo contenido incluye la URL de confirmación y,
      además, los encabezados/enlace de baja (FR-001, FR-002, FR-003, FR-008) en
      `tests/http/signup.test.ts`
- [X] T015 [P] [US1] Test: usar el token de confirmación válido y vigente activa la suscripción
      (`200`, `status: "active"`, `activatedAt` presente); reutilizar el mismo token después
      devuelve `409` sin alterar el documento; un token cuyo `confirmationTokenExpiresAt` ya
      pasó devuelve `410`; un token que no corresponde a ningún documento devuelve `404`
      (FR-004, FR-005, FR-006) en `tests/http/confirmation.test.ts`

### Implementation for User Story 1

- [X] T016 [US1] Implementar `POST /subscribers` en `src/http/routes/subscribers.ts`: valida
      formato con `isValidEmailFormat` (T004) → `400 invalid_email` si no es válido; si es
      válido, crea/reutiliza el documento pendiente vía `subscriberRepository` (T009) aplicando
      la decisión de cooldown/reenvío de `subscriberLifecycle` (T006) y generando tokens con
      `tokens` (T005); construye el mensaje con `confirmationEmail` (T007) usando
      `PUBLIC_BASE_URL` para las URLs de confirmación y de baja, y lo envía con `EmailSender`
      (T008) solo cuando corresponde (alta nueva, o reenvío tras cooldown); responde siempre
      `202 {"status":"ok"}`, idéntico sin importar el estado interno (depende de T004, T005,
      T006, T007, T008, T009)
- [X] T017 [US1] Implementar `GET /subscribers/confirm/:token` en el mismo archivo: hashea el
      token (T005), busca por `confirmationTokenHash` (T009); si no existe → `404`; si
      `status === "active"` → `409`; si `status === "pending"` y
      `isConfirmationTokenExpired` (T006) → `410`; si es válido y vigente, activa (T009: fija
      `activatedAt`, quita `confirmationTokenExpiresAt`) y responde `200` (depende de T005, T006,
      T009, mismo archivo que T016)
- [X] T018 [US1] Registrar las rutas de T016/T017 en `src/http/app.ts` (depende de T011, T016,
      T017)

**Checkpoint**: User Story 1 funciona de forma independiente — T014 y T015 pasan contra la base
en memoria y el `EmailSender` de prueba.

---

## Phase 4: User Story 2 - Baja sin fricción (Priority: P2)

**Goal**: la baja se completa en un único paso, por `GET` (enlace del cuerpo) o `POST` (baja de
un clic RFC 8058), sin credenciales; elimina los datos personales y deja solo un identificador
de supresión no reversible; permite volver a suscribirse pasando de nuevo por confirmación.

**Independent Test**: usar el token de baja de un suscriptor activo (semillado directamente en
la base de prueba) por `GET`, verificar `200`, que el documento en `subscribers` ya no existe, y
que existe un documento en `suppressions` cuyo `_id` no es la dirección de correo; repetir la
misma llamada y verificar que sigue siendo `200`; repetir con `POST` y el content-type de baja
de un clic sobre un token fresco y verificar el mismo resultado; solicitar el alta de nuevo para
esa dirección y verificar que vuelve a quedar `pending`.

### Tests for User Story 2

- [X] T019 [P] [US2] Test: `GET /subscribers/unsubscribe/:token` sobre un suscriptor activo
      responde `200`, elimina el documento de `subscribers` y crea uno en `suppressions` con
      `reason: "unsubscribed"` y un `_id` no reconocible como la dirección de correo; una
      segunda llamada al mismo enlace sigue respondiendo `200` sin error (idempotente);
      `POST /subscribers/unsubscribe/:token` con `Content-Type: application/x-www-form-urlencoded`
      y cuerpo `List-Unsubscribe=One-Click` sobre un token fresco produce el mismo resultado que
      el `GET`; solicitar el alta de nuevo para la misma dirección tras la baja crea un
      documento `pending` nuevo, que requiere una nueva confirmación antes de activarse
      (FR-009, FR-010, FR-011, FR-012) en `tests/http/unsubscribe.test.ts`

### Implementation for User Story 2

- [X] T020 [US2] Implementar `GET`/`POST /subscribers/unsubscribe/:token` en
      `src/http/routes/subscribers.ts`: hashea el token (T005), busca por
      `unsubscribeTokenHash` (T009); si existe, elimina el documento y registra la supresión
      (`deleteAndSuppress`, T009, motivo `"unsubscribed"`); responde siempre `200`, exista o no
      el documento (baja idempotente, sin distinguir el caso en la respuesta) (depende de T005,
      T009, mismo archivo que T016/T017)
- [X] T021 [US2] Registrar un content-type parser propio para
      `application/x-www-form-urlencoded` en `src/http/app.ts` que resuelve sin intentar
      parsear el cuerpo (research.md §8, evita sumar `@fastify/formbody`); registrar la ruta de
      T020 para ambos métodos `GET` y `POST` (depende de T011, T020)

**Checkpoint**: User Stories 1 y 2 funcionan juntas e independientemente — el ciclo completo
alta → confirmación → baja → nueva alta queda cubierto por T014/T015/T019.

---

## Phase 5: User Story 3 - Desactivación automática por señales del canal (Priority: P3)

**Goal**: una notificación firmada del proveedor de correo sobre una dirección permanentemente
inválida o una queja de no deseado desactiva la suscripción sin intervención humana; un fallo
transitorio no tiene ningún efecto; una firma inválida se rechaza sin procesar el aviso.

**Independent Test**: enviar al webhook un evento firmado correctamente de fallo permanente
sobre un suscriptor activo semillado y verificar que el documento se elimina con una supresión
`reason: "hard_bounce"`; repetir con un evento de queja y verificar `reason: "complaint"`;
repetir con un evento de fallo transitorio y verificar que el suscriptor sigue `active`, sin
ninguna supresión creada; repetir cualquiera de los anteriores con una firma alterada y
verificar `401` y que ningún documento cambia.

### Tests for User Story 3

- [X] T022 [P] [US3] Test: `POST /webhooks/email` con firma HMAC-SHA256 válida (calculada con
      `EMAIL_WEBHOOK_SIGNING_SECRET` sobre el esquema Svix, research.md §3) y un evento de
      fallo permanente sobre un suscriptor activo semillado elimina el documento y crea una
      supresión `reason: "hard_bounce"`; el mismo evento con `type: "complaint"` produce
      `reason: "complaint"`; un evento de fallo transitorio deja el suscriptor `active` sin
      crear ninguna supresión; una firma inválida (un carácter alterado) responde `401` y no
      modifica ningún documento (FR-012, FR-013, FR-014) en `tests/http/webhook-signals.test.ts`

### Implementation for User Story 3

- [X] T023 [US3] Implementar `POST /webhooks/email` en `src/http/routes/emailWebhooks.ts`:
      recibe el cuerpo crudo (content-type parser que preserva el texto sin parsear JSON antes
      de verificar), recalcula la firma HMAC-SHA256 sobre
      `{svix-id}.{svix-timestamp}.{cuerpo crudo}` con `node:crypto.createHmac` y compara con
      `crypto.timingSafeEqual` contra el encabezado recibido → `401` si no coincide, sin
      procesar el cuerpo; si coincide, parsea el JSON, clasifica el evento con
      `classifyChannelSignal` (T006), y para `"permanent"`/`"complaint"` llama a
      `deleteAndSuppress` (T009) con el motivo correspondiente; para `"transient"`/`"ignored"`
      no hace nada; responde siempre `200` ante firma válida (research.md §3, depende de T006,
      T009)
- [X] T024 [US3] Registrar la ruta de T023 y su content-type parser de cuerpo crudo en
      `src/http/app.ts` (depende de T011, T023)

**Checkpoint**: User Story 3 funciona de forma independiente — T022 pasa; ninguna suscripción se
ve afectada por un webhook no verificado.

---

## Phase 6: User Story 4 - Protección contra abuso en el alta (Priority: P4)

**Goal**: solicitudes repetidas de alta para la misma dirección nunca generan más de un mensaje
vigente; un origen que excede el umbral de solicitudes es rechazado; la respuesta del alta es
idéntica sin importar el estado previo de la dirección; una dirección con formato inválido se
rechaza sin generar ningún envío.

**Independent Test**: solicitar el alta repetidamente para la misma dirección dentro del
cooldown y verificar que el `EmailSender` de prueba sigue teniendo un solo mensaje capturado;
generar un volumen de solicitudes desde una misma IP por encima de
`SIGNUP_RATE_LIMIT_MAX_PER_IP` y verificar `429`; comparar las respuestas de tres solicitudes
para direcciones en estados distintos (nueva, pendiente, activa) y verificar que son idénticas
en código y cuerpo; solicitar el alta con una dirección de formato inválido y verificar `400`
sin ningún mensaje capturado.

### Tests for User Story 4

- [X] T025 [P] [US4] Test: solicitudes repetidas de `POST /subscribers` para la misma dirección
      pendiente, dentro del cooldown, no agregan mensajes nuevos al `EmailSender` de prueba ni
      crean un segundo documento pendiente; un volumen de solicitudes por encima de
      `SIGNUP_RATE_LIMIT_MAX_PER_IP` desde el mismo origen dentro de
      `SIGNUP_RATE_LIMIT_WINDOW_MS` responde `429`; las respuestas (código y cuerpo) para una
      dirección nueva, una ya pendiente y una ya activa son byte a byte idénticas; una dirección
      con formato inválido responde `400` sin que el `EmailSender` de prueba capture ningún
      mensaje (FR-015, FR-016, FR-017, FR-019) en `tests/http/signup-abuse-protection.test.ts`

### Implementation for User Story 4

- [X] T026 [US4] Registrar en `src/http/app.ts` (o vía configuración de ruta en
      `src/http/routes/subscribers.ts`) un límite de tasa específico para `POST /subscribers`,
      con clave por IP y umbrales `SIGNUP_RATE_LIMIT_MAX_PER_IP`/`SIGNUP_RATE_LIMIT_WINDOW_MS`
      (T010), independiente del límite de tasa ya existente de `GET /news` (depende de T011,
      T018)
- [X] T027 [US4] Revisión y endurecimiento de `POST /subscribers` (T016): confirmar que las
      tres ramas internas (dirección nueva, pendiente dentro de cooldown, pendiente tras
      cooldown/activa) producen exactamente el mismo código y cuerpo de respuesta (FR-017),
      ajustando cualquier diferencia encontrada (depende de T016, verificado por T025)

**Checkpoint**: las 4 historias de usuario funcionan de forma independiente y en conjunto;
`npm test` cubre el ciclo completo de alta/confirmación/baja, reutilización y vencimiento de
token, verificación de firma de webhooks (válida e inválida), fallo transitorio sin
desactivación, y protección contra abuso — el mínimo pedido explícitamente por el usuario para
este feature.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: mejoras que no pertenecen a una sola historia de usuario

- [X] T028 [P] Documentar en `env.server.md` las diez variables nuevas de T003/T010 (qué son,
      formato, ejemplo), mismo estilo que las variables ya documentadas de la feature 2
- [X] T029 [P] Documentar en `README.md` el flujo de alta/confirmación/baja y un enlace a
      quickstart.md
- [X] T030 Configurar redacción de logs en Fastify (`logger.redact` o equivalente) para que
      ninguna dirección de correo aparezca en las bitácoras de `POST /subscribers`,
      `GET /subscribers/confirm/:token`, `GET`/`POST /subscribers/unsubscribe/:token` ni
      `POST /webhooks/email`; revisar que ningún mensaje de error de estas rutas incluya la
      dirección en texto (FR-020) en `src/http/app.ts`
- [ ] T031 Ejecutar quickstart.md de punta a punta contra un entorno real una vez que T001
      (dominio/DNS) y T002 (rol de Atlas) estén listos y propagados
- [X] T032 Revisión final de constitution: confirmar por grep que `src/http/routes/news.ts` y
      `src/adapters/newsReader.ts` (Artículo III, `MONGODB_READONLY_URI`) no cambiaron; que
      ningún módulo de este feature importa funciones de escritura de
      `src/adapters/repository.ts`; que no se agregó ningún `setInterval`/cron en proceso
      (Artículo II); y que `package.json` no ganó ninguna dependencia nueva (Restricción de
      stack, research.md §1/§2/§3/§8)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias de código — puede empezar de inmediato; T001/T002 son
  procesos externos de larga duración que se inician primero a propósito (research.md §4/§9)
- **Foundational (Phase 2)**: depende de Setup (T003, para los nombres de variable) — BLOQUEA
  las 4 historias de usuario; no depende de que T001/T002 hayan terminado (los tests no tocan
  Atlas ni Resend reales)
- **User Story 1 (Phase 3)**: depende de Foundational; es el MVP, sin dependencia de otras
  historias
- **User Story 2 (Phase 4)**: depende de Foundational y del archivo de rutas creado por US1
  (T016/T017, mismo `subscribers.ts`); es independiente de US3 y US4 a nivel de historia, aunque
  su test de "resuscripción" ejercita también el flujo de US1
- **User Story 3 (Phase 5)**: depende de Foundational; independiente de US1/US2/US4 (archivo
  propio, `emailWebhooks.ts`)
- **User Story 4 (Phase 6)**: depende de Foundational y de que exista `POST /subscribers`
  (T016/T018 de US1) para poder ajustarle el límite de tasa específico y revisar sus respuestas
- **Polish (Phase 7)**: depende de que las historias deseadas estén completas

### User Story Dependencies

- **User Story 1 (P1)**: solo depende de Foundational
- **User Story 2 (P2)**: extiende `subscribers.ts` creado por US1; no depende de la lógica
  interna de US3/US4
- **User Story 3 (P3)**: archivo propio (`emailWebhooks.ts`); no depende de US1/US2/US4 más
  allá de Foundational
- **User Story 4 (P4)**: ajusta y verifica la ruta que crea US1; no depende de US2/US3

### Parallel Opportunities

- Dentro de Setup: T001 y T002 son paralelas entre sí (procesos externos independientes); T003
  es paralela con ambas
- Dentro de Foundational: T004, T005, T006, T007, T008, T010 son paralelas entre sí (archivos
  distintos, sin dependencia directa entre ellas); T009 depende conceptualmente de T005 pero es
  un archivo propio; T011 y T012 son secuenciales por sus dependencias; T013 es paralela con el
  resto (archivo propio de tests)
- Cada historia de usuario tiene su(s) propio(s) archivo(s) de test nuevo(s) (T014+T015, T019,
  T022, T025), marcados `[P]` entre sí dentro de cada historia
- US3 (archivo `emailWebhooks.ts`) puede desarrollarse en paralelo con US1/US2 (archivo
  `subscribers.ts`) una vez terminado Foundational; US4 debe esperar a que exista `POST /subscribers`
  (US1)

---

## Parallel Example: Foundational

```bash
# Tareas de archivos distintos sin dependencia directa entre sí:
Task: "Implementar emailFormat.ts en src/core/emailFormat.ts"
Task: "Implementar tokens.ts en src/core/tokens.ts"
Task: "Implementar subscriberLifecycle.ts en src/core/subscriberLifecycle.ts"
Task: "Implementar confirmationEmail.ts en src/core/confirmationEmail.ts"
Task: "Implementar emailSender.ts en src/adapters/emailSender.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Fase 1: Setup (arrancar T001/T002 aunque tarden en resolverse)
2. Completar Fase 2: Foundational (bloqueante)
3. Completar Fase 3: User Story 1
4. **DETENER y VALIDAR**: correr `npm test` y confirmar el ciclo alta → confirmación completo
   (incluida reutilización y vencimiento de token) contra la base en memoria y el `EmailSender`
   de prueba
5. Desplegar/demostrar si está listo (aunque todavía sin baja, sin reacción a señales del canal,
   y sin protección de abuso más allá de la creada por Foundational)

### Incremental Delivery

1. Setup + Foundational → base lista (con T001/T002 en curso)
2. User Story 1 → probar independientemente → MVP funcional (alta + confirmación con
   consentimiento verificado)
3. User Story 2 → probar independientemente → baja sin fricción, cumple el requisito de los
   proveedores de correo
4. User Story 3 → probar independientemente → reputación del remitente protegida ante señales
   negativas del canal
5. User Story 4 → probar independientemente → superficie de abuso del alta cerrada
6. Cada historia agrega valor sin romper las anteriores

### Parallel Team Strategy

Con más de una persona disponible:

1. El equipo completa Setup + Foundational en conjunto (una persona puede dedicarse a T001/T002,
   procesos externos, mientras el resto avanza con Foundational)
2. Una vez terminado Foundational:
   - Persona A: User Story 1, luego User Story 2 (extiende el mismo `subscribers.ts`), luego
     User Story 4 (ajusta esa misma ruta)
   - Persona B: User Story 3 (`emailWebhooks.ts`, archivo propio, sin dependencia de US1/US2)
3. Las historias de A se integran secuencialmente en `subscribers.ts`/`app.ts`; la de B se
   integra en paralelo sin conflicto de archivo

---

## Notes

- [P] = archivos distintos, sin dependencias pendientes
- [Story] mapea cada tarea a su historia de usuario para trazabilidad
- Verificar que los tests fallan antes de implementar donde corresponda
- Commitear después de cada tarea o grupo lógico
- Evitar: tareas vagas, conflictos de mismo archivo marcados como [P], dependencias entre
  historias que rompan su independencia
- US2 y US4 extienden el mismo archivo (`src/http/routes/subscribers.ts`) que crea US1 — por
  eso no están marcadas [P] a nivel de implementación entre sí, aunque sus historias sean
  independientemente demostrables una vez integradas en orden. US3 vive en un archivo propio
  (`emailWebhooks.ts`) y es paralelizable con US1/US2/US4 a nivel de implementación.
