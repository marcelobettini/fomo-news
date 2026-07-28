# Variables de entorno

Este documento explica qué poner en `.env` y qué significa cada variable. El archivo
`.env.example` en la raíz del repositorio es la plantilla versionada (sin valores reales);
copiarlo a `.env` y completarlo:

```bash
cp .env.example .env
```

`.env` **nunca se versiona** (está en `.gitignore`) — ahí van las credenciales reales. Node
lo carga de forma nativa al arrancar (`node --env-file=.env dist/src/main.js`), sin ningún
paquete gestor de entorno (research.md §2).

Las siete variables son **obligatorias**: si falta una o tiene un formato inválido, el
proceso lanza un error explícito al arrancar y termina con código de salida distinto de cero
— no hay valores por defecto ocultos en el código (`src/config/env.ts`).

## MONGODB_URI

**Qué es**: la cadena de conexión al cluster de MongoDB (Atlas u otro), incluyendo usuario,
contraseña y el nombre de la base de datos.

**Formato**: un connection string estándar de MongoDB.

**Ejemplo**:
```
MONGODB_URI=mongodb+srv://usuario:contraseña@cluster0.mongodb.net/fomo-news
```

Si el nombre de la base de datos no está incluido en la URI, el driver usa la base
`test` por defecto — conviene incluirlo explícitamente como en el ejemplo (`/fomo-news`) para
no depender de ese comportamiento implícito.

## SOURCE_FEED_URL

**Qué es**: la URL completa del feed Atom de la fuente (el diario de Tandil).

**Formato**: una URL http(s) válida que responda XML Atom.

**Ejemplo**:
```
SOURCE_FEED_URL=https://www.eldiario-tandil.com.ar/feed/atom/
```

(Reemplazar por la URL real del feed que se vaya a consumir; no hay un valor por defecto
porque el feature está diseñado para una única fuente pero configurable, no hardcodeada.)

## TARGET_CATEGORY

**Qué es**: el nombre de la categoría que se conserva; todo lo demás se descarta sin
almacenarse (FR-005).

**Formato**: texto plano, **sensible a mayúsculas/minúsculas**, comparado después de colapsar
espacios en blanco contra el valor del atributo `term` de `<category>` en cada entrada del
feed. Debe coincidir exactamente con cómo la fuente escribe esa categoría.

**Ejemplo**:
```
TARGET_CATEGORY=Policiales
```

Para confirmar el valor exacto antes de configurarlo: mirar el feed real y copiar el texto
tal cual aparece en `<category term="...">` (no en la URL — la ruta del enlace es solo una
validación cruzada secundaria, FR-011, no la fuente de verdad de la categoría).

## TIMEZONE

**Qué es**: la zona horaria local usada para toda decisión de negocio (qué día es, ventanas
de tiempo), nunca las fechas de publicación en sí, que siempre se guardan en UTC (Artículo
VI).

**Formato**: un nombre de zona **IANA en formato `Área/Ciudad`**. El sistema rechaza
explícitamente cualquier offset numérico fijo (`-03:00`, `GMT-3`) y también las zonas
`Etc/GMT±N` (que son offsets fijos disfrazados de nombre de zona) — ver
`src/core/localTime.ts`. Si el valor no pasa esta validación, el proceso no arranca.

**Ejemplo**:
```
TIMEZONE=America/Argentina/Buenos_Aires
```

Se usa esta zona (y no una genérica `America/Buenos_Aires`) porque Argentina no tiene
horario de verano vigente, pero el nombre completo es la forma correcta y estable de
referirse a ella según la base de datos IANA.

## NEWS_RETENTION_MS

**Qué es**: cuánto tiempo se conserva una noticia antes de que el índice TTL de MongoDB la
elimine automáticamente (sin código propio de purga), contado de forma rodante desde su
`publishedAt` (FR-008).

**Formato**: un entero positivo, **en milisegundos**.

**Restricción importante (FR-009)**: debe ser lo bastante largo para cubrir el cruce entre el
cierre de un día local y el comienzo del siguiente — una noticia publicada a las 23:50 debe
seguir disponible a la mañana siguiente. Un valor de menos de 24 horas puede violar esto en
el peor caso. Como referencia (no como valor prescriptivo, eso se calibra en producción):

| Valor | Milisegundos |
|---|---|
| 1 día | `86400000` |
| 3 días | `259200000` |
| 7 días | `604800000` |

**Ejemplo** (3 días, con margen holgado sobre el mínimo de 24hs):
```
NEWS_RETENTION_MS=259200000
```

Cuando exista la futura feature de notificaciones, esta variable seguirá existiendo pero el
Artículo I exigirá además que ninguna noticia se borre antes de haber sido entregada — ver la
excepción documentada en `plan.md` (Complexity Tracking) y el comentario junto al índice TTL
en `src/adapters/repository.ts`.

## RAW_SNAPSHOT_RETENTION_MS

**Qué es**: cuánto tiempo se conserva la copia cruda (sin procesar) de cada respuesta de la
fuente, exclusivamente para diagnosticar fallos de interpretación — no es un archivo
histórico ni una fuente de datos (FR-020).

**Formato**: un entero positivo, **en milisegundos**, independiente de `NEWS_RETENTION_MS` y
pensado para ser **corto** ("unos pocos días" en la redacción original del feature).

**Ejemplo** (2 días):
```
RAW_SNAPSHOT_RETENTION_MS=172800000
```

## CATEGORY_SILENCE_THRESHOLD_MS

**Qué es**: el umbral de tiempo sin ver ninguna entrada (nueva o no) de `TARGET_CATEGORY` en
la fuente antes de emitir la alarma de "ausencia prolongada de categoría" (FR-014) — la señal
de que la fuente probablemente cambió el nombre de la categoría.

**Formato**: un entero positivo, **en milisegundos**.

**Cómo elegir el valor**: debe ser sensiblemente mayor al intervalo real entre publicaciones
de esa categoría en condiciones normales (para no generar falsas alarmas), pero no tan grande
que retrase la detección de un problema real. Se calibra empíricamente con los datos de
`runs.oldestEntryAt` una vez el sistema esté corriendo (ver quickstart.md).

**Ejemplo** (12 horas):
```
CATEGORY_SILENCE_THRESHOLD_MS=43200000
```

## Ejemplo de `.env` completo

```dotenv
MONGODB_URI=mongodb+srv://usuario:contraseña@cluster0.mongodb.net/fomo-news
SOURCE_FEED_URL=https://www.eldiario-tandil.com.ar/feed/atom/
TARGET_CATEGORY=Policiales
TIMEZONE=America/Argentina/Buenos_Aires
NEWS_RETENTION_MS=259200000
RAW_SNAPSHOT_RETENTION_MS=172800000
CATEGORY_SILENCE_THRESHOLD_MS=43200000
```

Los valores numéricos de este ejemplo son razonables para arrancar, pero no son parte de la
especificación (spec.md los deja como parámetros de configuración a propósito) — ajustar con
datos reales de operación.
