---

description: "Task list for Entrega de noticias por correo a suscriptores"
---

# Tasks: Entrega de noticias por correo a suscriptores

**Input**: Design documents from `/specs/004-send-email-news/`

**Prerequisites**: plan.md, spec.md, data-model.md, research.md, contracts/, quickstart.md

**Tests**: Requeridas por plan.md (Testing: `node:test` en dos niveles — unitario puro sobre
`src/core`, y de orquestación completa contra `mongodb-memory-server` con un `EmailSender`
configurable y `now: Date` explícito) y por el input explícito del usuario a `/speckit-plan`
("Cubrir al menos" los trece escenarios listados ahí). Cada historia de usuario incluye sus
propios tests.

**Organization**: Tareas agrupadas por historia de usuario para permitir implementación y
prueba independiente de cada una.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: A qué historia de usuario pertenece (US1, US2, US3, US4)
- Cada tarea incluye la ruta de archivo exacta

## Path Conventions

Un entrypoint nuevo, `src/notifier.ts` (proceso de una sola pasada, sin servidor HTTP —
plan.md, Project Structure), que exporta `runDigestOnce(deps)` para que los tests lo inspeccionen
directamente. Se extienden `src/core/tokens.ts`, `src/adapters/lock.ts`,
`src/adapters/repository.ts`, `src/adapters/subscriberRepository.ts`,
`src/adapters/emailSender.ts` y `src/http/routes/subscribers.ts` (cambios acotados y
justificados en research.md §7/§8/§9). Se agregan módulos nuevos y separados en `src/core/`,
`src/adapters/` y `src/config/`. No se toca `src/main.ts` ni las funciones de escritura de
`src/adapters/repository.ts` que usa el ingestor, ni `src/http/routes/news.ts`.

Nota respecto de plan.md: la validación de coherencia retención/entrega (US3) resultó no
necesitar Mongo para probarse (opera solo sobre la configuración ya cargada), así que sus tests
viven en `tests/unit/` en vez de `tests/notifier/` — más preciso que la ubicación ilustrativa
del árbol de plan.md, sin cambiar ninguna decisión de research.md/data-model.md.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: arrancar cuanto antes los dos pasos operativos de Atlas (sin demora de propagación
DNS esta vez, pero sí de aprovisionamiento/coordinación humana) y dejar documentados los
nombres de variables de entorno nuevas. Ninguno de los dos primeros bloquea el desarrollo del
código (los tests usan `mongodb-memory-server`, no Atlas real).

- [ ] T001 Crear en Atlas un rol personalizado con lectura sobre `news` y `subscribers`, y
      lectura-escritura sobre `deliveries` y `locks` (sin ningún otro privilegio — nada de
      `categories`, `state`, `runs`, `raw_snapshots`, `suppressions`), crear un usuario de base
      de datos dedicado con ese rol, y obtener su connection string para
      `MONGODB_NOTIFIER_URI` (research.md §10, data-model.md)
- [ ] T002 [P] Ampliar el rol de Atlas ya asociado a `MONGODB_SUBSCRIBERS_URI` (feature 3) para
      que además permita `deleteMany` sobre `deliveries` — sin agregar lectura ni escritura de
      ningún otro tipo sobre esa colección, y sin tocar su acceso ya existente a
      `subscribers`/`suppressions` (research.md §9)
- [X] T003 [P] Crear `.env.notifier.example` con los nombres (sin valores) de las once
      variables nuevas de este feature: `MONGODB_NOTIFIER_URI`, `TIMEZONE`, `PUBLIC_BASE_URL`,
      `EMAIL_PROVIDER_API_KEY`, `EMAIL_SENDER_ADDRESS`, `UNSUBSCRIBE_TOKEN_SECRET`,
      `SEND_WINDOW_START_LOCAL`, `SEND_WINDOW_END_LOCAL`, `MAX_PENDING_AGE_MS`,
      `MAX_NEWS_PER_MESSAGE`, `MAX_SEND_INTERVAL_MS`, `NEWS_RETENTION_MS` (data-model.md), con
      un comentario breve por variable, mismo estilo que `.env.example`/`.env.server.example`
