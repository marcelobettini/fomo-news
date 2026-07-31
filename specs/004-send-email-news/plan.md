# Implementation Plan: Entrega de noticias por correo a suscriptores

**Branch**: `004-send-email-news` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-send-email-news/spec.md`

## Summary

Proceso de una sola pasada (`src/notifier.ts`, mismo molde que el ingestor), invocado por cron
en cada horario de envío, que por cada suscriptor activo calcula qué noticias le corresponden —
elegibles por categoría (ya implícito, `news` solo contiene la categoría objetivo) y por fecha
de publicación posterior a su activación, no más antiguas que un vencimiento configurable — y
resta el registro de entregas ya confirmadas (`deliveries`, índice único compuesto sobre
suscriptor/noticia/canal) usando un `Set` en memoria, nunca una marca de agua temporal. Envía
solo dentro de una ventana horaria local permitida; registra cada entrega, por suscriptor,
inmediatamente después de que el adaptador de correo confirma el envío (nunca antes, nunca en
lote); trata todo resultado que no sea una confirmación explícita —incluida la ambigüedad— como
no entregado, reintentado por el propio cálculo en la corrida siguiente. Reutiliza `EmailSender`
de la feature 3 con un único cambio genérico (resultado tri-estado en vez de lanzar). Resuelve
explícitamente, con un invariante validado al arrancar (no solo documentado), la tensión entre
la retención automática de noticias del ingestor y la garantía de no purgar nada pendiente de
entrega. Descubre y resuelve, además, dos huecos reales no cubiertos por el input del usuario:
el token de baja de la feature 3 es irrecuperable por diseño y el resumen necesita reconstruirlo
(research.md §8), y borrar el historial de entregas al eliminarse un suscriptor cruza un límite
de credenciales de Mongo que hoy no lo permite (research.md §9).

## Technical Context

**Language/Version**: Node.js LTS (>=22), TypeScript 5.7 en modo estricto, ESM — mismo
`tsconfig.json` que las features 1-3.

**Primary Dependencies**: ninguna dependencia nueva. Reutiliza `mongodb` (ya instalado); el
envío sigue usando `fetch` nativo a través de `EmailSender` (feature 3, con su tipo de retorno
extendido — research.md §7); la ventana horaria y el resto de decisiones de tiempo usan
`Intl.DateTimeFormat`, igual que `localTime.ts` (features 1/2) — sin `date-fns`/`luxon`/`dayjs`.

**Storage**: MongoDB Atlas, mismo cluster que las features 1-3. Una colección nueva,
`deliveries` (data-model.md), accedida mediante una cuarta credencial de Atlas acotada
(`MONGODB_NOTIFIER_URI`, research.md §10) — lectura de `news`/`subscribers`,
lectura-escritura de `deliveries`/`locks`. El rol de `MONGODB_SUBSCRIBERS_URI` (feature 3) se
amplía para poder borrar (no leer ni escribir de otro modo) `deliveries` al eliminarse un
suscriptor (research.md §9).

**Testing**: `node:test`, dos niveles — unitario puro sobre `src/core` (elegibilidad, ventana
horaria, coherencia de retención, construcción del mensaje) y de orquestación completa
(`tests/notifier/`) contra `mongodb-memory-server` con un `EmailSender` en memoria configurable
por resultado, invocando `runDigestOnce(deps)` directamente con `now: Date` explícito por
llamada — sin red, sin Resend, sin Atlas, sin esperar al reloj real (research.md §13,
quickstart.md).

**Target Platform**: Linux ARM64, misma VM que las features 1-3, invocado por cron del sistema
operativo — no un proceso de larga vida, no una unidad `systemd` de servicio (a diferencia de
`server.ts`). Requisito de despliegue: la zona horaria del sistema operativo de esa VM debe
estar fijada a `America/Argentina/Buenos_Aires` para que las entradas de crontab se expresen en
hora local (research.md §11).

**Project Type**: cli/batch — mismo tipo que el ingestor (feature 1), no un servicio HTTP.

**Performance Goals**: sin objetivo numérico de negocio; el volumen esperado es bajo (decenas de
noticias, pocos suscriptores por corrida — instrucción explícita del usuario para justificar la
resta en memoria en vez de agregaciones de Mongo, research.md §4).

**Constraints**: ninguna dirección de correo puede aparecer en logs ni en mensajes de error,
incluidos los del registro de envíos (Artículo IV); ninguna noticia puede purgarse mientras siga
pendiente de entrega para algún suscriptor activo (FR-020, research.md §6); el proceso no debe
paralelizar ni encolar el procesamiento de suscriptores (instrucción explícita del usuario,
research.md §12); todo acceso al tiempo actual pasa por un `now: Date` explícito, nunca
`new Date()` disperso en `src/core` (research.md §2).

**Scale/Scope**: un entrypoint nuevo (`src/notifier.ts`), una colección nueva (`deliveries`),
cinco módulos nuevos de `src/core` sin I/O, y cambios acotados y aditivos a cuatro módulos ya
existentes de las features 1 y 3 (tabla completa en data-model.md) — ningún cambio a `src/http`
salvo el único call-site de `EmailSender.send()` en `subscribers.ts` y el `FakeEmailSender` de
tests. Sin interfaz web, sin horarios por suscriptor, sin otros canales (fuera de alcance de
spec.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo aborda este feature | Resultado |
|-----------|------------------------------|-----------|
| I. Integridad del flujo de noticias | Es el mandato central: lo pendiente se calcula por resta contra `deliveries`, nunca por marca de agua (research.md §4); ninguna noticia se purga mientras esté pendiente para algún activo (FR-020). La purga sigue siendo un TTL ciego de Mongo (sin cambiar `repository.ts`), compensado por un invariante de configuración **validado al arrancar**, no solo documentado (research.md §6) — cierra el TODO dejado explícitamente en `repository.ts` por la feature 1. Riesgo residual reconocido en Complexity Tracking. | PASA, con nota |
| II. Componentes desacoplados con relojes independientes | `src/notifier.ts` es un proceso de una sola pasada sin scheduler propio, invocado por cron (research.md §1); no conoce ni invoca al ingestor, al endpoint ni al proceso de suscriptores — se comunica con ellos únicamente a través de MongoDB. | PASA |
| III. Separación estricta de lectura y escritura | No aplica directamente (este feature no es el endpoint público), pero mantiene el mismo espíritu: el notifier nunca escribe `news` ni `subscribers`, solo los lee; su única escritura propia es `deliveries`/`locks`, con una credencial que no tiene permiso sobre `news` (research.md §10). | N/A / PASA por analogía |
| IV. Consentimiento verificado y entrega responsable | Solo `status === "active"` recibe algo (FR-017/018); el registro de entrega se crea únicamente después de la confirmación del canal, nunca antes (FR-011); un resultado ambiguo se trata como no entregado y se reintenta (FR-012); la deduplicación es por noticia/suscriptor/canal, garantizada por índice único de motor (research.md §3); ninguna dirección aparece en logs (data-model.md, `RunDigestSummary` sin PII); al eliminarse un suscriptor su historial de entregas se elimina con él, de forma inmediata, no diferida (research.md §9). | PASA |
| V. Los canales de entrega son adaptadores | `EmailSender` se reutiliza sin ningún campo ni regla específica del resumen; el único cambio (resultado tri-estado) es una propiedad genérica de "enviar por HTTP", no del resumen (research.md §7). `src/core/digestEmail.ts` no conoce Resend, igual que `confirmationEmail.ts`. | PASA |
| VI. Manejo explícito del tiempo | `TIMEZONE` por nombre IANA (mismo validador de las features 1-3); la ventana horaria se evalúa en hora local con `Intl.DateTimeFormat` (research.md §5); todo instante se compara en UTC; ningún `new Date()` disperso — un único `now: Date` explícito que atraviesa todo (research.md §2). | PASA |
| VII. Fallo ruidoso y degradación antes que bloqueo | Código de salida distinto de cero ante fallo de configuración/infraestructura (contracts/notifier-cli-contract.md); una configuración de retención incoherente impide arrancar en vez de degradar en silencio (research.md §6). Un fallo de envío a un suscriptor puntual **no** hace fallar la corrida completa — es un resultado esperado y ya cubierto por el reintento del propio cálculo, distinto de un fallo de la corrida en sí (mismo criterio que usa el ingestor para distinguir "cero entradas" de "una entrada individual con error"). | PASA |
| VIII. El sistema no genera contenido | El mensaje incluye título, resumen tal como lo publica la fuente y enlace al original, sin generar ni reescribir nada (FR-008); `digestEmail.ts` es una transformación de formato, no de contenido. | PASA |
| Restricción de stack | Node LTS + TypeScript estricto. **Cero dependencias nuevas** — se reutiliza `mongodb` y `fetch` nativo; la ventana horaria usa `Intl.DateTimeFormat` en vez de una biblioteca de fechas (research.md §5); la exclusión mutua reutiliza `lock.ts` de la feature 1 parametrizado, en vez de una biblioteca de locks distribuidos. | PASA |

**Resultado global**: PASA, con una excepción de Artículo I documentada explícitamente en
Complexity Tracking (riesgo residual, no eliminado, de la decisión ya tomada por el usuario de
conservar el TTL ciego en vez de una purga consciente del estado de entrega) — no una violación
sin justificar, sino un trade-off explícito con una alternativa más segura descartada por
motivos concretos.

**Re-chequeo post-diseño (Fase 1)**: revisado tras research.md, data-model.md y contracts/. Los
dos conflictos descubiertos durante el diseño (token de baja irrecuperable, borrado de entregas
cruzando credenciales) se resolvieron sin introducir ninguna excepción nueva a los ocho
artículos — el primero con una derivación determinística (mismo criterio ya usado por
`suppressions._id` en la feature 3), el segundo ampliando un rol de Atlas ya acotado en vez de
debilitar el principio de mínimo privilegio. Sigue PASA con la única nota de Artículo I ya
señalada.

## Project Structure

### Documentation (this feature)

```text
specs/004-send-email-news/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md          # Phase 1 output (/speckit-plan command)
├── contracts/               # Phase 1 output (/speckit-plan command)
│   ├── notifier-cli-contract.md
│   └── email-sender-contract.md
└── tasks.md                  # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── main.ts                          # (feature 1, sin cambios)
├── server.ts                         # (feature 2/3, sin cambios)
├── notifier.ts                        # NUEVO: entrypoint de una sola pasada (contracts/notifier-cli-contract.md)
│                                        # + exporta runDigestOnce(deps) para tests (research.md §13)
├── config/
│   ├── env.ts                          # (feature 1, sin cambios)
│   ├── serverEnv.ts                     # EXTENDIDO: + UNSUBSCRIBE_TOKEN_SECRET (research.md §8)
│   └── notifierEnv.ts                    # NUEVO: carga/valida las variables de data-model.md,
│                                          # invoca assertRetentionCoherent al final
├── core/                                   # sin I/O; se extiende, no se duplica
│   ├── localTime.ts                          # (features 1/2, sin cambios)
│   ├── tokens.ts                              # EXTENDIDO: + deriveUnsubscribeToken (research.md §8)
│   ├── subscriberLifecycle.ts                  # (feature 3, sin cambios)
│   ├── confirmationEmail.ts                     # (feature 3, sin cambios)
│   ├── digestEligibility.ts                      # NUEVO: isNewsEligible, selectPendingNews, selectForMessage
│   ├── sendWindow.ts                              # NUEVO: isWithinSendWindow
│   ├── retentionCoherence.ts                       # NUEVO: assertRetentionCoherent
│   └── digestEmail.ts                               # NUEVO: buildDigestEmail
├── adapters/
│   ├── repository.ts                        # EXTENDIDO: + getNewsPublishedAfter (aditivo)
│   ├── newsReader.ts                         # (feature 2, sin cambios)
│   ├── subscriberRepository.ts                # EXTENDIDO: + getActiveSubscribers; deleteAndSuppress
│   │                                            # también borra deliveries (research.md §9)
│   ├── lock.ts                                 # EXTENDIDO: lockId parametrizado, no fijo (research.md §1)
│   ├── deliveryRepository.ts                    # NUEVO: DELIVERIES_COLLECTION, ensureDeliveryIndexes,
│   │                                              # recordDelivery, getDeliveredNewsIds
│   └── emailSender.ts                              # EXTENDIDO: EmailSendResult tri-estado (research.md §7);
│                                                      # createConsoleEmailSender ya agregado en esta sesión
└── http/
    ├── app.ts                                        # (feature 2/3, sin cambios)
    └── routes/
        └── subscribers.ts                              # EXTENDIDO: usa deriveUnsubscribeToken; comprueba
                                                            # el resultado de emailSender.send() por valor

