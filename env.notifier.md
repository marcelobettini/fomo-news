# Variables de entorno del envío periódico de noticias

Este documento explica qué poner en `.env.notifier` y qué significa cada variable. Es el
archivo de entorno del **tercer proceso** del repositorio — el resumen periódico de noticias
por correo (`specs/004-send-email-news/`), un proceso de una sola pasada del mismo tipo que el
ingestor (no un servidor HTTP) — completamente separado de `.env` y de `.env.server`: procesos
independientes, cada uno con su propio archivo, sin compartir credenciales de Mongo. El archivo
`.env.notifier.example` en la raíz del repositorio es la plantilla versionada (sin valores
reales); copiarlo a `.env.notifier` y completarlo:

```bash
cp .env.notifier.example .env.notifier
```

`.env.notifier` **nunca se versiona** (está en `.gitignore`, igual que `.env`/`.env.server`).
Node lo carga de forma nativa al arrancar (`node --env-file=.env.notifier dist/src/notifier.js`,
o `npm run notify`), sin ningún paquete gestor de entorno — mismo criterio que el ingestor y el
endpoint.

Las once variables son **obligatorias**: si falta una o tiene un formato inválido, el proceso
lanza un error explícito al arrancar y termina con código de salida distinto de cero — no hay
valores por defecto ocultos en el código (`src/config/notifierEnv.ts`). Además de validar el
formato de cada variable por separado, el proceso valida una **relación entre tres de ellas**
(`NEWS_RETENTION_MS`, `MAX_SEND_INTERVAL_MS`, `MAX_PENDING_AGE_MS`, ver más abajo) antes de
devolver la configuración — un error ahí también impide arrancar, sin haber tocado Mongo.

## MONGODB_NOTIFIER_URI

**Qué es**: la cadena de conexión a MongoDB Atlas para este proceso, apuntando a un usuario de
base de datos con un rol personalizado acotado a: lectura de `news` y `subscribers`,
lectura-escritura de `deliveries` y `locks` (`specs/004-send-email-news/research.md` §10). Sin
ningún privilegio sobre `categories`, `state`, `runs`, `raw_snapshots` ni `suppressions`.
Distinta de `MONGODB_URI`, `MONGODB_READONLY_URI` y `MONGODB_SUBSCRIBERS_URI`.

**Formato**: un connection string estándar de MongoDB.

**Ejemplo**:
```
MONGODB_NOTIFIER_URI=mongodb+srv://notifier-rw:contraseña@cluster0.mongodb.net/fomo-news
```

Crear este usuario y su rol en Atlas es un paso de configuración externo a este repositorio,
igual que los usuarios de las features 2 y 3.

## TIMEZONE

**Qué es**: la zona horaria local usada para decidir si el momento de la corrida cae dentro de
la ventana horaria permitida (`SEND_WINDOW_START_LOCAL`/`SEND_WINDOW_END_LOCAL`, más abajo),
nunca las fechas de publicación en sí, que siempre llegan en UTC desde MongoDB (Artículo VI).
Mismo significado y misma validación que la variable homónima del ingestor y del endpoint
(`env.md`, `env.server.md`), configurada de forma independiente en este archivo.

**Formato**: un nombre de zona **IANA en formato `Área/Ciudad`**. Se rechaza cualquier offset
numérico fijo (`-03:00`, `GMT-3`) y las zonas `Etc/GMT±N` — ver `src/core/localTime.ts`.

**Ejemplo**:
```
TIMEZONE=America/Argentina/Buenos_Aires
```

**Requisito de despliegue, no solo de configuración de la app**: la VM donde corre cron debe
tener también su **zona horaria del sistema operativo** fijada a este mismo valor
(`specs/004-send-email-news/research.md` §11) — si la máquina queda en UTC, las entradas de
crontab (que se interpretan en hora del SO) se desplazan sin ningún aviso, aunque `TIMEZONE`
esté bien configurada acá. Esto no se valida en código: es responsabilidad de quien despliega.

## PUBLIC_BASE_URL