- [X] T004 [P] Agregar `UNSUBSCRIBE_TOKEN_SECRET` (sin valor) a `.env.server.example`, con un
      comentario que aclare que es un secreto compartido con `.env.notifier` (research.md §8)

**Checkpoint**: rol/usuario de `MONGODB_NOTIFIER_URI` en creación y rol de
`MONGODB_SUBSCRIBERS_URI` en ampliación (procesos externos en curso, sin bloquear lo
siguiente); ambos archivos `.env.*.example` documentan ya las variables nuevas.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: infraestructura común (núcleo puro, adaptadores, configuración y entrypoint) que
las 4 historias de usuario necesitan — a diferencia de la feature 3 (rutas HTTP separables),
esta feature es una única corrida (`runDigestOnce`) que las historias van completando por
capas, así que el esqueleto completo del proceso vive acá, sin lógica de negocio todavía.

**⚠️ CRITICAL**: ninguna historia de usuario puede empezar hasta terminar esta fase

- [X] T005 [P] Implementar en `src/core/tokens.ts` (feature 3, extendido):
      `deriveUnsubscribeToken(email: string, secret: string): string` — HMAC-SHA256 de `email`
      con `secret`, codificado base64url, mismo formato que `generateToken()` (research.md §8)
- [X] T006 [P] Implementar `src/core/digestEligibility.ts`:
      `isNewsEligible(news, subscriberActivatedAt, maxPendingAgeMs, now): boolean` y
      `selectPendingNews(eligible, deliveredNewsIds): T[]` (resta en memoria, sin `$lookup`)
      (data-model.md, research.md §4, FR-002/FR-003/FR-004/FR-018)
- [X] T007 [P] Implementar `src/core/digestEmail.ts`: `buildDigestEmail(params): EmailMessage`
      puro — título/resumen/link por noticia, HTML + texto plano, headers
      `List-Unsubscribe`/`List-Unsubscribe-Post`, y una nota que señala `publicNewsUrl` cuando
      `truncated` es `true` (FR-008/FR-009/FR-010, mismo molde que `confirmationEmail.ts`)
- [X] T008 [P] Extender `src/adapters/lock.ts` (feature 1): `LOCK_ID` deja de ser una constante
      fija; `acquireLock(db, lockId)`, `releaseLock(db, lockId)`, `ensureLockIndexes(db, lockId)`
      reciben el id como parámetro. Actualizar el único call-site existente (`src/main.ts`) para
      pasar `"ingestor"` explícito — sin cambio de comportamiento (research.md §1)
- [X] T009 [P] Extender `src/adapters/repository.ts` (feature 1): agregar
      `getNewsPublishedAfter(db, sinceInstant: Date): Promise<NewsDocument[]>` (orden
      descendente por `publishedAt`) — aditivo, nada existente cambia (data-model.md)
- [X] T010 [P] Implementar `src/adapters/deliveryRepository.ts`: `DELIVERIES_COLLECTION`,
      `DeliveryDocument`, `ensureDeliveryIndexes(db)` (índice único compuesto
      `{subscriberId, newsId, channel}`), `recordDelivery(db, {...})` (`insertOne`,
      `11000` tratado como éxito idempotente, mismo patrón que `lock.ts`),
      `getDeliveredNewsIds(db, subscriberId, channel): Promise<Set<string>>` (research.md §3,
      data-model.md)
- [X] T011 Extender `src/adapters/subscriberRepository.ts` (feature 3): agregar
      `getActiveSubscribers(db): Promise<Pick<SubscriberDocument, "_id" | "activatedAt">[]>`
      (`status === "active"`); extender `deleteAndSuppress` para además ejecutar
      `db.collection(DELIVERIES_COLLECTION).deleteMany({ subscriberId: params.email })` en la
      misma llamada (research.md §9, depende de T010 para el nombre de colección); quitar el
      campo `unsubscribeTokenHash` de `ReissueConfirmationTokenParams` (ya no rota,
      research.md §8)
