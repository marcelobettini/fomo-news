# Quickstart: validar el envío periódico de noticias por correo

Dos vías de validación, igual que las features 2/3: la suite automatizada (fuente de verdad,
100% local) y una corrida manual opcional para revisar a ojo el contenido de los mensajes.

## Vía 1 — suite automatizada (`npm test`), sin red, sin Resend, sin Atlas

Cubre exactamente los escenarios pedidos en el input de `/speckit-plan`. Cada uno corre contra
`mongodb-memory-server` (`tests/notifier/testHelpers.ts`) invocando `runDigestOnce(...)`
directamente con un `now: Date` explícito por llamada — nunca se espera al reloj real.

| Escenario | Cómo se ejercita |
|---|---|
| Dos envíos sucesivos sin repetición | seed suscriptor + noticias, `runDigestOnce` con `now = t0`, luego otra vez con `now = t0 + 1h` sin cambios nuevos: el segundo mensaje solo trae lo nuevo (nada, si no hubo noticias nuevas) |
| Noticia con fecha de publicación anterior al último envío igualmente se entrega | seed una noticia con `publishedAt < t0` **después** de ya haber corrido `runDigestOnce` con `now = t0`; correr de nuevo con `now = t0 + 1h`: se entrega |
| Ejecución duplicada sin mensajes duplicados | mismo `now` exacto, `runDigestOnce` dos veces seguidas: el `FakeEmailSender` de la segunda corrida no recibe llamadas para lo ya entregado |
| Suscriptor sin pendientes no recibe nada | seed suscriptor activo sin noticias elegibles: cero llamadas a `emailSender.send` para esa dirección |
| Dos suscriptores con activaciones distintas reciben conjuntos distintos | dos `activatedAt` distintos, mismas noticias disponibles, mismo `runDigestOnce`: se comparan los dos mensajes armados |
| Falla del canal para un suscriptor y éxito para otro | `FakeEmailSender` configurado para devolver `"failed"` solo para una dirección en esa corrida; se verifica que solo esa dirección vuelve a estar pendiente en la corrida siguiente |
| Resultado ambiguo se reintenta | igual que arriba con `"ambiguous"` |
| Fuera de la ventana horaria no se envía nada | `now` fuera de `SEND_WINDOW_START_LOCAL`/`END_LOCAL`: cero llamadas a `emailSender.send`; correr de nuevo con `now` dentro de la ventana: se entrega lo acumulado |
| El primer envío del día y los siguientes se resuelven igual | se corre `runDigestOnce` dos veces en la misma ventana con `now` distinto, sin ninguna rama de código exclusiva de "primer envío" — se verifica que ambas corridas usan la misma función sin parámetros adicionales |
| Noticia más antigua que el período máximo no se envía | `publishedAt` fuera de `MAX_PENDING_AGE_MS` respecto de `now`: no aparece en el mensaje |
| Pendientes por encima del tope | más noticias elegibles que `MAX_NEWS_PER_MESSAGE`: el mensaje trae las más recientes hasta el tope y el indicador de "ver el resto"; las excluidas siguen pendientes para la corrida siguiente |
| Noticia actualizada tras entrega no genera un nuevo envío | actualizar `title`/`summary` de una noticia ya en `deliveries` y correr de nuevo: no se reenvía (identidad por `newsId`, no por contenido) |
| Suscriptor dado de baja no recibe | eliminar el documento de `subscribers` (o dejarlo `pending`) antes de correr: cero llamadas a `emailSender.send` |
| Configuración incoherente impide arrancar | llamar `assertRetentionCoherent` (o `loadNotifierEnvConfig` con valores que la violen) directamente: lanza, sin haber tocado Mongo |

```bash
npm run build && npm test
```

## Vía 2 — corrida manual local, sin dominio ni Resend

Mismo patrón que `npm run dev:server` (README, sección de suscriptores): Mongo efímero en
memoria y `createConsoleEmailSender` en vez de Resend.

```bash
npm run dev:notifier
```

Siembra un puñado de noticias y suscriptores de ejemplo con distintos `activatedAt`, corre
`runDigestOnce` una vez con `now = new Date()` (o con `NOTIFIER_DEV_NOW` si se define esa
variable, para forzar una hora local dentro/fuera de la ventana sin esperar al reloj real), e
imprime por consola cada mensaje que se habría enviado — útil para revisar a ojo el HTML/texto
plano y los encabezados `List-Unsubscribe` antes de tocar Resend real.

## Vía 3 — corrida real contra Resend y Atlas (opcional, para antes de un despliegue)

1. Completar `.env.notifier` (ver `data-model.md`) — requiere el mismo dominio verificado en
   Resend que ya usa `.env.server` (feature 3) y el mismo `UNSUBSCRIBE_TOKEN_SECRET`.
2. `npm run build && npm run notify`.
3. Verificar en `deliveries` (vía la credencial acotada) que se crearon los documentos
   esperados, y que el correo llegó con el enlace de baja funcionando
   (`GET /subscribers/unsubscribe/{token}` del mismo proceso de la feature 3).

## Referencias

- Contrato de invocación y códigos de salida: `contracts/notifier-cli-contract.md`.
- Contrato de la interfaz de envío (compartida con la feature 3): `contracts/email-sender-contract.md`.
- Esquema de datos y variables de entorno: `data-model.md`.
- Justificación de cada decisión, incluidos los dos conflictos resueltos con la feature 3
  (token de baja irrecuperable, borrado de entregas al eliminarse un suscriptor): `research.md`.
