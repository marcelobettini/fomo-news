# Research: Captura periódica de noticias con retención acotada y detección de pérdidas

Todas las incógnitas del Technical Context quedan resueltas abajo; no quedan marcadores
NEEDS CLARIFICATION.

## 1. Parser de XML/Atom

**Decision**: `fast-xml-parser`.

**Rationale**: es la única dependencia de terceros estrictamente necesaria (el feed es Atom;
Node no trae un parser XML en su biblioteca estándar). Es pure-JS, sin dependencias propias,
ampliamente usado y mantenido, y su API de parseo a objeto simplifica extraer `entry`,
`title`, `summary`, `link`, `published`, `updated` y la categoría sin escribir un parser a
mano.

**Alternatives considered**: `xml2js` (más pesado, estilo callback, dependencias propias) y
escribir un parser Atom a mano (rechazado: el feed puede traer variaciones de escape/CDATA
que un parser dedicado ya resuelve; reinventar esto no está justificado dado el criterio de
"dependencias mínimas y justificadas", que permite una dependencia cuando cubre una necesidad
real).

## 2. Cliente HTTP, fechas y variables de entorno

**Decision**: `fetch` nativo de Node para la descarga; `Intl.DateTimeFormat` con nombre de
zona IANA para conversión de horario; carga nativa de variables de entorno de Node (archivo
`.env` vía flag de entorno / `process.loadEnvFile`) sin paquete gestor.

**Rationale**: los tres ya están resueltos en la plataforma sin dependencias adicionales;
agregar una librería para cualquiera de ellos no estaría justificado.

**Alternatives considered**: `axios`/`node-fetch` (innecesarios, `fetch` ya es nativo desde
Node 18), `date-fns`/`luxon`/`moment` (innecesarios, `Intl` resuelve zona horaria por nombre
de región sin offsets fijos), `dotenv` (innecesario, Node carga `.env` de forma nativa).

## 3. Test runner

**Decision**: `node:test` (runner nativo) + `node:assert`.

**Rationale**: cubre el requisito de pruebas sobre fixtures sin red sin sumar una
dependencia (`vitest`/`jest`) que no aporta nada que el runner nativo no resuelva para este
alcance.

**Alternatives considered**: `vitest` (más ergonómico pero es una dependencia no
justificada dado que el runner nativo alcanza).

## 4. Separación core/adapters para pruebas sin red

**Decision**: la lógica que decide qué es nuevo, qué se descarta, qué dispara una alarma y
cómo se normaliza texto vive en `src/core`, como funciones puras que reciben datos ya
parseados (no I/O). `src/adapters` concentra todo el I/O (descarga HTTP, MongoDB, lock).

**Rationale**: es la única forma de cumplir "pruebas sobre fixtures XML guardados,
ejercitables sin red" sin introducir un servidor Mongo en memoria o mocks de infraestructura.
Los fixtures se parsean y se pasan directamente a las funciones de `core`; nada en esa capa
abre una conexión de red o de base de datos.

**Alternatives considered**: probar todo a través de `main.ts` con un Mongo real de prueba
(rechazado: viola el requisito explícito de que los tests corran sin red) o con
`mongodb-memory-server` (rechazado: es una dependencia pesada — descarga un binario de
Mongo — no justificada cuando la lógica relevante para los criterios de aceptación no
depende de Mongo en sí, sino de las decisiones de negocio).

## 5. Deduplicación e idempotencia (Artículo I de la constitution)

**Decision**: cada entrada se identifica por su enlace (estable y único). La incorporación
se hace con una operación `upsert` por ese identificador contra la colección `news`, sobre
**todas** las entradas de la ventana del feed en cada corrida — nunca filtrando la consulta
a "lo publicado desde la última corrida". El resultado del upsert (inserción vs.
actualización) determina si la entrada es nueva o ya conocida.