- [X] T012 [P] Extender `src/adapters/emailSender.ts` (feature 3): `EmailSendResult =
      "confirmed" | "failed" | "ambiguous"`; `EmailSender.send()` pasa a devolver
      `Promise<EmailSendResult>`; `createResendEmailSender` clasifica `response.ok` →
      `"confirmed"`, respuesta HTTP no-ok → `"failed"`, `fetch()` lanza → `"ambiguous"`;
      `createConsoleEmailSender` devuelve `"confirmed"` (research.md §7,
      contracts/email-sender-contract.md)
- [X] T013 Actualizar `src/http/routes/subscribers.ts` (feature 3, único call-site existente de
      `EmailSender.send()`): usar `deriveUnsubscribeToken(email, UNSUBSCRIBE_TOKEN_SECRET)`
      (T005) en vez de `generateToken()` para el token de baja, tanto en alta nueva como en
      reemisión; comprobar el resultado devuelto por `send()` (T012) —
      `if (result !== "confirmed") throw new Error(...)`, mismo comportamiento observable que
      hoy (500 ante fallo); agregar `unsubscribeTokenSecret` a `SubscribersRouteDeps` (depende
      de T005, T011, T012)
- [X] T014 [P] Implementar `src/config/notifierEnv.ts`: `loadNotifierEnvConfig(env)` carga y
      valida las once variables de T003 reutilizando
      `requireString`/`requirePositiveInt`/`requirePositiveIntMs` de `src/config/env.ts`, sin
      valores por defecto ocultos (data-model.md) — todavía sin la aserción de coherencia
      (T032, US3)
- [X] T015 [P] Extender `tests/http/testHelpers.ts` (features 2/3): `makeFakeEmailSender` acepta
      un resultado configurable por invocación, `"confirmed"` por defecto — los tests existentes
      de las features 2/3 siguen pasando sin cambios (depende de T012 para el tipo)
- [X] T016 Crear `tests/notifier/testHelpers.ts`: `mongodb-memory-server` (mismo mecanismo que
      `tests/http/testHelpers.ts`) para `news`/`subscribers`/`deliveries`/`locks` en memoria;
      `seedActiveSubscriber`, `seedNewsForDigest`, `seedDelivery`; una versión de
      `FakeEmailSender` cuyo resultado por destinatario se decide por test (depende de T010,
      T011, T012)
- [X] T017 Crear `src/notifier.ts`: tipos `RunDigestDeps`/`RunDigestSummary` (sin direcciones de
      correo — Artículo IV); `main()` — carga config (T014), conecta con
      `MONGODB_NOTIFIER_URI`, `ensureDeliveryIndexes` (T010) y `ensureLockIndexes(db,
      "notifier")` (T008), `acquireLock(db, "notifier")` (si `false`, termina con código `0`,
      corrida omitida), llama `runDigestOnce`, `releaseLock`, cierra la conexión, fija el
      código de salida; `runDigestOnce(deps): Promise<RunDigestSummary>` exportada como no-op
      (retorna un resumen en cero, sin tocar `db`) — el cuerpo real lo completa US1 (depende de
      T008, T010, T014)

**Checkpoint**: `npm run build` compila; `npm run notify` corre de punta a punta contra
`MONGODB_NOTIFIER_URI` sin hacer nada observable todavía (no-op); ambos `testHelpers.ts` (HTTP y
notifier) están listos para que las historias de usuario escriban tests contra ellos.

---

## Phase 3: User Story 1 - Recepción confiable del resumen de noticias (Priority: P1) 🎯 MVP

**Goal**: cada suscriptor activo recibe, en una corrida, exactamente las noticias que le
corresponden por categoría (ya implícito) y por fecha de activación — con título, resumen y
enlace correctos — y queda un registro de entrega por cada una; un suscriptor sin pendientes o
sin estado activo no recibe nada.

