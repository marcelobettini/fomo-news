# Implementation Plan: Endpoint público de solo lectura de noticias del día

**Branch**: `002-public-news-endpoint` | **Date**: 2026-07-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-public-news-endpoint/spec.md`

## Summary

Un segundo proceso, independiente del ingestor de la feature 1, expone vía HTTP público y sin
autenticación las noticias de la categoría configurada publicadas durante el día calendario
local de Argentina en curso. Es un servidor Fastify de larga vida (systemd, reinicio
automático), con credenciales de MongoDB de **solo lectura** a nivel de infraestructura, que
nunca dispara ingesta ni llama a la fuente externa. Para no traducir cada petición en una
consulta a la base, mantiene una caché en memoria del conjunto del día y emite validadores de
caché HTTP (`ETag`/`Last-Modified`) calculados con la librería estándar (`node:crypto`).
Protegido con límite de tasa por IP y CORS abierto, ambos vía plugins de primera parte de
Fastify. Reutiliza el tipo `NewsDocument` y las utilidades de zona horaria ya definidos por la
feature 1 en lugar de redeclararlos.

## Technical Context

**Language/Version**: Node.js LTS (>=22), TypeScript 5.7 en modo estricto, ESM — mismo
`tsconfig.json` que la feature 1 (`target: ES2022`, `module`/`moduleResolution: NodeNext`).

**Primary Dependencies**: Fastify (servidor HTTP; validación y serialización de respuesta vía
JSON Schema nativo, sin librería de validación aparte), `@fastify/cors` y
`@fastify/rate-limit` (plugins de primera parte), `mongodb` (driver oficial, ya usado por la
feature 1).

**Storage**: MongoDB Atlas, mismo cluster que la feature 1, colección `news` ya existente
(**solo lectura**: usuario de base dedicado con rol `read`, cadena de conexión propia y
distinta de la del ingestor).

**Testing**: `node:test` (igual que la feature 1) + `fastify.inject()` para ejercitar rutas
HTTP sin abrir un puerto real; `mongodb-memory-server` (devDependency, ver research.md §6) para
tener un estado de base preparado y aislado, sin red hacia Atlas ni hacia la fuente real.

**Target Platform**: Linux ARM64, misma VM que la feature 1. A diferencia del ingestor, es un
proceso de larga vida gestionado como servicio del sistema (systemd, `Restart=on-failure`); no
incorpora ninguna tarea planificada propia.

**Project Type**: web-service — backend puro, sin frontend ni panel de administración.

**Performance Goals**: sin objetivo numérico de negocio definido; el diseño evita una consulta
a MongoDB por petición (caché en memoria) para un volumen esperado de decenas de noticias por
día con tráfico público de volumen variable.

**Constraints**: NUNCA escribe, NUNCA dispara ingesta, NUNCA llama a la fuente externa ni a
ningún servicio externo dentro del ciclo de una petición (Artículo III de la constitution);
debe responder con éxito aunque la fuente esté caída o la ingesta lleve horas sin correr;
restricción de solo lectura impuesta también a nivel de infraestructura (credenciales de
base).

**Scale/Scope**: un único endpoint de lectura, sin paginación, filtros, orden ni búsqueda —
respuesta fija; volumen esperado de decenas de noticias por día; acceso público sin
autenticación, protegido por límite de tasa por IP.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo aborda este feature | Resultado |
|-----------|------------------------------|-----------|
| I. Integridad del flujo de noticias | No aplica a la escritura/pérdida de datos (eso ya lo resuelve la feature 1); este feature solo expone una vista de lectura sobre lo ya capturado, sin alterar retención ni deduplicación. | N/A |
| II. Componentes desacoplados con relojes independientes | Proceso separado del ingestor, con su propio ciclo de vida (systemd). Ningún componente invoca al otro; se comunican únicamente a través de la base de datos compartida. Sin scheduler propio: responde a petición, no ejecuta tareas periódicas. | PASA |
| III. Separación estricta de lectura y escritura | Es el mandato central del feature: nunca escribe, nunca dispara ingesta, nunca llama a la fuente externa ni a ningún servicio externo dentro del ciclo de una petición, y responde aunque la fuente esté caída. Reforzado a nivel de infraestructura con credenciales de base de solo lectura (research.md §4). | PASA |
| IV. Consentimiento verificado y entrega responsable | No aplica: este feature no incluye suscriptores ni entrega dirigida a nadie en particular. | N/A |
| V. Los canales de entrega son adaptadores | No aplica: no es un canal de notificación/entrega, es una consulta pública de extracción de datos ya definidos por la feature 1 (mismos campos de negocio, sin formato específico de un canal). | N/A |
| VI. Manejo explícito del tiempo | Zona horaria por nombre IANA reutilizada de la feature 1 (`TIMEZONE`, `src/core/localTime.ts`); el corte de "día en curso" se calcula en hora local con `Intl`, nunca comparando fechas en UTC directamente (FR-011/FR-012). | PASA |
| VII. Fallo ruidoso y degradación antes que bloqueo | Requisito explícito y verificable del feature: un conjunto vacío exitoso ("sin noticias todavía") nunca puede confundirse con un fallo de acceso a los datos, que debe ser explícito y distinguible (FR-006/FR-007). | PASA |
| VIII. El sistema no genera contenido | El resumen expuesto es exactamente el ya capturado por la ingesta; no hay reescritura ni generación (FR-013). | PASA |
| Restricción de stack | Node LTS + TypeScript estricto. Dependencias nuevas justificadas una por una en research.md: Fastify + sus plugins de primera parte (evitan una librería de validación y un cliente HTTP de terceros), driver oficial de MongoDB (ya en uso), y `mongodb-memory-server` como devDependency exclusiva de tests (research.md §6). Sin ORM, sin librería de fechas — conversión de zona horaria con `Intl`. | PASA |

**Resultado global**: PASA sin excepciones — ningún principio requiere justificarse como
violación (a diferencia de la feature 1, este feature no necesita ninguna excepción del
Artículo I).

**Re-chequeo post-diseño (Fase 1)**: revisado tras research.md, data-model.md y contracts/. La
decisión de caché en memoria con invalidación por TTL/cambio de día local, la separación de
credenciales de solo lectura, y la reutilización de `NewsDocument`/`src/core/localTime.ts` no
introducen ninguna dependencia ni comportamiento fuera de lo evaluado arriba. Sigue PASA sin
excepciones.

## Project Structure

### Documentation (this feature)

```text
specs/002-public-news-endpoint/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── main.ts                    # (feature 1, sin cambios) entrypoint del ingestor
├── server.ts                  # NUEVO: entrypoint del endpoint (target de systemd), construye
│                               # la app Fastify y escucha en PORT
├── config/
│   └── env.ts                 # (feature 1) se exportan `requireString`/`requirePositiveIntMs`
│                               # para que server-env.ts los reutilice sin duplicar parsing
│   └── serverEnv.ts           # NUEVO: valida las env vars propias del endpoint (ver data-model.md)
├── core/                       # sin I/O; se extiende, no se duplica
│   ├── localTime.ts           # (feature 1) se agrega `localDayRangeUtc()` (corte de día local)
│   ├── mapEntry.ts            # (feature 1, sin cambios) — no se usa desde el endpoint
│   └── publicNews.ts          # NUEVO: mapeo puro NewsDocument → PublicNews (4 campos expuestos)
├── adapters/
│   ├── repository.ts          # (feature 1, sin cambios) — lado de escritura, exclusivo del ingestor
│   ├── source.ts               # (feature 1, sin cambios) — exclusivo del ingestor
│   ├── lock.ts                  # (feature 1, sin cambios) — exclusivo del ingestor
│   └── newsReader.ts            # NUEVO: única consulta de solo lectura (rango del día) sobre `news`
└── http/                        # NUEVO, exclusivo de este feature
    ├── app.ts                   # construye la instancia Fastify (rutas + plugins), exportado
    │                            # para que los tests la ejerciten con `.inject()`
    ├── routes/
    │   └── news.ts               # GET /news
    └── cache.ts                   # caché en memoria + cálculo de ETag (research.md §3)