**Qué es**: la URL absoluta y pública del proceso HTTP de suscriptores (feature 3), usada para
construir tanto el enlace de baja (`{PUBLIC_BASE_URL}/subscribers/unsubscribe/{token}`) como el
enlace a la consulta pública de noticias (`{PUBLIC_BASE_URL}/news`) que aparece en el mensaje
cuando el tope por noticia se superó. Mismo valor que `PUBLIC_BASE_URL` de `.env.server`.

**Formato**: una URL absoluta con esquema `https://`.

**Ejemplo**:
```
PUBLIC_BASE_URL=https://noticias.tandil.example
```

## EMAIL_PROVIDER_API_KEY

**Qué es**: la clave de la API de Resend, mismo proveedor y mismo adaptador
(`src/adapters/emailSender.ts`) que usa la feature 3. Secreto — nunca versionar el valor real.

**Formato**: el token que entrega el panel de Resend.

## EMAIL_SENDER_ADDRESS

**Qué es**: la dirección de correo remitente, verificada sobre el mismo dominio propio en
Resend que ya usa `.env.server` (research.md §9 de la feature 3).

**Formato**: una dirección de correo.

**Ejemplo**:
```
EMAIL_SENDER_ADDRESS=noticias@tandil.example
```

## UNSUBSCRIBE_TOKEN_SECRET

**Qué es**: el secreto compartido con `.env.server` (mismo valor en ambos archivos) para
reconstruir el token de baja de forma determinística —
`HMAC-SHA256(correo del suscriptor, secreto)` — al armar cada mensaje del resumen
(`specs/004-send-email-news/research.md` §8). Ver la explicación completa en `env.server.md`.
Secreto, nunca versionar.

**Formato**: una cadena secreta, suficientemente larga y aleatoria — idéntica a la de
`.env.server`.

## SEND_WINDOW_START_LOCAL

**Qué es**: el inicio de la ventana horaria permitida para enviar, en hora local (FR-005 de
`specs/004-send-email-news/spec.md`). Una invocación fuera de `[SEND_WINDOW_START_LOCAL,
SEND_WINDOW_END_LOCAL]` no envía nada — lo pendiente se acumula y espera al siguiente envío
dentro de la ventana. Es una salvaguarda del propio proceso, independiente de a qué horas cron
lo invoque realmente.

**Formato**: `"HH:MM"`, 24 horas, con cero a la izquierda.

**Ejemplo**:
```
SEND_WINDOW_START_LOCAL=08:00
```

## SEND_WINDOW_END_LOCAL

**Qué es**: el fin de la ventana horaria permitida para enviar, en hora local. Se asume mayor o
igual que `SEND_WINDOW_START_LOCAL` — una ventana que no cruza la medianoche
(`specs/004-send-email-news/research.md` §5).

**Formato**: `"HH:MM"`, 24 horas.

**Ejemplo**:
```
SEND_WINDOW_END_LOCAL=22:00
```

## MAX_PENDING_AGE_MS

**Qué es**: el vencimiento máximo de antigüedad para que una noticia siga siendo elegible de
envío (FR-002). Una noticia con más de esta antigüedad respecto del momento de la corrida se
descarta en vez de entregarse tarde, aunque nunca haya sido entregada — es la única excepción
explícita y acotada a "ninguna noticia se pierde" (spec.md, User Story 3).

**Formato**: un entero positivo, en milisegundos.

**Ejemplo** (7 días):
```
MAX_PENDING_AGE_MS=604800000
```

## MAX_NEWS_PER_MESSAGE

**Qué es**: el tope máximo de noticias incluidas en un mismo mensaje (FR-009). Si lo pendiente
de un suscriptor excede este número, el mensaje trae solo las más recientes y señala que el
resto está disponible en `{PUBLIC_BASE_URL}/news`; las excluidas no se pierden, quedan
pendientes para una corrida siguiente.

**Formato**: un entero positivo.

**Ejemplo**:
```
MAX_NEWS_PER_MESSAGE=20
```

## MAX_SEND_INTERVAL_MS