**Independent Test**: sembrar dos suscriptores activos con `activatedAt` distintos y varias
noticias (algunas anteriores y otras posteriores a cada activación), correr `runDigestOnce`, y
verificar que cada uno recibió exactamente el conjunto que le corresponde y que existen los
`deliveries` esperados.

### Tests for User Story 1

- [X] T018 [P] [US1] Test: un suscriptor activo con `activatedAt` conocido y tres noticias
      publicadas después de esa fecha recibe un mensaje con las tres (título/resumen/link
      correctos) y quedan tres documentos en `deliveries`; una noticia publicada antes de
      `activatedAt` no aparece; dos suscriptores con `activatedAt` distintos, mismas noticias
      disponibles, reciben conjuntos distintos (FR-001, FR-002, FR-003, FR-018) en
      `tests/notifier/distinct-activations.test.ts`
- [X] T019 [P] [US1] Test: un suscriptor activo sin ninguna noticia elegible no recibe ningún
      mensaje — cero llamadas a `emailSender.send` para esa dirección (FR-007) en
      `tests/notifier/empty-pending.test.ts`
- [X] T020 [P] [US1] Test: un suscriptor `pending` (no confirmado) y uno recién dado de baja
      (sin documento en `subscribers`) no reciben nada aunque existan noticias elegibles para
      ellos (FR-017) en `tests/notifier/unsubscribed-no-send.test.ts`

### Implementation for User Story 1

- [X] T021 [US1] Completar `runDigestOnce` en `src/notifier.ts`: `getActiveSubscribers` (T011),
      `getNewsPublishedAfter(db, now - maxPendingAgeMs)` (T009); por cada suscriptor, en orden
      secuencial (research.md §12): `isNewsEligible` + `selectPendingNews` (T006) contra
      `getDeliveredNewsIds` (T010); si el resultado está vacío, continuar sin enviar; si no,
      construir la URL de baja con `deriveUnsubscribeToken` (T005) y armar el mensaje con
      `buildDigestEmail` (T007, `truncated: false` por ahora — US4 lo activa); enviar con
      `emailSender.send` (T012); si el resultado es `"confirmed"`, registrar cada entrega con
      `recordDelivery` (T010) inmediatamente, una por una, antes de pasar al siguiente
      suscriptor (FR-011/FR-014); acumular `RunDigestSummary` sin direcciones de correo (depende
      de T005, T006, T007, T009, T010, T011, T012, T017)

**Checkpoint**: User Story 1 funciona de forma independiente — T018, T019 y T020 pasan contra
`mongodb-memory-server` y el `FakeEmailSender` de `tests/notifier/testHelpers.ts`.

---

## Phase 4: User Story 2 - Continuidad tras una interrupción del envío (Priority: P2)

**Goal**: una noticia incorporada tarde (fecha de publicación anterior al último envío) se
entrega igual; ejecutar el envío dos veces no duplica nada; una falla o ambigüedad del canal
para un suscriptor puntual se reintenta en la corrida siguiente sin afectar a los demás; una
noticia actualizada tras ser entregada no genera un nuevo envío.

**Independent Test**: correr `runDigestOnce` dos veces seguidas con el mismo estado y verificar
que la segunda no genera envíos nuevos; incorporar una noticia con `publishedAt` anterior al
`now` de la corrida previa y verificar que igual se entrega en la corrida siguiente; forzar
`"failed"`/`"ambiguous"` para un suscriptor puntual y verificar que solo ese vuelve a estar
pendiente en la corrida siguiente.

### Tests for User Story 2

- [X] T022 [P] [US2] Test: `runDigestOnce` con el mismo estado, invocado dos veces con `now`
      distinto pero sin noticias/suscriptores nuevos entre medio, no genera un segundo mensaje
      para nadie (FR-004, criterio de aceptación 1) en `tests/notifier/successive-runs.test.ts`
