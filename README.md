# Ingestor — Captura periódica de noticias de Tandil

Proceso de una sola pasada que consulta el feed Atom de la fuente, filtra por categoría
configurada, incorpora de forma idempotente las noticias nuevas y actualiza las existentes,
evalúa las condiciones de alarma del Artículo VII, y registra el resultado de la corrida.
No es un servidor: la periodicidad la provee **cron del sistema**, nunca un scheduler interno
(Artículo II). Ver [`specs/001-news-feed-ingestion/`](specs/001-news-feed-ingestion/) para la
especificación, el plan y las tareas completas de este feature.

Este repositorio también incluye un segundo componente independiente: un endpoint HTTP
público de solo lectura de las noticias del día — ver la sección
[Endpoint público de noticias del día](#endpoint-público-de-noticias-del-día) más abajo. Ambos
procesos se comunican únicamente a través de MongoDB; ninguno invoca al otro (Artículo II).

## Requisitos

- Node.js LTS (>=22)
- Un cluster de MongoDB (el tier gratuito de Atlas alcanza)

## Configuración

Copiar `.env.example` a `.env` y completar los valores (sin versionar `.env`):

```bash
cp .env.example .env
```

Ver [env.md](env.md) para el significado de cada variable, su formato y valores de ejemplo, y
[contracts/cli-contract.md](specs/001-news-feed-ingestion/contracts/cli-contract.md) para el
contrato de códigos de salida.

## Pruebas (sin red)

```bash
npm test
```

Compila TypeScript en modo estricto y corre los tests unitarios de `src/core` contra los
fixtures XML guardados en `tests/fixtures/`, sin tocar la red ni una base de datos real. Ver
[quickstart.md](specs/001-news-feed-ingestion/quickstart.md) para el detalle de qué cubre cada
fixture.

## Ejecutar una corrida real

```bash
npm run build
node --env-file=.env dist/src/main.js
```

Código de salida `0`: corrida exitosa (incluye "sin noticias nuevas", que es normal) o corrida
omitida por exclusión mutua. Código distinto de `0`: fallo de fuente, cero entradas vistas, o
alguna alarma de pérdida de datos confirmada — el detalle completo queda en la colección
`runs` de MongoDB, no solo en el código de salida.

## Periodicidad (cron)

Este proceso no se programa a sí mismo. Ver la sección "Configurar la periodicidad (cron)" en
[quickstart.md](specs/001-news-feed-ingestion/quickstart.md) para un ejemplo de entrada de
crontab y cómo calibrar el intervalo a partir de `runs.oldestEntryAt`.

## Endpoint público de noticias del día

Proceso HTTP de larga vida, independiente del ingestor, que expone de forma pública y de solo
lectura las noticias de la categoría configurada publicadas durante el día local en curso.
NUNCA escribe, NUNCA dispara ingesta y NUNCA llama a la fuente externa (Artículo III). Ver
[`specs/002-public-news-endpoint/`](specs/002-public-news-endpoint/) para la especificación,
el plan y el contrato HTTP completos.

### Configuración

Usa su propio archivo de entorno, separado del `.env` del ingestor (no comparten proceso ni
credenciales — la conexión de este proceso a MongoDB es de solo lectura):

```bash
cp .env.server.example .env.server
```

Ver [env.server.md](env.server.md) para el significado de cada variable, su formato y valores
de ejemplo.

### Pruebas (sin red hacia Atlas ni hacia la fuente real)

```bash
npm test
```

El mismo comando que el ingestor: compila TypeScript y corre tanto los tests unitarios de
`src/core` como los tests HTTP de este endpoint (`tests/http/`), estos últimos contra una
instancia de MongoDB efímera en memoria (`mongodb-memory-server`), ejercitados con
`fastify.inject()` sin abrir un puerto real. Ver
[quickstart.md](specs/002-public-news-endpoint/quickstart.md) para el detalle de qué cubre
cada test.

### Ejecutar el servidor localmente

```bash
npm run build
npm run serve
```

Escucha en el `PORT` configurado y responde en `GET /news`. Ver
[contracts/http-contract.md](specs/002-public-news-endpoint/contracts/http-contract.md) para
el contrato completo (`200`/`304`/`503`/`429`) y
[quickstart.md](specs/002-public-news-endpoint/quickstart.md) para cómo validar manualmente
los validadores de caché HTTP y el modo de fallo explícito.

## Alta, confirmación y baja de suscriptores

Mismo proceso HTTP que el endpoint de noticias (arriba), extendido con el ciclo de vida
completo de un suscriptor por correo electrónico — doble opt-in verificado, baja sin fricción
y desactivación automática ante señales negativas del canal de correo (rebote permanente,
queja de no deseado). Ver
[`specs/003-subscriber-lifecycle/`](specs/003-subscriber-lifecycle/) para la especificación,
el plan y el contrato HTTP completos.

**Flujo**:

1. **Alta** — `POST /subscribers` con `{"email": "..."}` crea (o reutiliza) una suscripción
   `pending`; nunca activa directamente. Responde siempre `202 {"status":"ok"}`, sin importar
   el estado previo de la dirección (protección contra enumeración).
2. **Confirmación** — el mensaje enviado incluye un enlace de un solo uso y vencimiento corto:
   `GET /subscribers/confirm/{token}`. Al usarlo por primera vez y a tiempo, la suscripción
   pasa a `active` y se registra el instante exacto de activación. Reutilizarlo da `409`; un
   token vencido da `410`.
3. **Baja** — un único paso, sin credenciales, por `GET` (enlace del cuerpo del mensaje) o
   `POST` (baja de un clic RFC 8058, invocada por el propio cliente de correo):
   `GET`/`POST /subscribers/unsubscribe/{token}`. Elimina los datos personales y deja solo un
   identificador no reversible. Es idempotente: repetir la llamada sigue devolviendo `200`.
   Volver a darse de alta con la misma dirección pasa de nuevo por el proceso completo de
   confirmación.
4. **Señales del canal** — `POST /webhooks/email` recibe notificaciones firmadas de Resend; un
   rebote permanente o una queja desactivan la suscripción automáticamente; un fallo
   transitorio no tiene efecto; una firma inválida se rechaza con `401` sin procesar el aviso.

Usa las mismas variables de `.env.server` (ver [env.server.md](env.server.md) para las diez
variables nuevas) y la misma suite de tests (`npm test`), contra `mongodb-memory-server` y un
doble en memoria del adaptador de envío de correo — sin red hacia Resend ni hacia MongoDB
Atlas. Ver [quickstart.md](specs/003-subscriber-lifecycle/quickstart.md) para validar el ciclo
completo de punta a punta contra un entorno real (requiere el dominio verificado en Resend y
el rol de Atlas acotado a `subscribers`/`suppressions` ya creados).