**Rationale**: el Artículo I prohíbe explícitamente cualquier lógica de marca de agua
temporal, precisamente porque la fuente puede reordenar o publicar con fecha retroactiva
dentro de su ventana. Procesar siempre la ventana completa contra el estado persistido
(resta de conjuntos vía upsert) es la única forma de que dos corridas consecutivas sobre el
mismo estado de la fuente sean indistinguibles de una sola (idempotencia, FR-002, FR-021).

**Alternatives considered**: filtrar por `pubDate > últimaCorridaExitosa` (rechazado
explícitamente por la constitution — es exactamente la marca de agua temporal prohibida).

## 6. Distinguir "cero entradas vistas" de "cero entradas nuevas"

**Decision**: cada corrida cuenta por separado `entriesSeen` (tamaño total de la ventana
devuelta por la fuente, antes de filtrar por categoría) y `entriesNew` (cuántas de esas
resultaron una inserción nueva en la categoría objetivo). Una corrida se marca fallida si
`entriesSeen === 0` (la fuente no devolvió nada, lo cual es anómalo dado que la ventana es de
tamaño fijo) o si hubo un error de red/parseo. `entriesNew === 0` con `entriesSeen > 0` es un
resultado normal y exitoso (nadie publicó noticias nuevas de la categoría objetivo desde la
corrida anterior).

**Rationale**: el modo de falla característico (constitution VII) es devolver cero
aparentando estar sano. Al separar ambos contadores, "cero nuevas" (normal) nunca se
confunde con "cero vistas" (anómalo) ni con la alarma de rotación completa de ventana.

## 7. Alarma de rotación completa de ventana y su excepción de arranque

**Decision**: se dispara cuando `entriesNew === entriesSeen` (el 100% de lo visto es nuevo),
excepto cuando la colección `runs` no tiene ninguna corrida exitosa previa (primera corrida
de la vida del sistema), en cuyo caso se omite esta alarma específica para esa corrida.

**Rationale**: resuelve la clarificación aceptada en spec.md — sin línea base previa, el
100% de novedad es esperable y no indica pérdida.

**Alternatives considered**: mantener un flag booleano separado de "sistema inicializado"
(rechazado: es estado redundante; la ausencia de corridas exitosas previas en `runs` ya
responde la pregunta sin una fuente de verdad adicional).

## 8. Alarma de ausencia prolongada de la categoría objetivo

**Decision**: se mantiene un único documento de estado (`state`, singleton) con el campo
`lastTargetCategoryObservedAt`, actualizado en cada corrida en que se ve al menos una
entrada (nueva o no) de la categoría objetivo en la ventana de la fuente. La alarma se
evalúa comparando el momento actual contra ese valor y un umbral configurable (variable de
entorno, valor concreto fuera de esta especificación).

**Rationale**: permite evaluar la condición en O(1) sin recorrer el historial de corridas, y
se actualiza con la sola observación (no con el guardado), por lo que refleja fielmente
"hace cuánto se vio la categoría en la fuente", incluso si esas entradas ya eran conocidas.

## 9. Registro de categorías observadas y señal de novedad

**Decision**: colección `categories` con un documento por nombre de categoría normalizado
(`firstSeenAt`, `lastSeenAt`), actualizado con upsert en cada corrida por cada categoría
vista (objetivo o no). Una categoría cuyo upsert resulta en inserción (no en actualización)
dispara la señal de novedad de esa corrida.

**Rationale**: cubre FR-012 y FR-015 con el mismo patrón de upsert-detecta-inserción usado
para deduplicar noticias, sin lógica adicional.

## 10. Validación cruzada de categoría

**Decision**: por cada entrada se compara la categoría declarada (normalizada) contra la
categoría extraída de la ruta del enlace (normalizada). Una discrepancia no cambia si la
entrada se almacena (eso lo decide solo la categoría declarada) ni bloquea la corrida; se
cuenta en `run.categoryMismatches` y, si es mayor a cero, se agrega como señal de anomalía en
el registro de la corrida.