- [X] T023 [P] [US2] Test: sembrar una noticia con `publishedAt` anterior al `now` usado en una
      corrida previa de `runDigestOnce`, después de esa corrida; una corrida posterior la
      entrega igual (FR-004, criterio de aceptación 2) en
      `tests/notifier/late-arriving-news.test.ts`
- [X] T024 [P] [US2] Test: `runDigestOnce` invocado dos veces seguidas con el **mismo** `now`
      exacto no produce mensajes duplicados (FR-013, criterio de aceptación 3) en
      `tests/notifier/duplicate-invocation.test.ts`
- [X] T025 [P] [US2] Test: `FakeEmailSender` configurado para devolver `"failed"` para un
      suscriptor y `"confirmed"` para otro en la misma corrida; una corrida siguiente entrega el
      contenido solo al primero, sin reenviar al segundo (FR-012/FR-014) en
      `tests/notifier/partial-channel-failure.test.ts`
- [X] T026 [P] [US2] Test: `FakeEmailSender` configurado para devolver `"ambiguous"` para un
      suscriptor; no se crea ningún `deliveries` para él, y una corrida siguiente reintenta esa
      noticia (FR-012) en `tests/notifier/ambiguous-result.test.ts`
- [X] T027 [P] [US2] Test: actualizar `title`/`summary` de una noticia ya presente en
      `deliveries` para un suscriptor y correr de nuevo — no se reenvía (identidad por `newsId`,
      no por contenido) (FR-016) en `tests/notifier/updated-news-no-resend.test.ts`

### Implementation for User Story 2

- [X] T028 [US2] Verificar T022-T027 contra la implementación de US1 (T021); esta propiedad
      surge del propio cálculo de pendientes (resta contra `deliveries`, research.md §4) y no
      requiere código nuevo — si algún test falla, corregir puntualmente
      `digestEligibility.ts`/`runDigestOnce` en vez de agregar una salvaguarda separada
      (instrucción explícita del usuario en el input de `/speckit-plan`)

**Checkpoint**: User Stories 1 y 2 funcionan juntas — recuperación tras interrupción, ausencia
de duplicados y reintento ante ambigüedad quedan cubiertos por T022-T027.

---

## Phase 5: User Story 3 - Protección de noticias pendientes frente a la retención (Priority: P2)

**Goal**: si la relación entre el período de retención de noticias, el intervalo máximo entre
envíos y el vencimiento máximo de pendientes es incoherente, el proceso se niega a arrancar,
antes de tocar Mongo — en vez de dejar que el TTL de `news` purgue en silencio algo todavía
pendiente de entrega.

**Independent Test**: llamar `loadNotifierEnvConfig` con valores que violen
`NEWS_RETENTION_MS > MAX_SEND_INTERVAL_MS + MAX_PENDING_AGE_MS` y verificar que lanza sin haber
abierto ninguna conexión; con valores coherentes, no lanza.

### Tests for User Story 3

- [X] T029 [P] [US3] Test: `assertRetentionCoherent` lanza cuando
      `newsRetentionMs <= maxSendIntervalMs + maxPendingAgeMs` (igualdad incluida) y no lanza
      cuando la desigualdad estricta se cumple (FR-020, research.md §6) en
      `tests/unit/retentionCoherence.test.ts`
- [X] T030 [P] [US3] Test: `loadNotifierEnvConfig` con variables que producen una relación
      incoherente lanza un error descriptivo, sin efectos secundarios; con variables coherentes,
      devuelve la configuración normalmente (FR-020) en `tests/unit/notifierEnv.test.ts`

### Implementation for User Story 3

- [X] T031 [US3] Implementar `src/core/retentionCoherence.ts`:
      `assertRetentionCoherent({ newsRetentionMs, maxSendIntervalMs, maxPendingAgeMs }): void`
      (research.md §6, data-model.md)
- [X] T032 [US3] Invocar `assertRetentionCoherent` (T031) desde `loadNotifierEnvConfig`
      (`src/config/notifierEnv.ts`, T014), inmediatamente después de parsear
      `NEWS_RETENTION_MS`/`MAX_SEND_INTERVAL_MS`/`MAX_PENDING_AGE_MS` y antes de devolver la
      configuración — así `main()` (T017) nunca llega a conectar a Mongo con una configuración
      incoherente (depende de T031, T014)

