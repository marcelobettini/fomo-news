# Research: Endpoint público de solo lectura de noticias del día

Todas las incógnitas del Technical Context quedan resueltas abajo; no quedan marcadores
`NEEDS CLARIFICATION`. El stack (Fastify, MongoDB Atlas, VM ARM64) fue especificado
directamente por el usuario en el input de `/speckit-plan`; las decisiones abajo documentan
además el "cómo" concreto para los puntos que el input dejó explícitamente a criterio del
plan (mecanismo de caché, forma de las pruebas, y la separación de credenciales).

## 1. Framework HTTP: Fastify + plugins de primera parte

**Decision**: Fastify como servidor HTTP, con validación/serialización de la respuesta vía su
mecanismo nativo de JSON Schema (sin librería de validación aparte), y `@fastify/cors` +
`@fastify/rate-limit` (plugins de primera parte del propio proyecto Fastify) para CORS y
límite de tasa.

**Rationale**: especificado explícitamente por el usuario. Fastify serializa la respuesta a
partir del `schema` de la ruta (usa `fast-json-stringify` internamente), lo que cubre
validación y forma de salida sin sumar una dependencia de validación separada — coherente con
la restricción de stack ("cada dependencia debe justificarse; preferir la biblioteca estándar
cuando alcance"). Los plugins de primera parte están mantenidos por el mismo proyecto, evitando
evaluar terceros para dos necesidades de seguridad/operación básicas.

**Alternatives considered**: Express/Koa (rechazados: sin serialización basada en schema
nativa, requerirían sumar una librería de validación aparte, exactamente lo que se buscaba
evitar); `node:http` puro (rechazado: obligaría a reimplementar enrutamiento, CORS y límite de
tasa a mano, más código y más superficie de error que usar los plugins ya mantenidos).

## 2. Supervisión de proceso: systemd

**Decision**: unidad de servicio systemd con `Restart=on-failure`, corriendo en la misma VM
Linux ARM64 que ya aloja al ingestor.

**Rationale**: el usuario especificó "servidor HTTP gestionado como servicio del sistema, con
reinicio automático ante caída". systemd ya es el mecanismo de facto en la VM (no se agrega
ninguna pieza de infraestructura nueva) y cubre reinicio automático sin dependencias de
Node adicionales.

**Alternatives considered**: `pm2`/`forever` (rechazados: agregan un proceso demonio y una
dependencia de Node no justificada cuando systemd ya resuelve lo mismo de forma nativa);
contenedor Docker con política de reinicio (rechazado: introduce un mecanismo de despliegue
completo nuevo, no usado por la feature 1, desproporcionado para un segundo proceso en la
misma VM).

## 3. Caché en memoria y validadores HTTP (evitar una consulta a la base por petición)

**Decision**: una caché en memoria del proceso, con el conjunto de noticias del día ya
mapeado a la forma pública, refrescada de forma perezosa (al recibir una petición después de
vencido un TTL corto configurable) o al detectar que cambió el día local vigente. Cada
refresco recalcula un `ETag` con `node:crypto` (`sha1` sobre una serialización estable del
conjunto) y guarda el instante del refresco como `Last-Modified`. La ruta responde `304 Not
Modified` sin cuerpo cuando `If-None-Match` coincide con el `ETag` vigente, y en toda
respuesta emite `Cache-Control` acotado al mismo TTL.

**Rationale**: el requisito es explícito — "las lecturas repetidas no deben traducirse en una
consulta a la base por cada petición: la respuesta cambia solo cuando cambia el conjunto
almacenado" y "debe emitir validadores de caché HTTP". Un TTL corto (segundos, no minutos)
desacopla el volumen de peticiones públicas de la carga sobre MongoDB sin necesitar detectar
cambios en tiempo real: dado el volumen esperado (decenas de noticias/día) y que la ingesta
corre con cadencia de minutos (feature 1), un TTL corto es indistinguible en la práctica de
"solo cambia cuando cambia el conjunto almacenado", sin la complejidad operativa de una
suscripción a cambios. `node:crypto` es biblioteca estándar — no se suma ninguna dependencia
para el hash.

**Alternatives considered**: MongoDB Change Streams para invalidar la caché exactamente en el
instante del cambio (rechazado: exige mantener una conexión persistente con reconexión propia,
manejo de errores adicional, y es una complejidad operativa desproporcionada para decenas de
noticias/día con una fuente que ya se consulta con cadencia de minutos); consultar la base en
cada petición sin caché (rechazado explícitamente por el requisito); caché externa tipo Redis
(rechazada: dependencia de infraestructura nueva no justificada para un único proceso con un
conjunto de datos pequeño que cabe cómodo en memoria).

## 4. Separación de credenciales: usuario de MongoDB de solo lectura

**Decision**: un usuario de base de datos de Atlas dedicado a este proceso, con rol `read`
sobre la base de datos objetivo (sin `readWrite`), expuesto mediante una cadena de conexión
propia (`MONGODB_READONLY_URI`), distinta de la `MONGODB_URI` de lectura-escritura que usa el
ingestor.

