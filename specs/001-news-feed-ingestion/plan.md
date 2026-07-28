# Implementation Plan: Captura periódica de noticias con retención acotada y detección de pérdidas

**Branch**: `001-news-feed-ingestion` | **Date**: 2026-07-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-news-feed-ingestion/spec.md`

## Summary

Proceso de una sola pasada (invocado por cron del sistema, nunca por un scheduler interno)
que consulta el feed Atom de la fuente, filtra por categoría configurada, incorpora de forma
idempotente las noticias nuevas y actualiza las existentes, evalúa las tres condiciones de
alarma del artículo VII, registra el resultado de la corrida y termina con código de salida
distinto de cero ante fallo o pérdida de datos detectada. La retención se delega a un índice
TTL de MongoDB sobre una fecha de expiración calculada por noticia; no hay purga en código
propio. La exclusión mutua entre corridas solapadas se implementa como un lock optimista en la
misma base de datos, sin dependencias adicionales.

## Technical Context

**Language/Version**: Node.js LTS (>=22), TypeScript en modo estricto, módulos ESM

**Primary Dependencies**: `mongodb` (driver oficial, sin ODM/ORM) y un parser de XML/Atom
(ver research.md — imprescindible porque el feed es Atom y no existe parser en la biblioteca
estándar de Node). Sin cliente HTTP de terceros (`fetch` nativo), sin biblioteca de fechas
(`Intl` nativo), sin gestor de variables de entorno (carga nativa de Node), sin ORM.

**Storage**: MongoDB Atlas (cluster gratuito), accedido con el driver oficial

**Testing**: `node:test` (test runner nativo de Node, sin dependencia de terceros), ejecutado
sobre fixtures XML guardados en el repositorio, sin red

**Target Platform**: VM Linux ARM64 siempre encendida; el proceso se invoca periódicamente
por cron del sistema operativo — el proceso mismo NO es un servidor ni programa nada
internamente

**Project Type**: Ejecutable de una sola pasada (single-pass CLI process), no un servicio web

**Performance Goals**: Sin metas de throughput — el volumen es acotado por el tamaño de
ventana de la fuente (últimas ~20 publicaciones) y una única categoría; el requisito real es
que cada corrida termine holgadamente dentro del intervalo entre invocaciones de cron

**Constraints**: Debe ejecutar y terminar (no dejar handles abiertos); no debe planificar
nada dentro del proceso; debe salir con código distinto de cero ante fallo o pérdida de datos
confirmada; dos corridas no deben solaparse; ninguna dependencia fuera de las justificadas en
research.md

**Scale/Scope**: Una única fuente, una única categoría configurada, ventana de la fuente de
tamaño fijo (~20 ítems); este feature cubre exclusivamente el componente ingestor

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación | Resultado |
|---|---|---|
| I. Integridad del flujo de noticias | La cadencia de ingesta la fija la ventana de la fuente (calibrada empíricamente vía run log), no la conveniencia de notificación (que no existe en este feature). La detección de "ya conocida" se hace por identidad estable (enlace) contra lo ya almacenado, nunca por marca de agua temporal — ver research.md, decisión de deduplicación. | EXCEPCIÓN JUSTIFICADA (ver Complexity Tracking) |
| II. Componentes desacoplados con relojes independientes | El proceso es de una sola pasada, sin scheduler interno; la periodicidad la impone cron, externo al proceso. No invoca ni conoce al endpoint ni al notificador (no existen aún). | PASA |
| III. Separación estricta de lectura y escritura | No aplica: este feature no incluye endpoint de lectura. | N/A |
| IV. Consentimiento verificado y entrega responsable | No aplica: este feature no incluye suscriptores ni entrega. | N/A |
| V. Los canales de entrega son adaptadores | No aplica: este feature no incluye canales de entrega. | N/A |
| VI. Manejo explícito del tiempo | Zona horaria configurada por nombre de región (IANA, ej. `America/Argentina/Buenos_Aires`), nunca por offset numérico; conversión con `Intl`. Instantes almacenados en UTC; el día local se deriva con `Intl.DateTimeFormat` al momento de decidir, nunca comparando fechas en UTC. | PASA |
| VII. Fallo ruidoso y degradación antes que bloqueo | Toda corrida registra su resultado; una corrida con cero entradas vistas (no cero nuevas) nunca se marca exitosa; las tres condiciones de alarma se evalúan siempre al final de la corrida y quedan en el registro; un fallo de la fuente no corrompe lo almacenado y permite recuperación automática en la corrida siguiente. | PASA |
| VIII. El sistema no genera contenido | Se conserva el resumen tal como lo publica la fuente; la única transformación es eliminar la imagen inicial embebida y normalizar espacios — ninguna reescritura ni generación de texto. | PASA |
| Restricción de stack | Node LTS + TypeScript estricto. Cada dependencia (`mongodb`, parser XML) está justificada en research.md; se prefiere la biblioteca estándar (`fetch`, `Intl`, carga nativa de env, `node:test`) en todo lo demás. Sin ORM. | PASA |

**Resultado global**: PASA con una excepción justificada y documentada (Artículo I, ver
Complexity Tracking).

**Re-chequeo post-diseño (Fase 1)**: revisado tras research.md, data-model.md y
contracts/. El diseño de colecciones (`news`, `runs`, `categories`, `raw_snapshots`,
`state`, `locks`) y las decisiones de deduplicación por upsert, TTL para retención, lock
optimista en Mongo y separación core/adapters no introducen ninguna dependencia ni
comportamiento fuera de lo evaluado arriba. Sigue vigente la misma excepción justificada de
Artículo I; ninguna decisión de diseño nueva la agrava ni la resuelve.

## Project Structure

### Documentation (this feature)

```text
specs/001-news-feed-ingestion/
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
├── core/                 # Lógica pura, sin I/O: parseo de entradas ya deserializadas,
│                         # normalización de texto, decisión de novedad/duplicado,
│                         # evaluación de las tres condiciones de alarma, validación
│                         # cruzada de categoría. Testeable sin red y sin Mongo.
├── adapters/
│   ├── source.ts         # Descarga y parseo del feed Atom (fetch nativo + parser XML)
│   ├── repository.ts     # Acceso a MongoDB: colecciones news, runs, categories,
│                         # raw_snapshots, locks (driver oficial, sin ORM)
│   └── lock.ts           # Exclusión mutua vía documento de lock en MongoDB
├── config/
│   └── env.ts            # Lectura y validación de variables de entorno (carga nativa)
└── main.ts               # Punto de entrada: una sola pasada, orquesta adapters + core,
                           # define el código de salida del proceso