**Checkpoint**: User Stories 1-3 funcionan juntas; T029/T030 confirman que la protección de
Artículo I de esta feature (research.md §6) es un invariante verificado, no solo documentado.

---

## Phase 6: User Story 4 - Mensajes acotados, dentro de horario y con baja disponible (Priority: P3)

**Goal**: los envíos solo ocurren dentro de la ventana horaria local permitida; un mensaje con
más pendientes que el tope configurado incluye solo las más recientes y señala dónde ver el
resto; todo mensaje incluye la vía de baja, ya construida desde User Story 1 pero verificada
explícitamente acá.

**Independent Test**: correr `runDigestOnce` con `now` fuera de la ventana y verificar cero
envíos; correr con `now` dentro de la ventana y verificar que lo acumulado se entrega; sembrar
más noticias pendientes que el tope y verificar el contenido del mensaje resultante.

### Tests for User Story 4

- [X] T033 [P] [US4] Test: `runDigestOnce` con `now` fuera de
      `SEND_WINDOW_START_LOCAL`/`SEND_WINDOW_END_LOCAL` no envía nada a nadie y no toca
      `deliveries`; una corrida posterior con `now` dentro de la ventana entrega lo acumulado;
      dos corridas distintas dentro de la misma ventana en el mismo día se resuelven con el
      mismo procedimiento, sin ninguna rama de "primer envío del día" (FR-005/FR-006) en
      `tests/notifier/send-window.test.ts`
- [X] T034 [P] [US4] Test: una noticia con `publishedAt` más antiguo que `MAX_PENDING_AGE_MS`
      respecto de `now` no aparece en el mensaje de ningún suscriptor, aunque nunca se haya
      entregado (FR-002) en `tests/notifier/max-pending-age.test.ts`
- [X] T035 [P] [US4] Test: un suscriptor con más noticias pendientes que
      `MAX_NEWS_PER_MESSAGE` recibe solo las más recientes hasta el tope, con una nota que
      señala `publicNewsUrl`; las excluidas no se registran en `deliveries` y aparecen en la
      corrida siguiente si siguen vigentes; cualquier mensaje enviado incluye el enlace de baja
      (`{PUBLIC_BASE_URL}/subscribers/unsubscribe/{token}`, derivado con
      `deriveUnsubscribeToken`) y los headers `List-Unsubscribe`/`List-Unsubscribe-Post`
      (FR-009/FR-010) en `tests/notifier/per-message-cap.test.ts`

### Implementation for User Story 4

- [X] T036 [US4] Implementar `src/core/sendWindow.ts`:
      `isWithinSendWindow(now, timeZone, startLocal, endLocal): boolean` vía
      `Intl.DateTimeFormat`, sin librería de fechas (research.md §5)
- [X] T037 [US4] Extender `src/core/digestEligibility.ts` (T006):
      `selectForMessage(pendingSortedByPublishedDesc, maxPerMessage): { included, truncated }`
      (FR-009)
- [X] T038 [US4] Extender `runDigestOnce` (`src/notifier.ts`, T021): evaluar
      `isWithinSendWindow` (T036) al inicio — si es `false`, devolver el resumen vacío sin leer
      suscriptores ni noticias; aplicar `selectForMessage` (T037) antes de armar cada mensaje,
      pasando `included`/`truncated` a `buildDigestEmail` (T007) en vez del conjunto completo de
      pendientes (depende de T021, T036, T037)

**Checkpoint**: las 4 historias de usuario funcionan de forma independiente y en conjunto;
`npm test` cubre los trece escenarios pedidos explícitamente por el usuario en el input de
`/speckit-plan`.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: mejoras que no pertenecen a una sola historia de usuario

