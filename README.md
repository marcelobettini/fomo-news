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
