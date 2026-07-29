# Implementation Plan: Alta, confirmación y baja de suscriptores por correo electrónico

**Branch**: `003-subscriber-lifecycle` | **Date**: 2026-07-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-subscriber-lifecycle/spec.md`

## Summary

Se agregan rutas de alta, confirmación, baja y recepción de señales del canal al mismo proceso
Fastify que ya expone `GET /news` (feature 2) — no un proceso nuevo. El alta crea una
suscripción `pending`; un token de confirmación de un solo uso y vencimiento corto (validado
explícitamente en código, con un índice TTL de Mongo como limpieza de fondo — research.md §5)
la activa y registra `activatedAt`. La baja, en un único paso vía `GET`/`POST` sobre el mismo
token (cubriendo tanto el enlace visible como la baja de un clic RFC 8058), elimina el
documento y deja solo un identificador HMAC no reversible en una colección de supresión
separada. Las notificaciones de rebote/queja del proveedor de correo (Resend), firmadas y
verificadas con `node:crypto` (esquema Svix, sin dependencia nueva), desactivan automáticamente
al suscriptor correspondiente si el fallo es permanente o hay queja; un fallo transitorio no
tiene efecto. El envío usa un adaptador propio (`EmailSender`) sobre la API HTTP de Resend vía
`fetch` nativo, separado del núcleo (Artículo V) para que la feature de envío periódico lo
reutilice sin acoplarse al mensaje de confirmación. El conflicto de permisos con el Artículo III
se resuelve con una **tercera** credencial de Mongo, acotada por rol a las colecciones de
suscriptores — la credencial de solo lectura de `news` de la feature 2 queda intacta.

## Technical Context

**Language/Version**: Node.js LTS (>=22), TypeScript 5.7 en modo estricto, ESM — mismo
`tsconfig.json` que las features 1 y 2.

**Primary Dependencies**: ninguna dependencia nueva. Reutiliza `fastify`, `@fastify/cors`,
`@fastify/rate-limit` y `mongodb` (todas ya instaladas por la feature 2). El envío de correo usa
`fetch` nativo de Node (research.md §2) y la verificación de firma de webhooks usa `node:crypto`
(research.md §3) — ambas decisiones evitan sumar el SDK oficial de Resend o el paquete `svix`.
La baja de un clic (RFC 8058) usa un content-type parser propio de una línea en vez de
`@fastify/formbody` (research.md §8).

**Storage**: MongoDB Atlas, mismo cluster que las features 1 y 2. Dos colecciones nuevas,
`subscribers` y `suppressions` (data-model.md), accedidas mediante una credencial de Atlas
nueva y acotada por rol (`MONGODB_SUBSCRIBERS_URI`, research.md §4) — nunca a través de
`MONGODB_READONLY_URI` (que sigue sirviendo únicamente `news`) ni de `MONGODB_URI` del
ingestor.

**Testing**: `node:test` + `fastify.inject()` (igual que la feature 2), contra
`mongodb-memory-server` para las colecciones `subscribers`/`suppressions`, con un doble en
memoria de `EmailSender` inyectado en `buildApp` (research.md §11) — sin red hacia Resend ni
hacia MongoDB Atlas durante los tests.

**Target Platform**: Linux ARM64, misma VM y mismo proceso systemd que la feature 2 — no se
agrega ninguna unidad de servicio nueva.

**Project Type**: web-service — se extiende el backend existente, sin frontend ni panel de
administración (fuera de alcance de spec.md).

**Performance Goals**: sin objetivo numérico de negocio definido; el volumen esperado es bajo
(altas/bajas/confirmaciones puntuales, no tráfico de lectura masivo como `GET /news`).

**Constraints**: `GET /news` y la conexión de solo lectura que usa deben permanecer sin cambios
(Artículo III); ninguna ruta nueva puede tocar la colección `news` ni la credencial de solo
lectura; toda notificación del proveedor DEBE verificarse por firma antes de actuar; ninguna
dirección de correo puede aparecer en logs de operación (FR-020) ni en mensajes de error;
secretos (clave de Resend, secreto de firma de webhooks, secreto de HMAC de supresión) solo por
variables de entorno, nunca versionados.

**Scale/Scope**: cuatro rutas nuevas (`POST /subscribers`, `GET /subscribers/confirm/:token`,
`GET+POST /subscribers/unsubscribe/:token`, `POST /webhooks/email`), dos colecciones nuevas,
sin paginación ni listado — ningún endpoint de consulta/administración (fuera de alcance).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo aborda este feature | Resultado |
|-----------|------------------------------|-----------|
| I. Integridad del flujo de noticias | No aplica: este feature no escribe, lee ni purga `news`; la excepción ya documentada en `repository.ts` sobre el TTL de `news` sigue diferida a la feature de envío periódico, no a esta. | N/A |
| II. Componentes desacoplados con relojes independientes | Sin scheduler propio: las rutas nuevas son disparadas por peticiones HTTP (alta, confirmación, baja) o por webhooks entrantes (señales del canal), nunca por un temporizador en el proceso. El vencimiento de tokens se decide por comparación explícita en cada petición; el TTL de Mongo es housekeeping del motor de base, no un job del proceso (research.md §5). La verificación de dominio/DNS es un paso manual externo, no un mecanismo de scheduling. | PASA |
| III. Separación estricta de lectura y escritura | `GET /news` y `MONGODB_READONLY_URI` quedan exactamente como en la feature 2, sin tocarse. Las rutas nuevas escriben, pero exclusivamente en `subscribers`/`suppressions`, a través de una credencial de Atlas separada y acotada por rol que no tiene ningún privilegio sobre `news` (research.md §4) — la restricción del artículo está scoped a "la vía de lectura de noticias", no prohíbe rutas de escritura sobre otros datos (razonamiento explícito del usuario, adoptado). | PASA |
| IV. Consentimiento verificado y entrega responsable | Es el mandato central de este feature: ninguna entrega ocurre sin doble opt-in confirmado (FR-002/FR-006), las señales negativas del canal desactivan automáticamente (FR-012/FR-013), la baja está siempre disponible y elimina los datos personales de forma efectiva (FR-009/FR-010), y el mínimo dato personal retenido tras la baja es un identificador HMAC no reversible y no derivable (research.md §7) — nunca una dirección en logs (FR-020). | PASA |
| V. Los canales de entrega son adaptadores | `EmailSender` (una sola operación, `send`) es la única superficie que conoce a Resend; el núcleo (`src/core/confirmationEmail.ts`, `subscriberLifecycle.ts`) construye contenido sin saber cómo se entrega (research.md §10). Diseñado explícitamente para que la feature de envío periódico reutilice `EmailSender` sin tocar el adaptador. | PASA |
| VI. Manejo explícito del tiempo | Todos los instantes (`activatedAt`, `confirmationTokenExpiresAt`, `lastRequestAt`, `suppressedAt`) se generan y comparan en UTC, sin offsets numéricos; a diferencia de la feature 2, este feature no tiene ninguna decisión de "día calendario local" — son comparaciones de instante contra instante, no de fecha local. | PASA |
| VII. Fallo ruidoso y degradación antes que bloqueo | Una firma de webhook inválida se rechaza explícitamente (`401`), nunca se ignora en silencio ni se procesa igual. Un fallo al escribir en Mongo durante una alta/confirmación/baja se propaga como error explícito (5xx), nunca como un `202`/`200` falso. Ningún camino trata un resultado vacío o un error de dependencia como éxito. | PASA |
| VIII. El sistema no genera contenido | No aplica: este feature no toca el contenido de ninguna noticia; los mensajes que envía (confirmación) son operativos del propio sistema de suscripción, no una republicación de una noticia de la fuente. | N/A |
| Restricción de stack | Node LTS + TypeScript estricto. **Cero dependencias nuevas** (research.md §1/§2/§3/§8): se reutilizan `fastify` y sus plugins ya instalados; el envío usa `fetch` nativo, la verificación de firma usa `node:crypto`, y la baja de un clic usa un content-type parser propio en vez de `@fastify/formbody`. | PASA |

**Resultado global**: PASA sin excepciones — ninguna violación que registrar en Complexity
Tracking. El punto que requería resolución explícita (conflicto de permisos entre Artículo III
y la necesidad de escribir) se resuelve con una credencial nueva y acotada, no con una excepción
al principio.

**Re-chequeo post-diseño (Fase 1)**: revisado tras research.md, data-model.md y contracts/. El
modelo de dos colecciones con TTL solo sobre el campo de vencimiento de confirmación (no sobre
el documento activo), el HMAC de supresión con secreto propio, y la separación
`EmailSender`/núcleo no introducen ninguna dependencia ni ruta de código que toque `news` o que
trate un fallo como éxito. Sigue PASA sin excepciones.

## Project Structure

### Documentation (this feature)

```text
specs/003-subscriber-lifecycle/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md          # Phase 1 output (/speckit-plan command)
├── contracts/               # Phase 1 output (/speckit-plan command)
│   └── subscriber-http-contract.md
└── tasks.md                  # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── main.ts                       # (feature 1, sin cambios)
├── server.ts                      # (feature 2, EXTENDIDO) construye ambas conexiones de Mongo
│                                    # (readonly + subscribers) y el EmailSender real, y los pasa a buildApp
├── config/
│   ├── env.ts                      # (feature 1, sin cambios)
│   └── serverEnv.ts                 # EXTENDIDO: nuevas variables de este feature (data-model.md)
├── core/                             # sin I/O; se extiende, no se duplica
│   ├── localTime.ts                   # (features 1/2, sin cambios) — no se usa desde este feature
│   ├── publicNews.ts                   # (feature 2, sin cambios)
│   ├── emailFormat.ts                   # NUEVO: validación de formato de correo (FR-019)
│   ├── tokens.ts                         # NUEVO: generación/hash de tokens (data-model.md)
│   ├── subscriberLifecycle.ts             # NUEVO: vencimiento, cooldown, clasificación de señales del canal
│   └── confirmationEmail.ts                # NUEVO: construcción pura del mensaje de confirmación (Artículo V)
├── adapters/
│   ├── repository.ts                        # (feature 1, sin cambios) — exclusivo del ingestor
│   ├── newsReader.ts                          # (feature 2, sin cambios) — exclusivo de `GET /news`
│   ├── subscriberRepository.ts                 # NUEVO: I/O de Mongo sobre `subscribers`/`suppressions`
│   └── emailSender.ts                            # NUEVO: interfaz `EmailSender` + implementación Resend (fetch)
└── http/
    ├── app.ts                                     # EXTENDIDO: registra las rutas nuevas; recibe la segunda
    │                                                # conexión de Mongo y el `EmailSender` como config inyectada
    └── routes/
        ├── news.ts                                 # (feature 2, sin cambios)
        ├── subscribers.ts                            # NUEVO: POST /subscribers, GET confirm/:token,
        │                                               # GET+POST unsubscribe/:token
        └── emailWebhooks.ts                             # NUEVO: POST /webhooks/email

