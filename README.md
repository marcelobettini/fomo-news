# Ingestor — Captura periódica de noticias de Tandil

Proceso de una sola pasada que consulta el feed Atom de la fuente, filtra por categoría
configurada, incorpora de forma idempotente las noticias nuevas y actualiza las existentes,
evalúa las condiciones de alarma del Artículo VII, y registra el resultado de la corrida.
No es un servidor: la periodicidad la provee **cron del sistema**, nunca un scheduler interno
(Artículo II). Ver [`specs/001-news-feed-ingestion/`](specs/001-news-feed-ingestion/) para la
especificación, el plan y las tareas completas de este feature.

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