**Qué es**: el intervalo máximo **esperado** entre invocaciones sucesivas de este proceso —
refleja la cadencia real de las entradas de cron (research.md §6), no dispara ningún envío por
sí mismo. Se usa exclusivamente para la validación de coherencia con `NEWS_RETENTION_MS` (más
abajo). Si cron está configurado para invocar cada 6 horas, este valor debe ser al menos esas 6
horas — un valor menor al real vuelve la validación de coherencia optimista de forma incorrecta.

**Formato**: un entero positivo, en milisegundos.

**Ejemplo** (6 horas):
```
MAX_SEND_INTERVAL_MS=21600000
```

## NEWS_RETENTION_MS

**Qué es**: el mismo significado y el mismo valor que `NEWS_RETENTION_MS` de `.env` del
ingestor (ver `env.md`), duplicado acá exclusivamente para la validación de coherencia
siguiente. No controla ninguna purga desde este proceso — la purga sigue siendo el índice TTL
de `news` que gestiona el ingestor.

**Validación de coherencia (Artículo I, research.md §6)**: al arrancar, el proceso exige

```text
NEWS_RETENTION_MS > MAX_SEND_INTERVAL_MS + MAX_PENDING_AGE_MS
```

Si no se cumple (igualdad incluida), el proceso lanza un error descriptivo y termina con código
de salida distinto de cero, **sin conectar a Mongo**. La razón: con esta relación garantizada,
para cuando el TTL purgaría una noticia ya hubo oportunidad de al menos un envío después de que
esa noticia dejó de ser elegible por antigüedad — el TTL nunca llega a purgar algo que la spec
todavía considere pendiente.

**Formato**: un entero positivo, en milisegundos — debe coincidir con el valor real usado en
`.env` del ingestor.

**Ejemplo** (30 días, con margen holgado sobre `MAX_SEND_INTERVAL_MS + MAX_PENDING_AGE_MS`):
```
NEWS_RETENTION_MS=2592000000
```

## Ejemplo de `.env.notifier` completo

```dotenv
MONGODB_NOTIFIER_URI=mongodb+srv://notifier-rw:contraseña@cluster0.mongodb.net/fomo-news
TIMEZONE=America/Argentina/Buenos_Aires
PUBLIC_BASE_URL=https://noticias.tandil.example
EMAIL_PROVIDER_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_SENDER_ADDRESS=noticias@tandil.example
UNSUBSCRIBE_TOKEN_SECRET=otro-secreto-largo-y-aleatorio-compartido-con-el-notifier
SEND_WINDOW_START_LOCAL=08:00
SEND_WINDOW_END_LOCAL=22:00
MAX_PENDING_AGE_MS=604800000
MAX_NEWS_PER_MESSAGE=20
MAX_SEND_INTERVAL_MS=21600000
NEWS_RETENTION_MS=2592000000
```

Con estos valores, `NEWS_RETENTION_MS` (30 días) es mayor que `MAX_SEND_INTERVAL_MS +
MAX_PENDING_AGE_MS` (6 horas + 7 días ≈ 7,25 días) — coherente. Los valores numéricos de este
ejemplo son razonables para arrancar, pero no son parte de la especificación (spec.md los deja
como parámetros de configuración a propósito) — ajustar con datos reales de operación, igual
que los umbrales del ingestor y del endpoint.

## Configurar la periodicidad (cron)

Igual que el ingestor (ver la sección homónima en `specs/001-news-feed-ingestion/quickstart.md`),
este proceso no se programa a sí mismo (Artículo II) — cron del sistema lo invoca en cada
horario de envío deseado. Los horarios elegidos deben caer dentro de
`[SEND_WINDOW_START_LOCAL, SEND_WINDOW_END_LOCAL]` para que la corrida haga algo; invocarlo
fuera de esa ventana es un no-op válido, no un error.

Ejemplo de entrada de crontab (envíos a las 09:00, 14:00 y 19:00 hora local):

```cron
0 9,14,19 * * * cd /ruta/al/repo && npm run notify >> /var/log/fomo-news-notifier.log 2>&1
```

Requiere que la zona horaria del sistema operativo de la VM esté fijada a la misma zona que
`TIMEZONE` (ver arriba) — de lo contrario estos horarios se interpretan en una zona distinta.
