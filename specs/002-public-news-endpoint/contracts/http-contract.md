# Contract: endpoint HTTP público de noticias del día

Único endpoint expuesto por este proceso. Sin autenticación, sin parámetros de consulta (FR de
"respuesta fija" del spec — no es una API de consulta generalizada).

## `GET /news`

### Petición

Sin parámetros de ruta, query ni cuerpo. Encabezado opcional `If-None-Match` para
validación de caché condicional (ver abajo).

### Respuesta exitosa — `200 OK`

Cuerpo JSON:

```json
{
  "date": "2026-07-28",
  "timezone": "America/Argentina/Buenos_Aires",
  "count": 2,
  "news": [
    {
      "title": "string",
      "summary": "string",
      "link": "string",
      "publishedAt": "2026-07-28T18:40:00.000Z"
    }
  ]
}
```

- `date`: día calendario local (`YYYY-MM-DD`) que representa esta respuesta (FR-001/FR-011).
- `news`: ordenado de más reciente a más antigua (FR-002); puede ser `[]` — un día sin
  noticias todavía es una respuesta exitosa y válida (FR-006), nunca un error.
- Nunca incluye `category`, `updatedAt`, ni ningún dato interno de bookkeeping (FR-003).

Encabezados:

- `ETag`: hash del conjunto devuelto (research.md §3). Cambia únicamente cuando cambia el
  conjunto de noticias del día.
- `Last-Modified`: instante del último refresco de la caché interna.
- `Cache-Control`: acotado al TTL de la caché interna (`public, max-age=<TTL>`).
- `Access-Control-Allow-Origin: *` (FR-014 — cualquier origen).

### Respuesta condicional — `304 Not Modified`

Si `If-None-Match` coincide con el `ETag` vigente: `304` sin cuerpo (FR-008/FR-009,
User Story 3). El cliente conserva el resultado que ya tiene.

### Fallo explícito — `503 Service Unavailable`

Cuando el proceso no puede acceder a los datos almacenados (MongoDB inaccesible). Cuerpo JSON
con un código de error explícito, **nunca** `200` con `news: []` (FR-007, requisito crítico
del spec — un fallo real nunca puede parecer un día sin noticias):

```json
{
  "error": "storage_unavailable"
}
```

### Límite de tasa excedido — `429 Too Many Requests`

Emitido por `@fastify/rate-limit` cuando un origen (IP) supera `RATE_LIMIT_MAX_PER_IP` dentro
de `RATE_LIMIT_WINDOW_MS` (FR-010, User Story 4). Distinguible por código de estado de un
`503` — el rechazo por exceso nunca se reporta como un fallo del servicio.

## Fuera de este contrato

Ninguna otra ruta. Sin paginación, sin filtros por categoría o fecha, sin autenticación, sin
endpoint de administración o salud (ver spec.md, sección Fuera de alcance).