tests/
├── fixtures/                          # (feature 1, sin cambios)
├── unit/                               # EXTENDIDO: + tests puros de digestEligibility, sendWindow,
│                                          # retentionCoherence, digestEmail, deriveUnsubscribeToken
├── http/
│   ├── testHelpers.ts                   # EXTENDIDO: makeFakeEmailSender con resultado configurable
│   └── (resto)                           # sin cambios de comportamiento (solo el ajuste de tipo de retorno)
└── notifier/                             # NUEVO
    ├── testHelpers.ts                      # mongodb-memory-server + FakeEmailSender configurable + seeds
    ├── successive-runs.test.ts               # dos envíos sucesivos sin repetición
    ├── late-arriving-news.test.ts             # noticia con fecha anterior al último envío
    ├── duplicate-invocation.test.ts            # ejecución duplicada sin duplicados
    ├── empty-pending.test.ts                    # suscriptor sin pendientes
    ├── distinct-activations.test.ts              # dos suscriptores, conjuntos distintos
    ├── partial-channel-failure.test.ts            # falla para uno, éxito para otro
    ├── ambiguous-result.test.ts                    # reintento tras resultado ambiguo
    ├── send-window.test.ts                          # fuera/dentro de la ventana horaria
    ├── max-pending-age.test.ts                       # noticia vencida no se envía
    ├── per-message-cap.test.ts                        # tope por mensaje
    ├── updated-news-no-resend.test.ts                  # actualización tras entrega no reenvía
    ├── unsubscribed-no-send.test.ts                     # baja no recibe
    └── incoherent-retention-config.test.ts               # configuración incoherente impide arrancar
