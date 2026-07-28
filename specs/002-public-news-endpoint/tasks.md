---

description: "Task list for Endpoint público de solo lectura de noticias del día"
---

# Tasks: Endpoint público de solo lectura de noticias del día

**Input**: Design documents from `/specs/002-public-news-endpoint/`

**Prerequisites**: plan.md, spec.md, data-model.md, research.md, contracts/, quickstart.md

**Tests**: Requeridas por plan.md (Testing: `node:test` + `fastify.inject()` contra un estado
de base preparado con `mongodb-memory-server`) y por el input explícito del usuario a
`/speckit-plan` ("Pruebas a nivel HTTP... deben cubrir al menos: respuesta correcta con datos
presentes, respuesta válida con el conjunto vacío, comportamiento de los validadores de caché,
y que el corte del día calendario se resuelva en hora local"). Cada historia de usuario incluye
sus propios tests HTTP.

**Organization**: Tareas agrupadas por historia de usuario para permitir implementación y
prueba independiente de cada una.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: A qué historia de usuario pertenece (US1, US2, US3, US4)
- Cada tarea incluye la ruta de archivo exacta

## Path Conventions

Proyecto único existente (mismo repo/tsconfig que la feature 1), con un segundo entrypoint de
proceso: `src/server.ts`, `src/http/`, `src/adapters/newsReader.ts`, `src/config/serverEnv.ts`,
extensiones de `src/core/localTime.ts`, nuevo `src/core/publicNews.ts`, `tests/http/`. No se
toca `src/main.ts` ni el resto de `src/adapters/` de la feature 1 (ver plan.md, Project
Structure).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: preparar el proyecto para un segundo proceso HTTP

- [X] T001 Agregar `fastify`, `@fastify/cors`, `@fastify/rate-limit` como dependencias y
      `mongodb-memory-server` como devDependency (research.md §1/§6/§7/§8) en `package.json`;
      agregar el script `serve` (`node --env-file=.env.server dist/src/server.js`) y extender
      el script `test` para incluir también `dist/tests/http/*.test.js`
- [X] T002 [P] Crear el esqueleto de directorios nuevos de plan.md: `src/http/`,
      `src/http/routes/`, `tests/http/` en la raíz del repositorio

**Checkpoint**: `npm run build` compila sin errores con los directorios nuevos vacíos.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: infraestructura común que las 4 historias de usuario necesitan

**⚠️ CRITICAL**: ninguna historia de usuario puede empezar hasta terminar esta fase

- [X] T003 Exportar `requireString` y `requirePositiveIntMs` desde `src/config/env.ts` (sin
      cambiar su comportamiento actual para el ingestor) para que puedan reutilizarse fuera de
      ese módulo
- [X] T004 [P] Implementar `src/config/serverEnv.ts`: carga y valida `MONGODB_READONLY_URI`,
      `TIMEZONE` (reutilizando `isValidIanaTimeZone` de `src/core/localTime.ts`), `PORT`,
      `RATE_LIMIT_MAX_PER_IP` y `RATE_LIMIT_WINDOW_MS`, reutilizando T003, sin valores por
      defecto ocultos, según data-model.md (depende de T003)
- [X] T005 [P] Extender `src/core/localTime.ts` con `localDayRangeUtc(now, timeZone)`: calcula
      `startUtc`/`endUtc` del día local vigente a partir de `now`, según research.md §5
- [X] T006 [P] Implementar `src/core/publicNews.ts`: mapeo puro `NewsDocument` → `PublicNews`
      (título, resumen, enlace, fecha de publicación), excluyendo explícitamente categoría y
      todo campo interno de bookkeeping, según data-model.md y FR-003
- [X] T007 Implementar `src/adapters/newsReader.ts`: conexión de solo lectura a MongoDB
      (reutiliza `connect()` de `src/adapters/repository.ts` con `MONGODB_READONLY_URI`) y
      `getTodayNews(db, range)`, que consulta `news` con
      `{ publishedAt: { $gte: startUtc, $lt: endUtc } }` ordenado descendente por
      `publishedAt` y mapea cada documento con T006 (depende de T004, T005, T006)
- [X] T008 [P] Implementar `src/http/app.ts`: construye la instancia Fastify y registra
      `@fastify/cors` (`origin: true`, FR-014) y `@fastify/rate-limit` (clave por IP,
      `RATE_LIMIT_MAX_PER_IP`/`RATE_LIMIT_WINDOW_MS` desde T004) como plugins; no registra
      todavía la ruta `/news`; exportado para que los tests la ejerciten con `.inject()`,
      según research.md §1/§7/§8 (depende de T004)
- [X] T009 Implementar `src/server.ts`: entrypoint del proceso — carga `serverEnv` (T004),
      abre la conexión de solo lectura (T007), construye la app (T008), escucha en `PORT`, y
      cierra la conexión de Mongo de forma ordenada ante `SIGTERM`/`SIGINT` (depende de T004,
      T007, T008)
- [X] T010 [P] Implementar `tests/http/testHelpers.ts`: arranca `mongodb-memory-server`,
      expone helpers para sembrar documentos `news` de prueba y limpiar entre tests, sin red
      hacia Atlas ni hacia la fuente real, según research.md §6

**Checkpoint**: `node --env-file=.env.server dist/src/server.js` levanta el proceso y responde
en `PORT` (`/news` todavía no existe — 404 esperado); `testHelpers.ts` levanta y limpia una
base en memoria de forma aislada.

---

## Phase 3: User Story 1 - Consulta pública de las noticias del día (Priority: P1) 🎯 MVP

**Goal**: cualquiera, sin credenciales, obtiene las noticias de la categoría configurada
publicadas durante el día local en curso, ordenadas de más reciente a más antigua.

**Independent Test**: sembrar noticias de distintos momentos del día (y del día anterior) en
la base en memoria, consultar `GET /news`, y verificar que el resultado contiene exactamente
las del día local en curso, en el orden y con los campos esperados.

### Tests for User Story 1

- [X] T011 [P] [US1] Test: `GET /news` con noticias del día ya sembradas devuelve `200` con el
      conjunto ordenado de más reciente a más antigua y los 4 campos del contrato; sin ninguna
      noticia sembrada hoy devuelve `200` con `news: []` (nunca error); y una noticia sembrada
      de madrugada UTC pero del día local anterior queda excluida del resultado (FR-001,
      FR-002, FR-006, FR-011, FR-012) en `tests/http/today-news.test.ts`

### Implementation for User Story 1

- [X] T012 [US1] Implementar la ruta `GET /news` en `src/http/routes/news.ts`: usa
      `newsReader.getTodayNews` (T007) directamente (sin caché todavía — se agrega en US3),
      arma el cuerpo `{ date, timezone, count, news }` según
      contracts/http-contract.md, con `schema` de Fastify para la serialización de la
      respuesta (depende de T007, T008)
- [X] T013 [US1] Registrar la ruta de T012 en `src/http/app.ts` (depende de T008, T012)

**Checkpoint**: User Story 1 funciona de forma independiente — T011 pasa contra la base en
memoria sembrada con distintos escenarios de día.

---

## Phase 4: User Story 2 - Un fallo nunca se confunde con un día sin noticias (Priority: P2)

**Goal**: cuando el almacenamiento es inaccesible, la respuesta es un fallo explícito —
nunca un conjunto vacío exitoso indistinguible de "todavía no hubo noticias hoy".

**Independent Test**: forzar que la conexión de solo lectura falle y verificar que `GET /news`
responde `503` con un cuerpo de error explícito, nunca `200` con `news: []`.

### Tests for User Story 2

- [X] T014 [P] [US2] Test: con la conexión de solo lectura inaccesible (simulada), `GET /news`
      devuelve `503` con `{ "error": "storage_unavailable" }`, nunca `200` con `news: []`
      (FR-007, requisito crítico del spec) en `tests/http/failure-mode.test.ts`

### Implementation for User Story 2

- [X] T015 [US2] Envolver la consulta de T007 en `src/http/routes/news.ts` con manejo
      explícito de errores de conexión/consulta a MongoDB, respondiendo `503` con el cuerpo de
      error del contrato en vez de dejar propagar una excepción no controlada (depende de
      T012)

**Checkpoint**: User Stories 1 y 2 funcionan juntas e independientemente — un vacío legítimo
(US1) y un fallo real de almacenamiento (US2) quedan distinguibles por código de estado
(`200` vs `503`).

---

## Phase 5: User Story 3 - Consultas repetidas evitan transferencias redundantes (Priority: P3)

**Goal**: dos consultas sin captura intermedia devuelven el mismo resultado, y el cliente
puede confirmarlo sin recibir de nuevo el conjunto completo; ninguna petición se traduce en
una consulta a Mongo mientras el contenido no cambió.

**Independent Test**: consultar dos veces seguidas sin sembrar cambios y verificar `ETag`
idéntico; repetir con `If-None-Match` igual al `ETag` vigente y verificar `304` sin cuerpo;
sembrar un cambio y verificar que el `ETag` cambia.

### Tests for User Story 3

- [X] T016 [P] [US3] Test: dos peticiones consecutivas sin sembrar cambios devuelven el mismo
      `ETag` y el mismo cuerpo; una petición con `If-None-Match` igual al `ETag` vigente
      devuelve `304` sin cuerpo; y tras sembrar una noticia nueva el `ETag` cambia y una
      petición con el `If-None-Match` anterior devuelve `200` con el conjunto actualizado
      (FR-008, FR-009) en `tests/http/cache-validators.test.ts`

### Implementation for User Story 3

- [X] T017 [US3] Implementar `src/http/cache.ts`: `CacheSnapshot` en memoria (noticias ya
      mapeadas, `localDayKey`, `etag` calculado con `node:crypto` `sha1` sobre una
      serialización estable del conjunto, `refreshedAt`), con refresco perezoso al vencer un
      TTL configurable o al cambiar el día local vigente, según data-model.md y research.md §3.
      Nota de implementación: agregó `CACHE_TTL_MS` a `serverEnv.ts`/data-model.md, variable
      no prevista explícitamente en el plan original
- [X] T018 [US3] Conectar `src/http/routes/news.ts` a la caché de T017 en vez de llamar a
      `newsReader` directamente en cada petición; agregar cabeceras `ETag`, `Last-Modified` y
      `Cache-Control`, y responder `304` sin cuerpo cuando `If-None-Match` coincide con el
      `ETag` vigente (depende de T012, T015, T017)

**Checkpoint**: User Story 3 funciona de forma independiente — T016 pasa; `GET /news` deja de
consultar Mongo en cada petición dentro del TTL vigente.

---

## Phase 6: User Story 4 - Acceso público protegido contra abuso (Priority: P4)

**Goal**: un origen (IP) que excede el umbral de consultas es rechazado de forma explícita y
distinguible de un fallo del servicio, sin afectar a otros orígenes.

**Independent Test**: generar consultas desde una misma IP por encima del umbral configurado y
verificar `429`, mientras otra IP sigue recibiendo respuestas normales.

### Tests for User Story 4

- [X] T019 [P] [US4] Test: un origen que supera `RATE_LIMIT_MAX_PER_IP` dentro de
      `RATE_LIMIT_WINDOW_MS` recibe `429` (distinguible de `503`), y otro origen que respeta
      el umbral sigue recibiendo respuesta normal en el mismo período (FR-010) en
      `tests/http/rate-limit.test.ts`

### Implementation for User Story 4

- [X] T020 [US4] Ajustar la configuración de `@fastify/rate-limit` registrada en T008 (clave
      explícita por IP vía `request.ip`, límites desde `serverEnv`) para que el rechazo por
      exceso sea `429` y no interfiera con la respuesta `503` de US2 ni con el `304` de US3,
      según contracts/http-contract.md (depende de T008, T018). Verificado por T019 sin
      requerir cambios de código: el hook `onRequest` de `@fastify/rate-limit` corre antes que
      el handler de la ruta, así que un `429` nunca llega a competir con el `503`/`304` que
      produce el handler

**Checkpoint**: las 4 historias de usuario funcionan de forma independiente y en conjunto;
`npm test` cubre datos presentes, conjunto vacío, corte de día local, validadores de caché y
límite de tasa — el mínimo pedido explícitamente por el usuario para este feature.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: mejoras que no pertenecen a una sola historia de usuario

- [X] T021 [P] Agregar `.env.server.example` (solo nombres de variables, sin valores) según
      data-model.md, en la raíz del repositorio. Se agregó también `!.env.server.example` a
      `.gitignore` (el patrón `.env.*` ya existente lo hubiera ocultado)
- [X] T022 [P] Documentar en `README.md` cómo correr `npm run serve` y los tests HTTP
      (`npm test`), enlazando a quickstart.md
- [X] T023 Redactar la unidad systemd (`ExecStart`, usuario del sistema, `WorkingDirectory`,
      `Restart=on-failure`) según research.md §2, documentada en quickstart.md
- [X] T024 Ejecutar una revisión final contra el Artículo III (ninguna ruta de este feature
      escribe en Mongo, dispara ingesta, o llama a la fuente externa o a otro servicio dentro
      del ciclo de una petición) y el Artículo VI (ningún offset numérico embebido; el corte
      de día siempre se resuelve en hora local, nunca comparando UTC directamente). Verificado
      por grep: cero operaciones de escritura, cero `fetch`/URLs externas, cero offsets
      numéricos embebidos en `src/http/`, `src/adapters/newsReader.ts`, `src/server.ts`,
      `src/config/serverEnv.ts`, `src/core/publicNews.ts`; los imports de `repository.ts`
      desde el lado de lectura se limitan a `connect` (genérico) y al tipo `NewsDocument` —
      ninguna función de escritura es alcanzable desde el endpoint

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — puede empezar de inmediato
- **Foundational (Phase 2)**: depende de Setup — BLOQUEA las 4 historias de usuario
- **User Story 1 (Phase 3)**: depende de Foundational; es el MVP, sin dependencia de otras
  historias
- **User Story 2 (Phase 4)**: depende de Foundational y de la ruta base de US1 (T012); es
  independiente de US3 y US4
- **User Story 3 (Phase 5)**: depende de Foundational y de la ruta base de US1/US2 (T012,
  T015); es independiente de US4
- **User Story 4 (Phase 6)**: depende de Foundational (T008) y de que la ruta ya responda
  (T018 de US3, para no pisar sus cabeceras); es la última en integrarse porque ajusta un
  plugin ya registrado en Foundational
- **Polish (Phase 7)**: depende de que las historias deseadas estén completas

### User Story Dependencies

- **User Story 1 (P1)**: solo depende de Foundational
- **User Story 2 (P2)**: extiende la ruta de US1 (T012) con manejo de errores; no depende de
  US3 ni US4
- **User Story 3 (P3)**: extiende la ruta de US1/US2 (T012/T015) con caché y validadores; no
  depende de US4
- **User Story 4 (P4)**: ajusta el plugin de límite de tasa ya registrado en Foundational
  (T008); no depende de la lógica interna de US1/US2/US3, solo de que la ruta exista

### Parallel Opportunities

- Dentro de Foundational: T005, T006 son paralelas entre sí y con T004 (archivos distintos,
  sin dependencia directa entre ellas); T007, T008, T009 son secuenciales por sus
  dependencias; T010 es paralela con todo lo anterior (archivo propio de tests)
- Cada historia de usuario tiene un único archivo de test nuevo (T011, T014, T016, T019),
  todos marcados [P] entre sí si se abordan historias distintas en paralelo
- Una vez terminado Foundational, US1 debe completarse antes de que US2/US3 tengan sentido
  (extienden la misma ruta), pero US4 solo depende de Foundational y puede desarrollarse en
  paralelo con US1-US3 hasta el punto de integración final (T020)

---

## Parallel Example: Foundational

```bash
# Tareas de archivos distintos sin dependencia directa entre sí:
Task: "Extender localTime.ts con localDayRangeUtc en src/core/localTime.ts"
Task: "Implementar publicNews.ts en src/core/publicNews.ts"
Task: "Implementar testHelpers.ts en tests/http/testHelpers.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Fase 1: Setup
2. Completar Fase 2: Foundational (bloqueante)
3. Completar Fase 3: User Story 1
4. **DETENER y VALIDAR**: correr `npm test` y confirmar `GET /news` correcto contra distintos
   estados de base sembrados (con datos, vacío, con noticias del día anterior)
5. Desplegar/demostrar si está listo (aunque todavía sin distinguir fallos de almacenamiento,
   sin caché HTTP, y sin límite de tasa)

### Incremental Delivery

1. Setup + Foundational → base lista
2. User Story 1 → probar independientemente → MVP funcional (consulta correcta)
3. User Story 2 → probar independientemente → fallos de almacenamiento explícitos
4. User Story 3 → probar independientemente → validadores de caché, sin consulta por petición
5. User Story 4 → probar independientemente → protegido contra abuso
6. Cada historia agrega valor sin romper las anteriores

### Parallel Team Strategy

Con más de una persona disponible:

1. El equipo completa Setup + Foundational en conjunto
2. Una vez terminado Foundational:
   - Persona A: User Story 1, luego User Story 2 (extiende la misma ruta)
   - Persona B: User Story 4 (solo depende de Foundational, se integra al final)
   - User Story 3 espera a que US1/US2 estén mergeadas (extiende la misma ruta)
3. Las historias se integran en `src/http/routes/news.ts` y `src/http/app.ts`

---

## Notes

- [P] = archivos distintos, sin dependencias pendientes
- [Story] mapea cada tarea a su historia de usuario para trazabilidad
- Verificar que los tests fallan antes de implementar donde corresponda
- Commitear después de cada tarea o grupo lógico
- Evitar: tareas vagas, conflictos de mismo archivo marcados como [P], dependencias entre
  historias que rompan su independencia
- US2, US3 y US4 extienden el mismo archivo (`src/http/routes/news.ts` y/o `src/http/app.ts`)
  que crea US1 — por eso no están marcadas [P] entre sí a nivel de implementación, aunque sus
  historias sean independientemente demostrables una vez integradas en orden
