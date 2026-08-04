# Brief para `openspec propose` — app mobile (Expo/React Native)

Resultado de una sesión de `/grill-me` sobre el pedido original. Pegar esto como input de
`openspec propose` (o de la skill `openspec-propose`).

## Qué construir

Una app mobile con **Expo/React Native**, ubicada en `mobile/` (subcarpeta autocontenida
dentro de este mismo repo, con su propio `package.json`/`app.json` — no toca el `package.json`
ni el `tsconfig.json` de la raíz, que son del backend Node/Fastify). Se prueba únicamente con
**Expo Go en el simulador de iOS** (macOS como host). No hay despliegue ni producción: el
alcance termina en "anda en el simulador".

Una sola pantalla: lista de noticias del día (con pull to refresh) y, en la misma vista, el
formulario de suscripción por email.

## Backend que consume (ya existe, no se modifica)

- `GET /news` (`src/http/routes/news.ts`) — público, sin auth. Devuelve
  `{ date, timezone, count, news: [{ title, summary, link, publishedAt }] }`. `200` con
  `news: []` en un día sin noticias (nunca error). `503 { error: "storage_unavailable" }` si
  falla el almacenamiento — nunca se disfraza de lista vacía. Emite `ETag`, `Last-Modified` y
  `Cache-Control`; soporta condicional GET devolviendo `304` si `If-None-Match` matchea.
- `POST /subscribers` (`src/http/routes/subscribers.ts`) — recibe `{ email }`. `400
  { error: "invalid_email" }` si el formato es inválido. Para cualquier otro caso (alta nueva,
  reenvío, email ya activo, email pendiente dentro del cooldown) responde siempre
  `202 { status: "ok" }` — deliberadamente no distingue estos casos para no filtrar si una
  dirección existe. Rate limit por IP.
- La confirmación de suscripción y el unsubscribe **no pasan por la app**: ocurren cuando el
  usuario toca los links del correo (`GET /subscribers/confirm/:token`,
  `GET`/`POST /subscribers/unsubscribe/:token`), que se abren en el navegador del sistema, fuera
  del simulador. La app no implementa ninguna de esas dos pantallas.
- Backend corre local en `http://localhost:3000` (`npm run serve`, puerto fijado por `PORT` en
  `.env.server`). Desde el Simulador de iOS `localhost` apunta al host sin configuración
  adicional. CORS ya está abierto (`origin: true` en `src/http/app.ts`), no hay fricción cross
  origin en dev.

## Comportamiento esperado de la app

**Lista de noticias**
- Fetch de `GET /news` al montar la pantalla.
- Pull to refresh reenvía la petición usando `If-None-Match` con el `ETag` guardado del último
  fetch; si la respuesta es `304`, no pisa el estado actual (no hay contenido nuevo que mostrar).
- Estado vacío (`news: []`) se muestra como "no hay noticias hoy", no como error.
- `503` se muestra como error explícito distinto del estado vacío.

**Suscripción**
- Formulario con un campo de email. Validación de formato en cliente antes de enviar.
- Al enviar: si el backend responde `202`, mostrar mensaje de éxito indicando que debe revisar
  su correo para confirmar (la confirmación ocurre 100% por email, la app no hace nada más
  después de este punto).
- Si el backend responde `400 invalid_email`, mostrar mensaje de formato inválido.
- Si la petición falla por otro motivo (sin red, timeout, 5xx, rate limit `429`), mostrar un
  mensaje de error genérico y accionable ("no se pudo completar, probá de nuevo"), sin exponer
  detalle técnico ni código HTTP crudo al usuario.
- No hay pantalla de "ya confirmado" ni de unsubscribe dentro de la app.

## Fuera de alcance (explícito)

- Deploy, builds de producción, EAS, stores.
- Pantallas de confirmación/unsubscribe dentro de la app (viven en el correo/navegador).
- Autenticación (todo el consumo de `/news` es público).
- Navegación multi-pantalla / tabs (una sola vista alcanza para este alcance).
- Persistencia local del estado de suscripción entre sesiones.
- Android / Expo dev build (alcanza con Expo Go en iOS Simulator).

## Testing

Tests mínimos, solo para lógica no trivial y pura — sin tests de UI ni snapshots:
- Mapeo de resultado de `POST /subscribers` (status code / error de red) → mensaje de usuario.
- Validación de formato de email en el cliente.

## Notas para el change de OpenSpec (brownfield)

- Repo backend fue construido con SpecKit; specs viven en `specs/002-public-news-endpoint` y
  `specs/003-subscriber-lifecycle` (contratos en `contracts/*.md` de cada carpeta) — no están
  importados a `openspec/specs/`. El change de la app mobile puede referenciarlos por path
  relativo como contrato externo de solo lectura, sin necesidad de migrarlos formalmente.
- `openspec/config.yaml` todavía no tiene `context:` completado (`openspec context` no muestra
  nada declarado) — conviene completarlo con este mismo resumen de stack/contratos antes de
  correr `openspec propose`, para que el brownfield tenga terreno real.
- Convención de comentarios del repo backend: solo explican el WHY no obvio (referencian
  research.md/FR-xxx), nunca el WHAT: mantener el mismo criterio en el código de `mobile/`.