tests/
├── fixtures/                          # (feature 1, sin cambios)
├── unit/                               # (feature 1, sin cambios)
└── http/
    ├── testHelpers.ts                    # EXTENDIDO: seed/limpieza de `subscribers`/`suppressions`,
    │                                       # fábrica de doubles de `EmailSender` (research.md §11)
    ├── today-news.test.ts                  # (feature 2, sin cambios)
    ├── cache-validators.test.ts              # (feature 2, sin cambios)
    ├── failure-mode.test.ts                   # (feature 2, sin cambios)
    ├── rate-limit.test.ts                      # (feature 2, sin cambios)
    ├── signup.test.ts                            # NUEVO US1: alta crea pending, sin doc activo hasta confirmar
    ├── confirmation.test.ts                       # NUEVO US1: ciclo completo, reutilización de token, vencimiento
    ├── unsubscribe.test.ts                         # NUEVO US2: un paso, GET+POST, eliminación, resuscripción
    ├── webhook-signals.test.ts                      # NUEVO US3: firma válida/inválida, permanente, queja, transitorio
    └── signup-abuse-protection.test.ts                # NUEVO US4: solicitudes repetidas, límite de tasa, respuestas idénticas, formato inválido
```

**Structure Decision**: mismo proyecto único y mismo proceso HTTP de la feature 2 — no se crea
un tercer entrypoint. `src/core` y `src/adapters` se extienden con módulos nuevos y separados
(nunca se mezclan con los de `news`), preservando a nivel de código la misma separación que ya
existe a nivel de credenciales: nada en `subscriberRepository.ts`/`emailSender.ts` importa ni
depende de `repository.ts`/`newsReader.ts`, y viceversa. `src/http/app.ts` es el único punto
donde ambas partes conviven, como configuración inyectada (dos conexiones de Mongo, un
`EmailSender`), nunca como acoplamiento entre los módulos de negocio.

## Complexity Tracking

*Sin violaciones que justificar: el Constitution Check no registra ninguna excepción para este
feature (ver tabla arriba). El conflicto de permisos señalado por el usuario se resuelve con una
credencial nueva y acotada (research.md §4), no con una excepción al Artículo III.*