- [X] T039 [P] Documentar `env.notifier.md` (nuevo, mismo estilo que `env.md`/`env.server.md`)
      con las once variables de T003/T014
- [X] T040 [P] Documentar en `README.md` el proceso `notifier`: comando `npm run notify`,
      requisito de despliegue de zona horaria del sistema operativo (research.md §11), y enlace
      a `quickstart.md` de esta feature
- [X] T041 [P] Agregar `"notify": "node --env-file=.env.notifier dist/src/notifier.js"` y
      `"dev:notifier"` (Mongo en memoria + `createConsoleEmailSender` + datos de ejemplo con
      `activatedAt` distintos, análogo a `dev:server`) a `package.json`; crear
      `src/devNotifier.ts` si `dev:notifier` lo requiere (quickstart.md, Vía 2)
- [X] T042 Revisar que `RunDigestSummary`, los `console.error`/`console.log` de `src/notifier.ts`
      y cualquier mensaje de error a lo largo de la corrida no incluyan una dirección de correo
      en ningún punto (Artículo IV, contracts/notifier-cli-contract.md)
- [ ] T043 Ejecutar `quickstart.md` Vía 3 (corrida real contra Resend/Atlas) una vez que T001 y
      T002 estén propagados y aplicados
- [X] T044 Revisión final de constitution: confirmar por grep que `src/main.ts` y las funciones
      de escritura de `src/adapters/repository.ts` usadas por el ingestor no cambiaron de
      comportamiento; que `src/http/routes/news.ts` no cambió; que `package.json` no ganó
      ninguna dependencia nueva (Restricción de stack); que ningún `setInterval`/scheduler
      quedó en `src/notifier.ts` (Artículo II)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias de código — T001/T002 son procesos externos de Atlas que
  se inician primero a propósito; T003/T004 son inmediatas
- **Foundational (Phase 2)**: depende de Setup (T003, para los nombres de variable) — BLOQUEA
  las 4 historias de usuario; no depende de que T001/T002 hayan terminado (los tests usan
  `mongodb-memory-server`, no Atlas real)
- **User Story 1 (Phase 3)**: depende de Foundational; es el MVP, sin dependencia de otras
  historias
- **User Story 2 (Phase 4)**: depende de Foundational **y** de la implementación de US1 (T021) —
  verifica propiedades emergentes del cálculo que US1 ya construyó, no agrega un archivo nuevo
- **User Story 3 (Phase 5)**: depende de Foundational (T014); independiente de US1/US2/US4 a
  nivel de implementación (archivo propio, `retentionCoherence.ts`, y una sola línea nueva en
  `notifierEnv.ts`) — puede desarrollarse en paralelo con US1/US2
- **User Story 4 (Phase 6)**: depende de Foundational **y** de la implementación de US1 (T021,
  mismo archivo `notifier.ts` que extiende)
- **Polish (Phase 7)**: depende de que las historias deseadas estén completas

### User Story Dependencies

- **User Story 1 (P1)**: solo depende de Foundational
- **User Story 2 (P2)**: verifica el cálculo que construye US1; sin archivo de implementación
  propio más allá de una corrección puntual si algún test lo exige
- **User Story 3 (P2)**: archivo propio (`retentionCoherence.ts`) + una línea en
  `notifierEnv.ts`; no depende de US1/US2/US4 más allá de Foundational — desarrollable en
  paralelo con ambas
- **User Story 4 (P3)**: extiende el mismo `notifier.ts` que crea US1 y el mismo
  `digestEligibility.ts` que crea Foundational; no depende de US2/US3

### Parallel Opportunities

- Dentro de Setup: T001 y T002 son paralelas entre sí (procesos externos independientes); T003 y
  T004 son paralelas con ambas y entre sí
- Dentro de Foundational: T005, T006, T007, T008, T009, T010, T012, T014, T015 son paralelas
  entre sí (archivos distintos, sin dependencia directa entre ellas); T011 depende
  conceptualmente de T010 pero es un archivo propio; T013 depende de T005/T011/T012; T016
  depende de T010/T011/T012; T017 depende de T008/T010/T014
