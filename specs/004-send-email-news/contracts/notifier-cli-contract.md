# Contract: invocación del ejecutable de envío periódico (notifier)

Mismo tipo de contrato que `specs/001-news-feed-ingestion/contracts/cli-contract.md`: este
proceso no expone red; su contrato es su forma de invocación, sus variables de entorno y su
código de salida. Es el contrato que cron (externo, Artículo II) debe respetar, invocando este
comando en cada horario de envío configurado en la propia entrada de crontab.

## Invocación

- Un único comando, sin argumentos obligatorios, sin flags interactivos:
  `node --env-file=.env.notifier dist/src/notifier.js` (`npm run notify`).
- El proceso arranca, ejecuta una corrida completa (posiblemente un no-op si está fuera de la
  ventana horaria permitida o si no hay nada pendiente para nadie), y termina. No queda
  residente ni se reprograma a sí mismo.
- Es seguro invocarlo de forma solapada: la segunda invocación DEBE detectar el lock vigente
  (`_id: "notifier"`, mismo mecanismo que la feature 1 — research.md §1) y terminar sin
  ejecutar una segunda corrida concurrente, con código de salida `0` (corrida omitida, no un
  fallo).
- Es seguro invocarlo dos veces seguidas sin solaparse (por error o reintento manual): la
  segunda invocación no debe producir mensajes duplicados para nadie — esta propiedad surge del
  cálculo de pendientes contra el registro de entregas (research.md §4), no de una salvaguarda
  añadida en la invocación.

## Variables de entorno requeridas

Ver `data-model.md` para el formato exacto de cada una. Resumen:

| Variable | Propósito |
|---|---|
| `MONGODB_NOTIFIER_URI` | credencial acotada (lectura `news`/`subscribers`, lectura-escritura `deliveries`/`locks`) |
| `TIMEZONE` | zona IANA para la ventana horaria (Artículo VI) |
| `PUBLIC_BASE_URL` | base del enlace de baja y del enlace a la consulta pública |
| `EMAIL_PROVIDER_API_KEY` | clave del proveedor de correo |
| `EMAIL_SENDER_ADDRESS` | remitente verificado |
| `UNSUBSCRIBE_TOKEN_SECRET` | secreto compartido con el proceso de suscriptores para derivar el enlace de baja |
| `SEND_WINDOW_START_LOCAL` / `SEND_WINDOW_END_LOCAL` | ventana horaria permitida, hora local |
| `MAX_PENDING_AGE_MS` | vencimiento máximo de antigüedad de una noticia elegible |
| `MAX_NEWS_PER_MESSAGE` | tope de noticias por mensaje |
| `MAX_SEND_INTERVAL_MS` | intervalo máximo esperado entre corridas (solo para la validación de coherencia) |
| `NEWS_RETENTION_MS` | retención de noticias del ingestor, duplicada aquí para la misma validación |

Todas se cargan con el mecanismo nativo de Node (`--env-file`); ninguna tiene un valor por
defecto embebido en el código.

## Validación de arranque específica de este proceso

Antes de conectar a Mongo o de tocar cualquier dato, el proceso valida que
`NEWS_RETENTION_MS > MAX_SEND_INTERVAL_MS + MAX_PENDING_AGE_MS` (research.md §6). Si no se
cumple, el proceso termina con código de salida distinto de cero, sin ningún efecto secundario
— es una condición de configuración incoherente, no una corrida fallida por datos.

## Código de salida

| Código | Significado |
|---|---|
| `0` | Corrida exitosa. Incluye: nada pendiente para ningún suscriptor, invocación fuera de la ventana horaria permitida (no-op esperado), y corrida omitida por exclusión mutua (lock vigente). Un fallo de envío a un suscriptor individual (canal `"failed"` o `"ambiguous"`) **no** hace fallar la corrida — es un resultado esperado, reintentado automáticamente en la corrida siguiente por el propio cálculo de pendientes. |
| distinto de `0` | Configuración inválida o incoherente (incluye la validación de retención/entrega de arriba), fallo al conectar a MongoDB, o cualquier excepción no controlada durante la corrida. |

El código de salida es la señal que cron usa para notar un fallo de infraestructura; el
resultado por suscriptor (enviado, sin pendientes, reintentado) se resume en la salida estándar
de forma agregada, sin direcciones de correo (Artículo IV).

## Salida estándar / error

- Sin formato estructurado como contrato (no hay consumidor automatizado de stdout). Un
  resumen agregado por stderr al final de cada corrida, análogo al de `main.ts` (feature 1):
  `subscribersProcessed`, `messagesSent`, `itemsDelivered`, `sendFailures`, `sendAmbiguous` —
  nunca una dirección de correo ni el contenido de un mensaje.
