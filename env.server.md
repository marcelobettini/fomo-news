# Variables de entorno del endpoint público

Este documento explica qué poner en `.env.server` y qué significa cada variable. Es el
archivo de entorno del **segundo proceso** del repositorio — el endpoint HTTP público de solo
lectura (`specs/002-public-news-endpoint/`) — completamente separado del `.env` del ingestor:
procesos independientes, cada uno con su propio archivo, sin compartir credenciales. El
archivo `.env.server.example` en la raíz del repositorio es la plantilla versionada (sin
valores reales); copiarlo a `.env.server` y completarlo:

```bash
cp .env.server.example .env.server
```

`.env.server` **nunca se versiona** (está en `.gitignore`, igual que `.env`) — ahí van las
credenciales reales. Node lo carga de forma nativa al arrancar
(`node --env-file=.env.server dist/src/server.js`, o `npm run serve`), sin ningún paquete
gestor de entorno — mismo criterio que el ingestor (research.md §2 de la feature 001).

Las seis variables son **obligatorias**: si falta una o tiene un formato inválido, el proceso
lanza un error explícito al arrancar y termina con código de salida distinto de cero — no hay
valores por defecto ocultos en el código (`src/config/serverEnv.ts`).

## MONGODB_READONLY_URI

**Qué es**: la cadena de conexión a MongoDB Atlas para este proceso, apuntando a un usuario de
base de datos con rol **`read` exclusivamente** — nunca el mismo usuario ni la misma cadena
que `MONGODB_URI` del ingestor.

**Formato**: un connection string estándar de MongoDB.

**Ejemplo**:
```
MONGODB_READONLY_URI=mongodb+srv://endpoint-readonly:contraseña@cluster0.mongodb.net/fomo-news
```

La restricción de solo lectura del Artículo III queda impuesta por la infraestructura (el rol
del usuario en Atlas), no solo por disciplina del código — ver research.md §4 de
`specs/002-public-news-endpoint/`. Crear este usuario en Atlas es un paso de configuración
externo a este repositorio.

## TIMEZONE

**Qué es**: la zona horaria local usada para decidir a qué día calendario pertenece cada
noticia (el corte de "día en curso" que devuelve `GET /news`), nunca las fechas de publicación
en sí, que siempre llegan en UTC desde MongoDB (Artículo VI). Mismo significado y misma
validación que la variable homónima del ingestor (`env.md`), pero configurada de forma
independiente en este archivo — no se comparte entre procesos.

**Formato**: un nombre de zona **IANA en formato `Área/Ciudad`**. Igual que en el ingestor, se
rechaza cualquier offset numérico fijo (`-03:00`, `GMT-3`) y las zonas `Etc/GMT±N` — ver
`src/core/localTime.ts`.

**Ejemplo**:
```
TIMEZONE=America/Argentina/Buenos_Aires
```

Debe coincidir con la zona configurada en el ingestor para que "el día en curso" signifique lo
mismo en ambos procesos, aunque no hay ningún mecanismo que lo verifique automáticamente entre
los dos archivos — es responsabilidad de quien despliega mantenerlos alineados.

## PORT

**Qué es**: el puerto TCP en el que Fastify escucha las peticiones HTTP.

**Formato**: un entero positivo.

**Ejemplo**:
```
PORT=3000
```

## RATE_LIMIT_MAX_PER_IP

**Qué es**: la cantidad máxima de peticiones que se aceptan de una misma IP dentro de la
ventana `RATE_LIMIT_WINDOW_MS` antes de responder `429` (FR-010). Protege el acceso público
sin autenticación contra volúmenes abusivos de consultas.

**Formato**: un entero positivo.

**Cómo elegir el valor**: debe ser holgado para un consumidor legítimo que sondea el endpoint
con la frecuencia esperada (incluyendo el uso normal de los validadores de caché HTTP, que
hacen que la mayoría de esas consultas devuelvan `304`), pero lo bastante ajustado para
contener un origen mal configurado o abusivo. Se calibra empíricamente una vez el servicio esté
en producción, igual que los umbrales del ingestor (ver `env.md`).

**Ejemplo**:
```
RATE_LIMIT_MAX_PER_IP=60
```

## RATE_LIMIT_WINDOW_MS

**Qué es**: la ventana de tiempo, en milisegundos, sobre la que se cuenta
`RATE_LIMIT_MAX_PER_IP`.

**Formato**: un entero positivo, en milisegundos.

**Ejemplo** (1 minuto):
```
RATE_LIMIT_WINDOW_MS=60000
```

## CACHE_TTL_MS

**Qué es**: cuánto tiempo se sirve el conjunto de noticias del día desde la caché en memoria
del proceso antes de volver a consultar MongoDB (research.md §3 de
`specs/002-public-news-endpoint/`). Existe para que el volumen de peticiones públicas nunca se
traduzca, una por una, en una consulta a la base — un TTL corto es, en la práctica, casi
indistinguible de "la respuesta cambia solo cuando cambia el conjunto almacenado", sin la
complejidad de suscribirse a cambios en tiempo real. También determina el `Cache-Control:
max-age` que ven los clientes.

**Formato**: un entero positivo, en milisegundos. Pensado para ser **corto** (segundos, no
minutos): un TTL demasiado largo retrasa que una noticia recién capturada por el ingestor
aparezca en el endpoint.

**Ejemplo** (5 segundos):
```
CACHE_TTL_MS=5000
```

## Ejemplo de `.env.server` completo

```dotenv
MONGODB_READONLY_URI=mongodb+srv://endpoint-readonly:contraseña@cluster0.mongodb.net/fomo-news
TIMEZONE=America/Argentina/Buenos_Aires
PORT=3000
RATE_LIMIT_MAX_PER_IP=60
RATE_LIMIT_WINDOW_MS=60000
CACHE_TTL_MS=5000
```

Los valores numéricos de este ejemplo son razonables para arrancar, pero no son parte de la
especificación (spec.md los deja como parámetros de configuración a propósito) — ajustar con
datos reales de operación, igual que los umbrales del ingestor.