**Rationale**: requisito explícito del usuario — "las credenciales de base de este proceso
sean de solo lectura, para que la restricción quede impuesta por la infraestructura y no solo
por disciplina", en línea con el Artículo III. Reutilizar la misma cadena de conexión que el
ingestor haría que la garantía dependiera únicamente del código de la aplicación, no de un
límite real e independiente del proceso.

**Alternatives considered**: una única credencial compartida con permisos de escritura,
confiando en que el código nunca escriba (rechazada: es exactamente la garantía "solo por
disciplina" que el requisito pide evitar).

## 5. Corte de "día en curso": reutilizar `src/core/localTime.ts`

**Decision**: extender `src/core/localTime.ts` (ya existente, feature 1) con una función pura
`localDayRangeUtc(now: Date, timeZone: string): { startUtc: Date; endUtc: Date }` que calcula
el inicio del día local vigente (en UTC) usando el mismo enfoque basado en `Intl` que ya usa
`toLocalDateKey`; el fin de la ventana es siempre `now`. La consulta a MongoDB filtra
`publishedAt` dentro de `[startUtc, now)`.

**Rationale**: el Artículo VI y FR-011/FR-012 exigen que la decisión de "a qué día pertenece"
se resuelva en hora local, nunca comparando instantes UTC directamente — exactamente el
problema que `localTime.ts` ya resuelve para el ingestor. Extender el mismo módulo evita
reimplementar la lógica de zona horaria y mantiene una única fuente de verdad para esa
conversión en todo el repositorio.

**Alternatives considered**: una librería de fechas (`date-fns-tz`, `luxon`) para el cálculo
de rango (rechazada explícitamente por el usuario: "sin biblioteca de fechas — la conversión
de zona horaria se resuelve con `Intl`"); reimplementar el cálculo de forma independiente en
el endpoint (rechazada: duplicaría lógica ya resuelta y probada en feature 1, con riesgo de
que ambas implementaciones diverjan).

## 6. Pruebas HTTP contra un estado de base preparado: `mongodb-memory-server`

**Decision**: `mongodb-memory-server` como devDependency, exclusiva de `tests/http/`. Cada
archivo de test arranca una instancia de MongoDB efímera en memoria, siembra documentos `news`
conocidos, construye la app Fastify (`src/http/app.ts`) y la ejercita con `fastify.inject()`
(sin abrir un puerto real ni requerir red hacia Atlas ni hacia la fuente de noticias real).

**Rationale**: el requisito pide pruebas "a nivel HTTP contra un estado de base preparado,
ejercitables sin red hacia la fuente real". La feature 1 no necesitó ninguna base de datos en
sus tests porque probaba únicamente `src/core` (puro); este feature expone comportamiento que
depende genuinamente de consultas Mongo reales (rango de fechas, y que la caché refleje el
contenido real) y de las cabeceras HTTP que Fastify genera — no se puede validar con solo
funciones puras. `mongodb-memory-server` da una base real (mismo motor, mismas semánticas de
consulta) sin depender de credenciales de Atlas ni de una base compartida mutable entre
corridas de test, evitando además cualquier acceso de red a la fuente de noticias.

**Alternatives considered**: apuntar los tests a una base de Atlas de test real (rechazada:
requiere credenciales y red durante CI, y arriesga contaminación entre corridas de test —
justo lo que "sin red hacia la fuente real" busca evitar en espíritu, aunque la fuente en
sentido estricto sea el feed externo y no Mongo); mockear el driver de MongoDB (rechazada: no
ejercitaría las semánticas reales de la consulta por rango de fechas, que es exactamente lo
que hay que validar según el requisito de "corte de día calendario en hora local y no en
UTC").

## 7. Límite de tasa: por IP, umbral configurable

**Decision**: `@fastify/rate-limit` con la IP del cliente como clave, y el máximo de
peticiones y la ventana de tiempo como variables de entorno (`RATE_LIMIT_MAX_PER_IP`,
`RATE_LIMIT_WINDOW_MS`) validadas al arranque, sin valor por defecto oculto en el código —
mismo tratamiento que los umbrales de configuración de la feature 1
(`CATEGORY_SILENCE_THRESHOLD_MS`, etc.).

**Rationale**: "por IP" fue especificado explícitamente por el usuario. El valor numérico
exacto del umbral no fue especificado y no tiene un default universal correcto — se calibra en
producción, igual que los umbrales de la feature 1.

**Alternatives considered**: fijar un número en el código (rechazada: mismo argumento que
llevó a la feature 1 a tratar sus umbrales como configuración, no como constantes embebidas).

## 8. CORS: origen abierto, sin configuración adicional

**Decision**: `@fastify/cors` configurado con `origin: true` (refleja cualquier origen
solicitante), sin lista de dominios permitidos ni variable de entorno nueva.

**Rationale**: FR-014 (resuelto en la sección Clarifications de spec.md) fija esta decisión
como requisito, no como parámetro configurable: "cualquier origen, sin restricción de
dominio". Agregar una variable de entorno para algo que la especificación ya decidió de forma
fija sería diseñar para un requisito hipotético no pedido (contrario a la restricción de
stack y al principio de no sobre-ingeniería del proyecto).

**Alternatives considered**: lista de dominios permitidos configurable (rechazada: contradice
FR-014, que fija el acceso público sin restricción de origen).
