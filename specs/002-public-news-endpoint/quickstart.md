# Quickstart: Endpoint público de solo lectura de noticias del día

## Prerrequisitos

- Node.js LTS (>=22), mismo repo que la feature 1.
- Un usuario de MongoDB Atlas de rol `read` sobre la misma base que usa el ingestor
  (research.md §4) — distinto del usuario de lectura-escritura del ingestor.
- Variables de entorno propias de este proceso (ver [data-model.md](./data-model.md)):
  `MONGODB_READONLY_URI`, `TIMEZONE`, `PORT`, `RATE_LIMIT_MAX_PER_IP`,
  `RATE_LIMIT_WINDOW_MS`. No comparte archivo `.env` con el ingestor.

## Pruebas (sin red hacia Atlas ni hacia la fuente real)

```bash
npm test
```

Levanta `mongodb-memory-server` (research.md §6), siembra documentos `news` conocidos,
construye la app Fastify (`src/http/app.ts`) y la ejercita con `fastify.inject()`. Cubre como
mínimo (ver [contracts/http-contract.md](./contracts/http-contract.md)):

- `GET /news` con noticias del día presentes → `200`, campos correctos, orden descendente.
- `GET /news` sin ninguna noticia capturada todavía hoy → `200` con `news: []` (nunca error).
- `If-None-Match` con el `ETag` vigente → `304` sin cuerpo; con un valor desactualizado → `200`
  con el conjunto completo.
- Una noticia publicada de madrugada UTC pero del día local anterior → excluida del resultado
  del día en curso (corte resuelto en hora local, no en UTC — FR-011/FR-012).
- Almacenamiento inaccesible → `503` explícito, nunca `200` con `news: []`.

## Ejecutar el servidor localmente

```bash
npm run build
node --env-file=.env.server dist/src/server.js
```

(Se sugiere un archivo de entorno separado, p. ej. `.env.server`, para no mezclar la
credencial de solo lectura de este proceso con la `MONGODB_URI` de lectura-escritura del
ingestor.)

## Validar manualmente

```bash
curl -i http://localhost:$PORT/news
```

Verificar:

1. `200` con un cuerpo `{ date, timezone, count, news }` — `news` ordenado de más reciente a
   más antigua.
2. Repetir la misma consulta capturando el header `ETag` de la respuesta anterior:
   ```bash
   curl -i -H "If-None-Match: <etag-recibido>" http://localhost:$PORT/news
   ```
   Debe responder `304` sin cuerpo si no hubo una nueva captura de noticias entre medio.
3. Apagar temporalmente el acceso a MongoDB (o apuntar `MONGODB_READONLY_URI` a un destino
   inválido) y confirmar que la respuesta es `503` con `{ "error": "storage_unavailable" }`,
   nunca `200` con `news: []`.

## Despliegue (systemd)

Unidad de servicio (research.md §2), en `/etc/systemd/system/fomo-news-endpoint.service` de la
VM ARM64 que ya aloja al ingestor:

```ini
[Unit]
Description=fomo-news — endpoint público de solo lectura de noticias del día
After=network.target

[Service]
Type=simple
User=fomo-news
WorkingDirectory=/opt/fomo-news
EnvironmentFile=/opt/fomo-news/.env.server
ExecStart=/usr/bin/node dist/src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`EnvironmentFile` reemplaza a `--env-file` (no aplica a un `ExecStart` de systemd de la misma
forma que a una invocación manual de `node`); el contenido de `.env.server` es el mismo que
usa `npm run serve` en local. El usuario del sistema (`fomo-news` en el ejemplo) debe ser
distinto de cualquier usuario con permisos de escritura sobre la base — la restricción de solo
lectura la impone la credencial de MongoDB (research.md §4), no este archivo.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fomo-news-endpoint.service
sudo systemctl status fomo-news-endpoint.service
```