```

**Structure Decision**: un entrypoint nuevo, independiente (`src/notifier.ts`), del mismo tipo
que el ingestor (proceso de una sola pasada, sin servidor HTTP) — no se agrega una tercera
unidad de servicio `systemd` de larga vida, solo una entrada de cron más. `src/core` se extiende
con módulos nuevos y separados por responsabilidad (mismo criterio de grano que ya usan las
features 1-3: un archivo por decisión de negocio cohesiva); ningún módulo nuevo de esta feature
se mezcla con los de `news`/`subscribers` ya existentes. Los cambios a módulos de features
anteriores (tabla completa en data-model.md) son deliberadamente mínimos y aditivos donde es
posible; donde modifican algo existente (`lock.ts`, `tokens.ts`, `subscriberRepository.ts`,
`emailSender.ts`, el call-site en `subscribers.ts`), cada uno está justificado en research.md y
no cambia el comportamiento observable ya construido en las features 1-3.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|---------------------------------------|
| Artículo I: la purga de `news` sigue siendo un índice TTL ciego de Mongo, sin conocimiento del estado de entrega — el invariante de configuración (research.md §6) reduce el riesgo a un caso borde acotado, pero no lo elimina si `MAX_SEND_INTERVAL_MS` deja de reflejar la cadencia real de cron | Evita introducir un proceso/responsabilidad de purga nueva con estado propio (consultar `deliveries`/`subscribers` antes de borrar) solo para cerrar un riesgo ya acotado; es la resolución que el propio usuario evaluó y eligió explícitamente en el input de este plan | Reemplazar el TTL por una purga explícita (en el ingestor o en el notifier) que consulte `deliveries` antes de eliminar cada noticia es la alternativa que elimina el riesgo por completo, pero agrega un componente con estado adicional y una coordinación nueva entre dos procesos para un caso borde que, con el invariante validado al arrancar, ya queda acotado a una falla externa de cron (no del código de esta feature) |
