---

description: "Task list for Captura periódica de noticias con retención acotada y detección de pérdidas"
---

# Tasks: Captura periódica de noticias con retención acotada y detección de pérdidas

**Input**: Design documents from `/specs/001-news-feed-ingestion/`

**Prerequisites**: plan.md, spec.md, data-model.md, research.md, contracts/, quickstart.md

**Tests**: Requeridas por plan.md (Testing: `node:test` sobre fixtures XML, sin red) y por el
Artículo VII de la constitution (condiciones de alarma verificables). Cada historia de
usuario incluye sus propios fixtures y tests unitarios sobre `src/core`.

**Organization**: Tareas agrupadas por historia de usuario para permitir implementación y
prueba independiente de cada una.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: A qué historia de usuario pertenece (US1, US2, US3)
- Cada tarea incluye la ruta de archivo exacta

## Path Conventions

Proyecto único, según plan.md: `src/core/`, `src/adapters/`, `src/config/`, `src/main.ts`,
`tests/fixtures/`, `tests/unit/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: inicialización del proyecto

- [X] T001 Inicializar proyecto Node.js con TypeScript estricto y módulos ESM: `package.json`
      (scripts `build`, `test`, `ingest`) y `tsconfig.json` (`strict: true`, `module: "ESNext"`)
      en la raíz del repositorio
- [X] T002 [P] Agregar dependencias justificadas por research.md (`mongodb`,
      `fast-xml-parser`) y devDependencies mínimas (solo tipos, sin frameworks de test ni
      linters de terceros) en `package.json`
- [X] T003 [P] Crear el esqueleto de directorios de plan.md: `src/core/`, `src/adapters/`,
      `src/config/`, `tests/fixtures/`, `tests/unit/` con archivos `.gitkeep` o `index.ts`
      vacíos donde corresponda

**Checkpoint**: proyecto compila (`tsc --noEmit`) sin archivos fuente todavía relevantes.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: infraestructura común que TODAS las historias de usuario necesitan

**⚠️ CRITICAL**: ninguna historia de usuario puede empezar hasta terminar esta fase

- [X] T004 Implementar carga y validación de variables de entorno (cadena de conexión Mongo,
      URL del feed, categoría objetivo, zona horaria IANA, retención de noticias, retención
      de copia cruda, umbral de ausencia de categoría) en `src/config/env.ts`, usando carga
      nativa de Node, según contracts/cli-contract.md
- [X] T005 [P] Implementar ciclo de vida de conexión a MongoDB (`connect`/`disconnect`,
      `getDb`) en `src/adapters/repository.ts`, sin ORM, usando el driver oficial
- [X] T006 [P] Implementar el adaptador de exclusión mutua (adquirir/liberar el documento de
      lock `_id: "ingestor"`, con `expiresAt` de respaldo) en `src/adapters/lock.ts`, según
      data-model.md (colección `locks`) y research.md §12
- [X] T007 [P] Implementar el adaptador de fuente: descarga con `fetch` nativo y parseo del
      Atom con `fast-xml-parser` a una lista de entradas crudas (título, resumen crudo,
      enlace, fecha de publicación, fecha de actualización, categoría declarada, categoría de
      la ruta del enlace) en `src/adapters/source.ts`, según research.md §1
- [X] T008 [P] Implementar utilidades de normalización de texto: colapso de espacios/saltos
      de línea en el título y eliminación de la imagen inicial embebida del resumen (sin
      reescribir el resto del contenido) en `src/core/normalize.ts`, según research.md §14 y
      Artículo VIII. El nombre de autor, si la fuente lo provee, no se normaliza ni se
      persiste (FR-006/FR-003)
- [X] T009 [P] Implementar utilidad de conversión de instante UTC a día local, usando
      `Intl.DateTimeFormat` con el nombre de zona IANA (nunca un offset numérico) en
      `src/core/localTime.ts`, según Artículo VI
- [X] T010 Implementar el esqueleto de `src/main.ts`: cargar configuración (T004), adquirir
      el lock (T006), descargar y parsear la fuente (T007), liberar el lock en `finally`, y
      terminar con código de salida `0` en éxito o `1` ante cualquier excepción no controlada
      (se refina en fases posteriores)

**Checkpoint**: `node --env-file=.env dist/main.js` corre de punta a punta contra la fuente
real sin persistir nada todavía, y termina con el código de salida correcto ante un error de
red simulado.

---

## Phase 3: User Story 1 - Captura idempotente y filtrada por categoría (Priority: P1) 🎯 MVP

**Goal**: cada corrida incorpora únicamente las noticias nuevas de la categoría configurada,
con los campos correctos, sin duplicados ni reescritura de contenido.

**Independent Test**: ejecutar la corrida dos veces sobre el mismo fixture y verificar que el
conjunto almacenado es idéntico en ambas, y que solo contiene noticias de la categoría
objetivo con los campos esperados.

### Tests for User Story 1

- [X] T011 [P] [US1] Fixture: feed normal con entradas nuevas de la categoría objetivo en
      `tests/fixtures/normal.xml`
- [X] T012 [P] [US1] Fixture: feed con una entrada ya conocida cuyo título/resumen fue
      actualizado por la fuente en `tests/fixtures/updated-entry.xml`
- [X] T013 [P] [US1] Fixture: feed con entradas mezcladas de categorías distintas a la
      objetivo en `tests/fixtures/mixed-categories.xml`
- [X] T014 [P] [US1] Fixture: entrada con fecha de publicación de madrugada en UTC que cruza
      el límite de día local en `tests/fixtures/utc-midnight-entry.xml`
- [X] T015 [P] [US1] Test: el filtro de categoría descarta toda entrada que no sea la
      categoría objetivo en `tests/unit/category-filter.test.ts`
- [X] T016 [P] [US1] Test: la decisión de upsert distingue correctamente inserción (nueva),
      actualización (ya conocida) y no-op (sin cambios) en `tests/unit/dedup.test.ts`
- [X] T017 [P] [US1] Test: una fecha UTC de madrugada se atribuye al día local de Argentina
      correcto en `tests/unit/local-time.test.ts`

### Implementation for User Story 1

- [X] T018 [P] [US1] Implementar `mapEntryToNews`: transforma una entrada cruda en un registro
      de noticia (título normalizado, resumen sin imagen inicial, enlace, categoría, fechas)
      usando T008/T009 en `src/core/mapEntry.ts`
- [X] T019 [US1] Implementar la función pura de decisión de novedad/duplicado (dado el listado
      de entradas mapeadas y el conjunto de enlaces ya almacenados, decide inserción/
      actualización/no-op) en `src/core/dedup.ts` (depende de T018)
- [X] T020 [P] [US1] Implementar `upsertNews` en el repositorio (upsert por `_id`=enlace sobre
      la colección `news`, filtrando por categoría objetivo) en `src/adapters/repository.ts`
      (depende de T005)
- [X] T021 [US1] Conectar el pipeline de captura en `src/main.ts`: mapear entradas (T018),
      filtrar y decidir novedad (T019), persistir vía `upsertNews` (T020), y contar
      `entriesSeen`/`entriesNew` en memoria (depende de T010, T019, T020)

**Checkpoint**: User Story 1 funciona y se prueba de forma independiente — `npm test` cubre
idempotencia, filtro de categoría y atribución de día local; `node dist/main.js` ejecutado dos
veces seguidas sobre la fuente real deja `news` sin duplicados.

---

## Phase 4: User Story 2 - Retención acotada que protege las noticias de fin de día (Priority: P2)

**Goal**: las noticias se retienen el tiempo suficiente para cubrir el cruce entre el cierre
de un día local y el comienzo del siguiente, y se eliminan solas al vencer, sin código propio
de purga.

**Independent Test**: verificar que una noticia publicada cerca del final de un día local
sigue disponible en la primera corrida del día siguiente, y que una noticia más antigua que el
período de retención ya no está disponible.

### Tests for User Story 2

- [X] T022 [P] [US2] Test: `expiresAt` se calcula como `publishedAt` + retención configurada
      en `tests/unit/retention.test.ts`

### Implementation for User Story 2

- [X] T023 [US2] Extender `mapEntryToNews` (T018) para calcular y adjuntar `expiresAt` a partir
      de la retención configurada (T004) en `src/core/mapEntry.ts`
- [X] T024 [US2] Crear el índice TTL (`expireAfterSeconds: 0` sobre `expiresAt`) de la
      colección `news` en la rutina de inicialización de índices de
      `src/adapters/repository.ts` (depende de T005)
- [X] T025 [US2] Documentar en un comentario junto al índice TTL la costura hacia una futura
      feature de notificaciones (research.md §11 y plan.md Complexity Tracking: "ninguna
      noticia se elimina antes de haber sido entregada" no está cubierto por este TTL, es una
      excepción de Artículo I justificada explícitamente en plan.md) en
      `src/adapters/repository.ts`

**Checkpoint**: las noticias expiran solas vía el motor de MongoDB; verificar en Atlas que el
índice TTL existe y que una noticia con `expiresAt` vencido desaparece sin intervención de
código.

---

## Phase 5: User Story 3 - Detección de pérdidas y alarmas (Priority: P3)

**Goal**: el sistema emite una señal distinguible ante rotación completa de la ventana entre
corridas, ausencia prolongada de la categoría objetivo, y aparición de categorías nuevas; toda
corrida queda registrada y ninguna corrida sin resultados se marca exitosa.

**Independent Test**: forzar cada escenario de fuente (ventana rotada, ausencia de categoría,
categoría nueva, feed vacío, feed malformado, más entradas que el tamaño de ventana) contra
fixtures y verificar que cada uno produce la señal correspondiente y el registro de corrida
esperado.

### Tests for User Story 3

- [X] T026 [P] [US3] Fixture: respuesta de feed vacía (`entriesSeen === 0`) en
      `tests/fixtures/empty.xml`
- [X] T027 [P] [US3] Fixture: 100% de entradas nuevas, con historial de corridas previas en
      `tests/fixtures/full-rotation.xml`
- [X] T028 [P] [US3] Fixture: categoría nunca antes observada en `tests/fixtures/new-category.xml`
- [X] T029 [P] [US3] Fixture: entrada cuya categoría declarada difiere de la categoría de la
      ruta del enlace en `tests/fixtures/category-mismatch.xml`
- [X] T030 [P] [US3] Fixture: más entradas nuevas entre dos corridas que el tamaño de ventana
      simulado, para probar que la alarma de rotación completa (mismo mecanismo que T027, ver
      spec.md FR-013/FR-022) también cubre este caso, en
      `tests/fixtures/window-overflow.xml`
- [X] T031 [P] [US3] Test: una corrida con `entriesSeen === 0` se marca `status: "failure"`,
      nunca `"success"` en `tests/unit/zero-results.test.ts`
- [X] T032 [P] [US3] Test: la alarma de rotación completa de ventana se dispara cuando 100% de
      las entradas son nuevas Y existe al menos una corrida exitosa previa en
      `tests/unit/full-rotation-alarm.test.ts`
- [X] T033 [P] [US3] Test: la alarma de rotación completa se **suprime** en la primera corrida
      de la vida del sistema (sin corridas exitosas previas) en `tests/unit/first-run.test.ts`
- [X] T034 [P] [US3] Test: la alarma de ausencia prolongada de categoría se dispara cuando
      `lastTargetCategoryObservedAt` supera el umbral configurado en
      `tests/unit/category-silence.test.ts`
- [X] T035 [P] [US3] Test: una categoría nunca antes vista dispara la señal de novedad y queda
      registrada en `tests/unit/new-category.test.ts`
- [X] T036 [P] [US3] Test: una discrepancia de categoría se cuenta y se señala como anomalía
      sin bloquear el almacenamiento ni escalar a alarma de pérdida en
      `tests/unit/category-mismatch.test.ts`
- [X] T037 [P] [US3] Test: el fixture `window-overflow.xml` (T030) dispara la misma alarma de
      rotación completa que T032, confirmando que FR-013 y FR-022 son la misma condición
      observada desde dos ángulos distintos, en `tests/unit/window-overflow.test.ts`
- [X] T038 [P] [US3] Fixture: respuesta XML malformada/no parseable en
      `tests/fixtures/malformed.xml`
- [X] T039 [P] [US3] Test: una respuesta no parseable produce `status: "failure"` sin alterar
      ni eliminar documentos existentes de `news` en `tests/unit/invalid-source.test.ts`

### Implementation for User Story 3

- [X] T040 [P] [US3] Implementar `detectCategoryMismatch`: compara la categoría declarada de
      una entrada contra la categoría de la ruta de su enlace (ambas ya extraídas por T007) y
      devuelve si hay discrepancia, para alimentar `runs.categoryMismatches`, en
      `src/core/mapEntry.ts` (depende de T018)
- [X] T041 [P] [US3] Implementar la función pura de evaluación de alarmas (rotación completa
      de ventana con excepción de primera corrida —que también cubre FR-022, ver T030/T037—,
      ausencia prolongada de categoría, señal de nueva categoría) en `src/core/alarms.ts`
      (depende de T019)
- [X] T042 [US3] Implementar operaciones de repositorio para `categories` (upsert, detectar
      primera vez vista) en `src/adapters/repository.ts` (depende de T005)
- [X] T043 [US3] Implementar operaciones de repositorio para el documento singleton `state`
      (obtener/actualizar `lastTargetCategoryObservedAt`) en `src/adapters/repository.ts`
      (depende de T005)
- [X] T044 [US3] Implementar `recordRun` en el repositorio, persistiendo `status`,
      `entriesSeen`, `entriesNew`, `oldestEntryAt`, `errors`, `alarms`,
      `newCategoriesObserved` y `categoryMismatches` (este último alimentado por T040) en la
      colección `runs` en `src/adapters/repository.ts` (depende de T005)
- [X] T045 [US3] Implementar la captura de la copia cruda de diagnóstico (guardar el cuerpo
      crudo de la respuesta por corrida, incluso ante fallo de parseo) y su índice TTL corto e
      independiente en la colección `raw_snapshots` en `src/adapters/repository.ts` (depende
      de T005)
- [X] T046 [US3] Conectar en `src/main.ts` la detección de discrepancia de categoría (T040),
      la evaluación de alarmas (T041), el registro de corrida (T044), la captura de snapshot
      (T045) y las operaciones de `categories`/`state` (T042, T043); el proceso DEBE terminar
      con código de salida distinto de cero ante fallo o respuesta inválida de fuente,
      `entriesSeen === 0`, o cualquier alarma de pérdida de datos confirmada (depende de T021,
      T040, T041, T042, T043, T044, T045)

**Checkpoint**: todas las historias de usuario funcionan de forma independiente; cada
condición de alarma es verificable con fixtures sin red (incluyendo respuesta vacía y
malformada), y toda corrida queda registrada en `runs` con el código de salida correspondiente.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: mejoras que no pertenecen a una sola historia de usuario

- [X] T047 [P] Agregar `.env.example` (solo nombres de variables, sin valores secretos)
      reflejando contracts/cli-contract.md en la raíz del repositorio
- [X] T048 [P] Documentar en `README.md` cómo ejecutar `npm test` (fixtures) y
      `node --env-file=.env dist/main.js` (corrida real), enlazando a quickstart.md
- [X] T049 [P] Documentar en quickstart.md la configuración de cron y cómo calibrar su
      intervalo a partir de `runs.oldestEntryAt` (ya incorporado en quickstart.md — verificar
      que quede reflejado también en README.md)
- [X] T050 Ejecutar una revisión final de fixtures y del mapeo de entradas contra el Artículo
      VIII (ningún texto de noticia reescrito o generado) y el Artículo VI (ninguna zona
      horaria expresada como offset numérico embebido)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — puede empezar de inmediato
- **Foundational (Phase 2)**: depende de Setup — BLOQUEA todas las historias de usuario
- **User Story 1 (Phase 3)**: depende de Foundational; es el MVP, sin dependencia de otras
  historias
- **User Story 2 (Phase 4)**: depende de Foundational y de `mapEntryToNews` (T018, de US1);
  extiende el mapeo de US1 en vez de duplicarlo
- **User Story 3 (Phase 5)**: depende de Foundational y de la función de decisión de novedad
  (T019, de US1); es independiente de US2
- **Polish (Phase 6)**: depende de que las historias deseadas estén completas

### User Story Dependencies

- **User Story 1 (P1)**: solo depende de Foundational
- **User Story 2 (P2)**: reutiliza `mapEntryToNews` de US1 (T018/T023); no depende de US3
- **User Story 3 (P3)**: reutiliza la función de decisión de novedad de US1 (T019) y extiende
  `mapEntryToNews` para la discrepancia de categoría (T018/T040); no depende de US2

### Parallel Opportunities

- Dentro de Foundational: T005, T006, T007, T008, T009 son paralelas (archivos distintos)
- Dentro de US1: T011-T014 (fixtures) y T015-T017 (tests) son paralelas entre sí; T018 y T020
  son paralelas entre sí (archivos distintos); T019 depende de T018
- Dentro de US3: T026-T030 y T038 (fixtures) y T031-T037 y T039 (tests) son paralelas entre
  sí; T040 y T041 son paralelas entre sí (archivos distintos: `mapEntry.ts` vs `alarms.ts`),
  pero T042-T045 son secuenciales entre sí (mismo archivo `repository.ts`)
- Una vez terminado Foundational, US1, US2 y US3 pueden desarrollarse en paralelo por
  distintas personas, siempre que respeten el orden T018 (US1) → T023 (US2) y T018/T019 (US1)
  → T040/T041 (US3)

---

## Parallel Example: User Story 1

```bash
# Fixtures y tests de User Story 1 en paralelo:
Task: "Fixture: feed normal con entradas nuevas en tests/fixtures/normal.xml"
Task: "Fixture: feed con entrada actualizada en tests/fixtures/updated-entry.xml"
Task: "Fixture: feed con categorías mezcladas en tests/fixtures/mixed-categories.xml"
Task: "Fixture: entrada UTC de madrugada en tests/fixtures/utc-midnight-entry.xml"
Task: "Test: filtro de categoría en tests/unit/category-filter.test.ts"
Task: "Test: decisión de upsert en tests/unit/dedup.test.ts"
Task: "Test: atribución de día local en tests/unit/local-time.test.ts"