tests/
├── fixtures/                     # (feature 1, sin cambios) — fixtures XML del ingestor
├── unit/                          # (feature 1, sin cambios)
└── http/                           # NUEVO
    ├── testHelpers.ts               # arranca mongodb-memory-server y siembra documentos `news`
    ├── today-news.test.ts            # US1/US2: datos presentes, conjunto vacío, corte de día local
    ├── cache-validators.test.ts       # US3: ETag/If-None-Match, 304
    └── failure-mode.test.ts            # US2: almacenamiento inaccesible → fallo explícito
```

**Structure Decision**: proyecto único existente (mismo repo, mismo `tsconfig.json`), con dos
entrypoints de proceso independientes (`main.ts` para el ingestor, `server.ts` nuevo para el
endpoint) que nunca se invocan entre sí y solo comparten la base de datos. `src/core` se
extiende (nunca se redeclara) para reutilizar el modelo de datos y las utilidades de zona
horaria de la feature 1; todo el código exclusivo de este feature (HTTP, caché, consulta de
solo lectura, env propia) vive en módulos nuevos y separados de los del ingestor, preservando
la separación de lectura/escritura también a nivel de código, no solo de proceso.

## Complexity Tracking

*Sin violaciones que justificar: el Constitution Check no registra ninguna excepción para
este feature (ver tabla arriba).*