tests/
├── fixtures/              # XML/Atom guardados: corrida normal, ráfaga, categoría
│                          # cruzada inconsistente, categoría nueva, ventana rotada por
│                          # completo, primera corrida (sin histórico), fuente inválida/
│                          # vacía, entrada sin cuerpo, resumen sin imagen inicial
└── unit/                  # node:test sobre src/core contra los fixtures, sin red
```

**Structure Decision**: Proyecto único (no hay frontend/backend ni apps móviles). Se separa
`core` (lógica pura, testeable con fixtures sin red ni base de datos) de `adapters` (I/O:
fuente HTTP, MongoDB, lock) para poder cumplir el requisito de pruebas sin red sin necesitar
un servidor Mongo en memoria ni mocks de infraestructura pesados. `main.ts` es el único lugar
que compone ambos y termina el proceso con el código de salida correspondiente.

## Complexity Tracking

| Violación | Por qué es necesaria | Alternativa más simple rechazada |
|-----------|------------|-------------------------------------|
| El índice TTL de `news` purga por tiempo sin verificar si la noticia fue entregada (Artículo I: "ninguna noticia se elimina antes de haber sido entregada a todos los suscriptores activos") | Este feature no incluye notificador ni suscriptores; no existe todavía una entrega real que proteger, y el Artículo I no distingue ese caso en su redacción actual | Condicionar el TTL a un campo de estado de entrega que ningún componente actual produce sería construir infraestructura para un consumidor inexistente (sobre-ingeniería); se acepta el riesgo documentado en vez de bloquear este MVP. Esta excepción DEBE revisarse obligatoriamente cuando se implemente la primera feature de notificaciones (ver research.md §11) |