**Rationale**: resuelve la clarificación aceptada en spec.md (FR-011); mantiene la anomalía
visible sin convertirla en una alarma de pérdida de datos, que está reservada para las tres
condiciones explícitas del Artículo VII.

## 11. Retención (Artículo I y su costura hacia notificaciones)

**Decision**: cada noticia almacena `expiresAt = publishedAt + retención configurada`. Un
índice TTL de MongoDB (`expireAfterSeconds: 0` sobre `expiresAt`) hace la purga; no hay
código propio de borrado. El valor concreto de la retención (y que cubra el cruce entre el
cierre de un día local y el comienzo del siguiente) es un parámetro de configuración, fuera
de esta especificación.

**Costura documentada para features posteriores**: un índice TTL no sabe si una noticia fue
entregada. Cuando exista el notificador, el Artículo I exigirá "ninguna noticia se elimina
antes de haber sido entregada", condición que el TTL no puede expresar por sí solo. Ese
feature futuro deberá introducir un mecanismo adicional (por ejemplo, condicionar el TTL a
un campo de estado de entrega, o reemplazar la purga automática por una purga explícita que
consulte el registro de entregas). En este feature el TTL alcanza porque no existen
suscriptores ni entregas todavía.

**Rationale**: cumple explícitamente con la instrucción del usuario de implementar retención
sin código propio de purga, dejando la costura registrada en vez de anticipar una solución
para un problema que todavía no existe (no hay entregas que proteger en este feature).

## 12. Exclusión mutua entre corridas

**Decision**: documento de lock en una colección `locks` de la misma base MongoDB
(`_id` fijo), adquirido con una escritura condicional (falla si ya existe un lock vigente),
liberado en `finally` al terminar la corrida, con un índice TTL de respaldo (`expiresAt`)
para que un proceso caído no deje el lock bloqueado indefinidamente.

**Rationale**: reutiliza la infraestructura ya requerida (MongoDB) en vez de sumar una
dependencia de coordinación adicional (por ejemplo Redis o un lock de archivo, que además no
funcionaría igual si el proceso corre desde más de un host). Consistente con "dependencias
mínimas y justificadas".

**Alternatives considered**: lock de archivo local (rechazado: no protege contra
solapamiento si en el futuro el proceso se dispara desde más de una máquina o contenedor);
una dependencia de coordinación distribuida dedicada (rechazado: sobredimensionado para un
solo proceso con un solo lock).

## 13. Copia cruda de diagnóstico

**Decision**: colección `raw_snapshots` en la misma base MongoDB, un documento por corrida
con el cuerpo crudo de la respuesta de la fuente y un `expiresAt` corto vía índice TTL,
independiente del TTL de retención de noticias.

**Rationale**: mismo mecanismo de purga (TTL) ya usado para noticias, sin dependencia de
sistema de archivos ni de un servicio de almacenamiento adicional; cumple "no es un archivo
histórico" al tener vida corta garantizada por el motor.

## 14. Limpieza del resumen (eliminar imagen inicial, sin reescribir contenido)

**Decision**: una función pequeña en `core` elimina únicamente la imagen inicial del resumen
(si existe) y normaliza espacios/saltos de línea, escrita a mano con una expresión regular
acotada a los patrones conocidos con que la fuente antepone esa imagen: una etiqueta `<img>`
suelta, o (la forma real observada en la fuente en producción) un `<figure>` que envuelve el
`<img>`. Sin un parser HTML/DOM de propósito general.

**Rationale**: el Artículo VIII exige no reescribir ni generar contenido — la única
transformación permitida es de formato, no de significado. Sumar una dependencia de parseo
HTML completo (`cheerio`, `jsdom`) para remover una única etiqueta conocida al inicio del
string no está justificado por el criterio de dependencias mínimas.

**Alternatives considered**: `cheerio`/cualquier parser DOM (rechazado: sobredimensionado
para una transformación de un patrón conocido y acotado).