- Los tests de cada historia de usuario están marcados `[P]` entre sí dentro de esa historia
  (archivos distintos)
- US3 (`retentionCoherence.ts`) puede desarrollarse en paralelo con US1/US2 una vez terminado
  Foundational; US4 debe esperar a que exista `runDigestOnce` (US1, T021) porque extiende el
  mismo archivo y la misma función

---

## Parallel Example: Foundational

```bash
# Tareas de archivos distintos sin dependencia directa entre sí:
Task: "Implementar deriveUnsubscribeToken en src/core/tokens.ts"
Task: "Implementar digestEligibility.ts en src/core/digestEligibility.ts"
Task: "Implementar digestEmail.ts en src/core/digestEmail.ts"
Task: "Parametrizar lockId en src/adapters/lock.ts"
Task: "Implementar getNewsPublishedAfter en src/adapters/repository.ts"
Task: "Implementar deliveryRepository.ts en src/adapters/deliveryRepository.ts"
Task: "Extender emailSender.ts con EmailSendResult en src/adapters/emailSender.ts"
Task: "Implementar notifierEnv.ts en src/config/notifierEnv.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Fase 1: Setup (arrancar T001/T002 aunque tarden en resolverse)
2. Completar Fase 2: Foundational (bloqueante)
3. Completar Fase 3: User Story 1
4. **DETENER y VALIDAR**: correr `npm test` y confirmar que un suscriptor activo recibe
   exactamente lo que le corresponde, con su historial de entrega registrado
5. Desplegar/demostrar si está listo (aunque todavía sin ventana horaria, sin tope por mensaje,
   y sin el invariante de retención verificado — el TTL de `news` queda con la protección solo
   documentada, no reforzada, hasta completar US3)

### Incremental Delivery

1. Setup + Foundational → base lista (con T001/T002 en curso)
2. User Story 1 → probar independientemente → MVP funcional (contenido correcto, sin
   repeticiones, por suscriptor)
3. User Story 2 → probar independientemente → confirma que la recuperación tras una
   interrupción y la ausencia de duplicados ya funcionan
4. User Story 3 → probar independientemente → cierra la excepción de Artículo I con un
   invariante verificado al arrancar
5. User Story 4 → probar independientemente → ventana horaria, tope por mensaje y baja
   disponible, listo para producción
6. Cada historia agrega valor sin romper las anteriores

### Parallel Team Strategy

Con más de una persona disponible:

1. El equipo completa Setup + Foundational en conjunto
2. Una vez terminado Foundational:
   - Persona A: User Story 1, luego User Story 4 (extiende el mismo `notifier.ts`)
   - Persona B: User Story 3 (`retentionCoherence.ts`, archivo propio, en paralelo con A)
   - User Story 2 no requiere trabajo dedicado — sus tests corren tan pronto A termina US1
3. Las tareas de A se integran secuencialmente en `notifier.ts`; las de B se integran en
   paralelo sin conflicto de archivo

---

## Notes

- [P] = archivos distintos, sin dependencias pendientes
- [Story] mapea cada tarea a su historia de usuario para trazabilidad
- Verificar que los tests fallan antes de implementar donde corresponda
- Commitear después de cada tarea o grupo lógico
- Evitar: tareas vagas, conflictos de mismo archivo marcados como [P], dependencias entre
  historias que rompan su independencia
- US4 extiende el mismo archivo (`src/notifier.ts`) que crea US1 — por eso no está marcada [P]
  respecto de US1 a nivel de implementación, aunque su historia sea independientemente
  demostrable una vez integrada. US3 vive en un archivo propio (`retentionCoherence.ts`) y es
  paralelizable con US1/US2 a nivel de implementación. US2 no tiene archivo de implementación
  propio: verifica propiedades que ya emergen del cálculo de US1 (research.md §4), instrucción
  explícita del usuario ("esta propiedad debe surgir del propio cálculo y no de una
  salvaguarda añadida").