# Implementación en paralelo (archivos distintos):
Task: "Implementar mapEntryToNews en src/core/mapEntry.ts"
Task: "Implementar upsertNews en src/adapters/repository.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Fase 1: Setup
2. Completar Fase 2: Foundational (bloqueante)
3. Completar Fase 3: User Story 1
4. **DETENER y VALIDAR**: correr `npm test` y la corrida real dos veces seguidas contra la
   fuente; confirmar ausencia de duplicados y de entradas fuera de categoría
5. Desplegar/demostrar si está listo (aunque todavía sin retención automática ni alarmas)

### Incremental Delivery

1. Setup + Foundational → base lista
2. User Story 1 → probar independientemente → MVP funcional (captura idempotente)
3. User Story 2 → probar independientemente → noticias con retención automática
4. User Story 3 → probar independientemente → observabilidad y detección de pérdidas
5. Cada historia agrega valor sin romper las anteriores

### Parallel Team Strategy

Con más de una persona disponible:

1. El equipo completa Setup + Foundational en conjunto
2. Una vez terminado Foundational:
   - Persona A: User Story 1
   - Persona B: User Story 2 (espera solo a que T018 de US1 esté mergeado)
   - Persona C: User Story 3 (espera solo a que T018/T019 de US1 estén mergeados)
3. Las historias se integran de forma independiente en `src/main.ts`

---

## Notes

- [P] = archivos distintos, sin dependencias pendientes
- [Story] mapea cada tarea a su historia de usuario para trazabilidad
- Verificar que los tests fallan antes de implementar donde corresponda
- Commitear después de cada tarea o grupo lógico
- Evitar: tareas vagas, conflictos de mismo archivo marcados como [P], dependencias entre
  historias que rompan su independencia
- FR-013 y FR-022 se tratan como la misma condición detectada (ver spec.md); T030/T037
  quedan como fixture/test de regresión adicionales sobre el mismo mecanismo, no como una
  alarma separada
