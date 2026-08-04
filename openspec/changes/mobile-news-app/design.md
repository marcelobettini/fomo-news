## Context

Este es el primer change de OpenSpec sobre `fomo-news`, un repo cuyo backend (Fastify +
MongoDB) fue construido con SpecKit — sus specs viven en `specs/002-public-news-endpoint` y
`specs/003-subscriber-lifecycle`, con contratos HTTP explícitos en `contracts/*.md`. Es un
flujo brownfield: el backend es terreno existente de solo lectura, no se toca ni se migra a
`openspec/specs/`.

El objetivo es una app mobile mínima, probada solo en Expo Go sobre Simulador de iOS (host
macOS), sin build de producción. No hay equipo ni usuarios reales todavía — es una prueba de
consumo de la API pública ya construida.

## Goals / Non-Goals

**Goals:**

- Consumir `GET /news` y mostrarlas en una lista, respetando la semántica del backend
  (vacío ≠ error, `503` explícito, condicional GET con `ETag`).
- Permitir que cualquier usuario se suscriba con un email válido vía `POST /subscribers`,
  comunicando con claridad que la confirmación ocurre por correo, fuera de la app.
- Mantener `app-mobile/` como paquete Node/Expo autocontenido, sin interferir con el toolchain
  del backend en la raíz (distinto `package.json`, distinto test runner).

**Non-Goals:**

- Deploy o build de producción (EAS, stores, TestFlight).
- Pantallas de confirmación o unsubscribe dentro de la app.
- Soporte Android o dev build nativo — Expo Go alcanza porque no hay deep linking ni módulos
  nativos en juego.
- Autenticación, navegación multi-pantalla, o persistencia local del estado de suscripción.
- Cualquier cambio al backend o a sus contratos.

## Decisions

**Un paquete Expo separado en `mobile/`, no un monorepo con workspaces.**
El repo raíz ya es un paquete Node plano (`type: module`, `node --test`, sin
`workspaces` en `package.json`). Meter Expo en la raíz pisaría ese `package.json`/
`tsconfig.json` y mezclaría dos toolchains incompatibles (Metro/Jest vs `tsc`/`node --test`).
Alternativa descartada: repo separado — agrega fricción (otro remoto, sincronizar contratos a
mano) sin beneficio real para un POC sin CI ni deploy.

**Una sola pantalla, sin librería de navegación.**
Lista de noticias + formulario de suscripción conviven en la misma vista. No se suma
React Navigation/Expo Router: con una sola pantalla no resuelve ningún problema real y es la
dependencia que la sesión de grilling identificó como evitable.

**Pull to refresh usa `If-None-Match` con el `ETag` de la última respuesta.**
El backend ya emite `ETag`/`Cache-Control` pensados para esto (`news.ts`); ignorarlos sería no
usar un contrato que el backend construyó específicamente para el cliente. Costo de
implementación bajo: guardar el header del último fetch, reenviarlo, y tratar `304` como
"sin cambios" (no pisa el estado actual, solo apaga el spinner de refresh).

**Mensajes de usuario mapeados por resultado, no por código HTTP crudo.**
Tres resultados distintos para `POST /subscribers`: éxito (`202`, cualquier caso interno) →
"revisá tu correo"; `400 invalid_email` → error de formato; cualquier otro fallo (red, timeout,
5xx, `429`) → error genérico accionable. El código HTTP nunca se muestra ni se traduce
literalmente — la app no necesita que el usuario entienda la semántica REST del backend, solo
qué hacer a continuación.

**Cliente HTTP simple (fetch nativo), sin librería de data-fetching.**
Con una sola pantalla y dos llamadas (`GET /news`, `POST /subscribers`), algo como
React Query no resuelve un problema presente — agrega superficie sin necesidad para un POC de
alcance fijo.

**Confirmación y unsubscribe quedan completamente fuera de la app.**
El link de confirmación se abre en el navegador del sistema, no en un WebView ni con deep
link — decisión explícita del usuario en la sesión de grilling para evitar la complejidad de
un custom URL scheme quedándose en Expo Go.

## Risks / Trade-offs

- **[Riesgo] `localhost:3000` asume Simulador de iOS sobre el mismo host macOS.** Si en algún
  momento se prueba en un dispositivo físico, `localhost` ya no resuelve al backend.
  → Mitigación: la URL base se lee de una env var de Expo (`EXPO_PUBLIC_API_URL`), nunca
  hardcodeada, para que cambiarla no requiera tocar código.
- **[Riesgo] `POST /subscribers` no distingue email nuevo de email ya activo (por diseño del
  backend).** La app siempre muestra el mismo mensaje de éxito, lo cual puede confundir a
  alguien que ya estaba suscripto y no recibe nada nuevo.
  → Mitigación: ninguna en la app — es una decisión de producto del backend (no filtrar
  existencia de direcciones) que la app debe respetar tal cual, no hay nada que "arreglar" del
  lado del cliente.
- **[Riesgo] Rate limit de `POST /subscribers` puede dispararse durante pruebas manuales
  repetidas.** Un `429` se colapsa al mismo mensaje genérico que cualquier otro fallo, así que
  el usuario no sabe que debe esperar.
  → Mitigación aceptada conscientemente: no vale la complejidad de parsear `Retry-After` para
  un POC; si se vuelve un problema real en las pruebas, se revisita.

## Migration Plan

No aplica — no hay versión previa de la app ni datos que migrar. El "rollout" es local:
`npm run serve` en la raíz + `npx expo start` en `mobile/`, abrir en Simulador de iOS.

## Open Questions

Ninguna pendiente — todas las decisiones de alcance y comportamiento se cerraron en la sesión
de `/grill-me` previa a este proposal (ver `grill-session.md` en la raíz del repo).
